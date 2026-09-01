import type { ChatStatus } from "../../../models/chat";
import { useDismissShortcut } from "../shared/useDismissShortcut.ts";

/**
 * Escape cancels the reply being streamed.
 *
 * It is the outermost claim on Escape in a chat, and deliberately the weakest:
 * every overlay above it -- find-in-chat, a menu, a modal -- takes the key on
 * the way down and stops it, so Escape only reaches the run when nothing is
 * open in front of it.
 */
export function useChatKeyboardShortcuts({
  status,
  onCancel,
}: {
  status: ChatStatus;
  onCancel: () => void;
}) {
  useDismissShortcut(onCancel, { enabled: status === "streaming" });
}
