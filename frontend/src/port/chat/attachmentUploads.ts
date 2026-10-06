import type {
  Attachment,
  AttachmentDraftState,
  AttachmentDraftActions,
} from "../../models/upload.ts";
import type { CompletedUpload } from "../../models/extension.ts";
import type {
  ChatUploadCallbacks,
  UploadHandle,
} from "../../types/uploadApi.ts";

export type AttachmentDraftStatePort = () => AttachmentDraftState &
  AttachmentDraftActions;
export interface AttachmentUploadSession {
  upload(files: File[]): Promise<void>;
  remove(id: string): void;
  clear(): void;
}
export interface AttachmentUploadGateway {
  randomId(): string;
  renameFile(file: File, name: string): File;
  createObjectUrl(file: File): string;
  revokeObjectUrl(attachment: Attachment): void;
  previewPath(chatId: string, path: string): string;
  startUpload(
    chatId: string,
    file: File,
    callbacks: ChatUploadCallbacks,
  ): UploadHandle;
  announceUpload(upload: CompletedUpload): Promise<string | null> | null;
}
