import { API_ROUTES } from "../../../config/routes.ts";
import { useStore } from "zustand";
import { attachmentDraftStore, attachmentUploadHandles, attachmentUploadCompletions } from "../../stores/chat/attachmentDraftStore.ts";
import { EMPTY_DRAFT_ATTACHMENTS } from "../../../config/chat.ts";
import { useCallback, useEffect, useRef } from "preact/hooks";
import type { Attachment } from "../../../models/upload";
import { startChatUpload } from "../../../api/uploadApi";
import type { UploadHandle } from "../../../types/uploadApi";
import { idService } from "../../../services/platform/idService.ts";
import { chatAttachmentService } from "../../../services/chat/chatAttachmentService.ts";
import { announceUpload } from "./attachmentClaimPolicy.ts";

export function useAttachmentUpload(
  chatId: string,
  attachmentBasePath: string,
  projectId?: string
) {
  const attachments = useStore(
    attachmentDraftStore,
    (state) => state.attachments.get(chatId) ?? EMPTY_DRAFT_ATTACHMENTS,
  );
  const uploading = useStore(
    attachmentDraftStore,
    (state) => (state.pending.get(chatId) ?? 0) > 0,
  );
  const setAttachments = useCallback((change: (previous: Attachment[]) => Attachment[], save = false) => {
    attachmentDraftStore.getState().update(chatId, change, save);
  }, [chatId]);

  // Read when an upload finishes rather than captured: doUpload is keyed on
  // chatId alone and outlives an edit to either of these.
  const attachmentBasePathRef = useRef(attachmentBasePath);
  const projectIdRef = useRef(projectId);
  // Outstanding tus handles, keyed by attachment id. Lets us abort on remove.
  let handles = attachmentUploadHandles.get(chatId);
  if (!handles) {
    handles = new Map<string, UploadHandle>();
    attachmentUploadHandles.set(chatId, handles);
  }
  const handlesRef = { current: handles };

  // Clear only on send or explicit discard. Navigation does not own uploads.
  const clearAttachments = useCallback(() => {
    for (const [id, handle] of handlesRef.current) {
      void handle.abort().catch(() => undefined);
      attachmentUploadCompletions.get(id)?.();
      attachmentUploadCompletions.delete(id);
    }
    handlesRef.current.clear();
    setAttachments((prev) => {
      prev.forEach((attachment) => chatAttachmentService.revokeObjectUrl(attachment));
      return [];
    }, true);
  }, [chatId, setAttachments]);

  useEffect(() => {
    attachmentBasePathRef.current = attachmentBasePath;
    projectIdRef.current = projectId;
  }, [attachmentBasePath, projectId]);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      // Pasted screenshots all arrive named "image.png", and the server stores
      // by filename — so a second paste would overwrite the first on disk and
      // both would resolve to the same prompt path. Give every upload a unique
      // storage name derived from its attachment id (which also disambiguates
      // the tus resume fingerprint), while keeping the original name as the
      // friendly label shown in the composer chip.
      const items = files.map((file) => {
        const id = idService.random();
        const uploadName = chatAttachmentService.uniqueUploadName(file.name, id);
        const uploadFile =
          uploadName === file.name
            ? file
            : new File([file], uploadName, {
                type: file.type,
                lastModified: file.lastModified,
              });
        return { id, displayName: file.name, uploadFile };
      });

      const queued: Attachment[] = items.map(({ id, displayName, uploadFile }) => ({
        id,
        name: displayName,
        size: uploadFile.size,
        serverPath: "",
        isImage: uploadFile.type.startsWith("image/"),
        objectUrl: uploadFile.type.startsWith("image/")
          ? URL.createObjectURL(uploadFile)
          : undefined,
        progress: 0,
      }));

      setAttachments((prev) => [...prev, ...queued]);
      attachmentDraftStore.getState().begin(chatId);

      const finishedFlags: Promise<void>[] = [];
      for (let i = 0; i < items.length; i++) {
        const { uploadFile } = items[i];
        const att = queued[i];
        const done = new Promise<void>((resolvePromise) => {
          const resolve = () => { attachmentUploadCompletions.delete(att.id); resolvePromise(); };
          attachmentUploadCompletions.set(att.id, resolve);
          const handle = startChatUpload(chatId, uploadFile, {
            onProgress(loaded, total) {
              const ratio = total > 0 ? loaded / total : 0;
              setAttachments((prev) =>
                prev.map((a) => (a.id === att.id ? { ...a, progress: ratio } : a))
              );
            },
            onSuccess() {
              handlesRef.current.delete(att.id);
              if (!attachmentDraftStore.getState().attachments.get(chatId)?.some((item) => item.id === att.id)) {
                resolve();
                return;
              }
              const directory = attachmentBasePathRef.current;
              const serverPath = chatAttachmentService.absoluteUploadPath(
                directory,
                uploadFile.name
              );
              // The server now owns the file; release the full-size blob.
              chatAttachmentService.revokeObjectUrl(att);
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === att.id
                    ? { ...a, progress: 1, serverPath, objectUrl: a.isImage ? API_ROUTES.chats.mediaOpen(chatId, serverPath) : undefined, error: undefined }
                    : a
                ),
                true,
              );
              // Announced after the attachment is on disk and before the
              // prompt can reference it. A handler that only observes costs
              // nothing; one that claims the attachment is moving it, and the
              // upload is not finished until it says where it went.
              const claimed = announceUpload({
                chatId,
                projectId: projectIdRef.current,
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
                  setAttachments((prev) =>
                    prev.map((a) =>
                      a.id === att.id ? { ...a, serverPath: relocated, objectUrl: a.isImage ? API_ROUTES.chats.mediaOpen(chatId, relocated) : undefined } : a
                    ),
                    true,
                  );
                }
                resolve();
              });
            },
            onError(err) {
              handlesRef.current.delete(att.id);
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === att.id ? { ...a, error: err.message } : a
                )
              );
              resolve();
            },
          });
          handlesRef.current.set(att.id, handle);
        });
        finishedFlags.push(done);
      }

      await Promise.all(finishedFlags);
      attachmentDraftStore.getState().finish(chatId);
    },
    [chatId, setAttachments]
  );

  const removeAttachment = useCallback((id: string) => {
    const handle = handlesRef.current.get(id);
    if (handle) {
      void handle.abort().catch(() => undefined);
      attachmentUploadCompletions.get(id)?.();
      attachmentUploadCompletions.delete(id);
      handlesRef.current.delete(id);
    }
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.id === id);
      if (target) chatAttachmentService.revokeObjectUrl(target);
      return prev.filter((attachment) => attachment.id !== id);
    }, true);
  }, [chatId, setAttachments]);

  return {
    attachments,
    uploading,
    doUpload,
    removeAttachment,
    clearAttachments,
  };
}
