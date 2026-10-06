import { useChatAttachments } from "../../context/ChatAttachmentContext.ts";
import { useCallback } from "preact/hooks";

import { pushSubscriptionApi } from "../../../api/pushSubscriptionApi";

/** Revokes this browser's push endpoint before ending the current session. */
export function useAccountSignOut(account: string): () => void {
  const { drafts } = useChatAttachments();
  return useCallback(() => {
    drafts.reset();
    void pushSubscriptionApi
      .prepareForLogout(account)
      .catch(() => {})
      .then(() => window.location.assign("/auth/logout"));
  }, [account, drafts]);
}
