import { createStore } from "zustand/vanilla";
import { pushServiceWorkerApi } from "../../../api/pushServiceWorkerApi.ts";
import type {
  PushNotificationStoreActions,
  PushNotificationStoreState,
} from "../../../models/push";
import { isPushPageFocused } from "./pushPageFocus.ts";

let isListening = false;

export const pushNotificationStore = createStore<
  PushNotificationStoreState & PushNotificationStoreActions
>()((set, get) => {
  /** Clears the tray for the chat the user is actually looking at. */
  function closeWatchedChatNotifications(): void {
    const { visibleChatId } = get();
    if (!visibleChatId || typeof document === "undefined" || !isPushPageFocused()) return;
    void pushServiceWorkerApi.closeChatNotifications(visibleChatId);
  }

  function listen(): void {
    if (isListening || typeof window === "undefined") return;
    isListening = true;
    // Coming back to the app already on a chat reads it just as surely as
    // opening it does.
    document.addEventListener("visibilitychange", closeWatchedChatNotifications);
    window.addEventListener("focus", closeWatchedChatNotifications);
  }

  return {
    visibleChatId: null,
    /** Registers for push and routes notification taps into chat selection. */
    connect: (openChat) => {
      // Keep registration first: it installs the listener before asking the
      // browser to update the worker, matching the page's startup sequence.
      void pushServiceWorkerApi.register();
      pushServiceWorkerApi.connect({
        visibleChatId: () => {
          // A background tab showing the chat should still raise a notification.
          return isPushPageFocused() ? get().visibleChatId : null;
        },
        openChat,
      });
    },

    /**
     * Reports which chat is on screen, so the worker can suppress its
     * notification, and clears the ones it already raised for that chat.
     */
    setVisibleChat: (visibleChatId) => {
      set({ visibleChatId });
      listen();
      closeWatchedChatNotifications();
    },
  };
});
