import type {
  Attachment,
  AttachmentUploadTarget,
} from "../../models/upload.ts";
import type { UploadHandle } from "../../types/uploadApi.ts";
import type {
  AttachmentDraftStatePort,
  AttachmentUploadGateway,
  AttachmentUploadSession,
} from "../../port/chat/attachmentUploads.ts";
import { chatAttachmentService } from "./chatAttachmentService.ts";

/** Owns upload handles and completion signals for the whole chat session. */
export class AttachmentUploadService {
  private readonly handles = new Map<string, Map<string, UploadHandle>>();
  private readonly completions = new Map<string, () => void>();

  private readonly state: AttachmentDraftStatePort;
  private readonly gateway: AttachmentUploadGateway;

  constructor(state: AttachmentDraftStatePort, gateway: AttachmentUploadGateway) {
    this.state = state;
    this.gateway = gateway;
  }

  open(
    chatId: string,
    target: () => AttachmentUploadTarget,
  ): AttachmentUploadSession {
    let handles = this.handles.get(chatId);
    if (!handles) {
      handles = new Map<string, UploadHandle>();
      this.handles.set(chatId, handles);
    }
    const activeHandles = handles;
    const setAttachments = (
      change: (previous: Attachment[]) => Attachment[],
      save = false,
    ) => {
      this.state().update(chatId, change, save);
    };
    const clear = () => {
      for (const [id, handle] of activeHandles) {
        void handle.abort().catch(() => undefined);
        this.completions.get(id)?.();
        this.completions.delete(id);
      }
      activeHandles.clear();
      setAttachments((prev) => {
        prev.forEach((attachment) => this.gateway.revokeObjectUrl(attachment));
        return [];
      }, true);
    };
    const upload = async (files: File[]) => {
      if (!files.length) return;
      // Pasted screenshots all arrive named "image.png", and the server stores
      // by filename — so a second paste would overwrite the first on disk and
      // both would resolve to the same prompt path. Give every upload a unique
      // storage name derived from its attachment id (which also disambiguates
      // the tus resume fingerprint), while keeping the original name as the
      // friendly label shown in the composer chip.
      const items = files.map((file) => {
        const id = this.gateway.randomId();
        const uploadName = chatAttachmentService.uniqueUploadName(
          file.name,
          id,
        );
        const uploadFile =
          uploadName === file.name
            ? file
            : this.gateway.renameFile(file, uploadName);
        return { id, displayName: file.name, uploadFile };
      });

      const queued: Attachment[] = items.map(
        ({ id, displayName, uploadFile }) => ({
          id,
          name: displayName,
          size: uploadFile.size,
          serverPath: "",
          isImage: uploadFile.type.startsWith("image/"),
          objectUrl: uploadFile.type.startsWith("image/")
            ? this.gateway.createObjectUrl(uploadFile)
            : undefined,
          progress: 0,
        }),
      );

      setAttachments((prev) => [...prev, ...queued]);
      this.state().begin(chatId);

      const finishedFlags: Promise<void>[] = [];
      for (let i = 0; i < items.length; i++) {
        const { uploadFile } = items[i];
        const att = queued[i];
        const done = new Promise<void>((resolvePromise) => {
          const resolve = () => {
            this.completions.delete(att.id);
            resolvePromise();
          };
          this.completions.set(att.id, resolve);
          const handle = this.gateway.startUpload(chatId, uploadFile, {
            onProgress: (loaded, total) => {
              const ratio = total > 0 ? loaded / total : 0;
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === att.id ? { ...a, progress: ratio } : a,
                ),
              );
            },
            onSuccess: () => {
              activeHandles.delete(att.id);
              if (
                !this.state()
                  .attachments.get(chatId)
                  ?.some((item) => item.id === att.id)
              ) {
                resolve();
                return;
              }
              const directory = target().attachmentBasePath;
              const serverPath = chatAttachmentService.absoluteUploadPath(
                directory,
                uploadFile.name,
              );
              // The server now owns the file; release the full-size blob.
              this.gateway.revokeObjectUrl(att);
              setAttachments(
                (prev) =>
                  prev.map((a) =>
                    a.id === att.id
                      ? {
                          ...a,
                          progress: 1,
                          serverPath,
                          objectUrl: a.isImage
                            ? this.gateway.previewPath(chatId, serverPath)
                            : undefined,
                          error: undefined,
                        }
                      : a,
                  ),
                true,
              );
              // Announced after the attachment is on disk and before the
              // prompt can reference it. A handler that only observes costs
              // nothing; one that claims the attachment is moving it, and the
              // upload is not finished until it says where it went.
              const claimed = this.gateway.announceUpload({
                chatId,
                projectId: target().projectId,
                fileName: uploadFile.name,
                directory,
                path: serverPath,
                size: uploadFile.size,
              });
              if (!claimed) {
                resolve();
                return;
              }
              void claimed.then((relocated) => {
                if (relocated) {
                  setAttachments(
                    (prev) =>
                      prev.map((a) =>
                        a.id === att.id
                          ? {
                              ...a,
                              serverPath: relocated,
                              objectUrl: a.isImage
                                ? this.gateway.previewPath(chatId, relocated)
                                : undefined,
                            }
                          : a,
                      ),
                    true,
                  );
                }
                resolve();
              });
            },
            onError: (err) => {
              activeHandles.delete(att.id);
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === att.id ? { ...a, error: err.message } : a,
                ),
              );
              resolve();
            },
          });
          activeHandles.set(att.id, handle);
        });
        finishedFlags.push(done);
      }

      await Promise.all(finishedFlags);
      this.state().finish(chatId);
    };
    const remove = (id: string) => {
      const handle = activeHandles.get(id);
      if (handle) {
        void handle.abort().catch(() => undefined);
        this.completions.get(id)?.();
        this.completions.delete(id);
        activeHandles.delete(id);
      }
      setAttachments((prev) => {
        const target = prev.find((attachment) => attachment.id === id);
        if (target) this.gateway.revokeObjectUrl(target);
        return prev.filter((attachment) => attachment.id !== id);
      }, true);
    };
    return { clear, upload, remove };
  }

  discardChat(chatId: string): void {
    for (const [id, handle] of this.handles.get(chatId) ?? []) {
      void handle.abort().catch(() => undefined);
      this.completions.get(id)?.();
      this.completions.delete(id);
    }
    this.handles.delete(chatId);
    this.state().update(
      chatId,
      (items) => {
        for (const item of items)
          if (item.objectUrl?.startsWith("blob:"))
            this.gateway.revokeObjectUrl(item);
        return [];
      },
      true,
    );
  }

  discardAll(): void {
    const chatIds = new Set([
      ...this.state().attachments.keys(),
      ...this.handles.keys(),
    ]);
    for (const chatId of chatIds) this.discardChat(chatId);
  }
}
