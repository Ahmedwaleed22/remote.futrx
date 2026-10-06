import { useStore } from "zustand";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { EMPTY_DRAFT_ATTACHMENTS } from "../../../config/chat.ts";
import { useChatAttachments } from "../../context/ChatAttachmentContext.ts";

export function useAttachmentUpload(
  chatId: string,
  attachmentBasePath: string,
  projectId?: string,
) {
  const { store, uploads } = useChatAttachments();
  const attachments = useStore(
    store,
    (state) => state.attachments.get(chatId) ?? EMPTY_DRAFT_ATTACHMENTS,
  );
  const uploading = useStore(
    store,
    (state) => (state.pending.get(chatId) ?? 0) > 0,
  );
  const target = useRef({ attachmentBasePath, projectId });
  // Preserve the mounted caller's target updates without giving navigation
  // ownership of the session's uploads.
  useEffect(() => {
    target.current = { attachmentBasePath, projectId };
  }, [attachmentBasePath, projectId]);
  const session = uploads.open(chatId, () => target.current);
  const doUpload = useCallback(session.upload, [chatId, uploads]);
  const removeAttachment = useCallback(session.remove, [chatId, uploads]);
  const clearAttachments = useCallback(session.clear, [chatId, uploads]);
  return {
    attachments,
    uploading,
    doUpload,
    removeAttachment,
    clearAttachments,
  };
}
