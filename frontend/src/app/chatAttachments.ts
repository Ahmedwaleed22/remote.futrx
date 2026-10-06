import { ChatDraftSessionService } from "../services/chat/chatDraftSessionService.ts";
import { chatComposerSessionStore } from "../state/stores/chat/composerSessionStore.ts";
import {
  attachmentSessionStorage,
  createAttachmentDraftStorage,
} from "../api/chat/attachmentDraftStorage.ts";
import { AttachmentUploadService } from "../services/chat/attachmentUploadService.ts";
import { createAttachmentDraftStore } from "../state/stores/chat/attachmentDraftStore.ts";
import { startChatUpload } from "../api/uploadApi.ts";
import { API_ROUTES } from "../config/routes.ts";
import { idService } from "../services/platform/idService.ts";
import { chatAttachmentService } from "../services/chat/chatAttachmentService.ts";
import { announceUpload } from "../api/chat/attachmentClaimApi.ts";

const attachmentDraftStore = createAttachmentDraftStore(
  createAttachmentDraftStorage(attachmentSessionStorage()),
);

const uploads = new AttachmentUploadService(attachmentDraftStore.getState, {
  randomId: () => idService.random(),
  renameFile: (file, name) =>
    new File([file], name, {
      type: file.type,
      lastModified: file.lastModified,
    }),
  createObjectUrl: (file) => URL.createObjectURL(file),
  revokeObjectUrl: (attachment) =>
    chatAttachmentService.revokeObjectUrl(attachment),
  previewPath: API_ROUTES.chats.mediaOpen,
  startUpload: startChatUpload,
  announceUpload,
});

export const chatAttachments = {
  store: attachmentDraftStore,
  uploads,
  drafts: new ChatDraftSessionService(
    uploads,
    chatComposerSessionStore.getState,
  ),
};
