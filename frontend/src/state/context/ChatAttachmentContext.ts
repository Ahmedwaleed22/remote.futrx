import type { ChatDraftSessionService } from "../../services/chat/chatDraftSessionService.ts";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { StoreApi } from "zustand/vanilla";
import type {
  AttachmentDraftState,
  AttachmentDraftActions,
} from "../../models/upload.ts";
import type { AttachmentUploadService } from "../../services/chat/attachmentUploadService.ts";

interface ChatAttachments {
  store: StoreApi<AttachmentDraftState & AttachmentDraftActions>;
  uploads: AttachmentUploadService;
  drafts: ChatDraftSessionService;
}
export const ChatAttachmentContext = createContext<ChatAttachments | null>(
  null,
);
export function useChatAttachments(): ChatAttachments {
  const value = useContext(ChatAttachmentContext);
  if (!value) throw new Error("ChatAttachmentContext is required");
  return value;
}
