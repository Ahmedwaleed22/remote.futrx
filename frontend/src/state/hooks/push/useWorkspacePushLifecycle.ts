import { useEffect } from "preact/hooks";

import { pushSubscriptionApi } from "../../../api/pushSubscriptionApi";
import type { WorkspaceView } from "../../workspace/workspaceUiState";
import { pushNotificationState } from "../../push/pushNotificationState";
import { pushPresenceState } from "../../push/pushPresenceState";

interface WorkspacePushLifecycleOptions {
  /** The signed-in account, or "" while the session is not established. */
  account: string;
  activeChatId: string | null;
  view: WorkspaceView;
  openChat: (chatId: string) => void;
}

// How long a tab may stay open before its registration is worth re-checking.
// Push services retire endpoints on their own schedule, and a workspace left
// open for days would otherwise only find out when a notification never came.
const REVALIDATE_AFTER_MS = 30 * 60 * 1000;

/** Keeps subscription ownership, worker routing, and presence in sync. */
export function useWorkspacePushLifecycle({
  account,
  activeChatId,
  view,
  openChat,
}: WorkspacePushLifecycleOptions): void {
  // Register the worker on every boot so a deployed sw.js replaces the
  // installed one, and route notification taps into chat selection.
  useEffect(() => {
    pushNotificationState.connect((chatId) => {
      if (chatId) openChat(chatId);
    });
  }, [openChat]);

  // Restore what this account already opted into. A backend restart, a deploy,
  // or a push service retiring an endpoint can leave the browser with nothing
  // registered, and none of those are the user withdrawing permission.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let checkedAt = 0;

    const ensure = () => {
      checkedAt = Date.now();
      void pushSubscriptionApi.ensureRegistered(account).catch(() => undefined);
    };
    const ensureIfStale = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (Date.now() - checkedAt < REVALIDATE_AFTER_MS) return;
      ensure();
    };

    ensure();
    document.addEventListener("visibilitychange", ensureIfStale);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", ensureIfStale);
    };
  }, [account]);

  // Say which chat is on screen, so nothing interrupts the user about the one
  // they are already watching. The worker covers this browser; the server
  // covers the user's other devices, which the worker cannot see.
  useEffect(() => {
    const onScreen = view === "chat" ? activeChatId : null;
    pushNotificationState.setVisibleChat(onScreen);
    pushPresenceState.setWatchedChat(onScreen);
  }, [activeChatId, view]);
}
