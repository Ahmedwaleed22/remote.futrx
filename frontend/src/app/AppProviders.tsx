import { ChatAttachmentContext } from "../state/context/ChatAttachmentContext.ts";
import { chatAttachments } from "./chatAttachments.ts";
import type { ComponentChildren } from "preact";
import { AuthProvider } from "../state/context/AuthContext";
import { ConfirmProvider } from "./containers/ConfirmProvider";
import { UserSettingsProvider } from "../state/context/UserSettingsContext";

export function AppProviders({ children }: { children: ComponentChildren }) {
  return (
    <ChatAttachmentContext.Provider value={chatAttachments}>
      <AuthProvider>
        <UserSettingsProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </UserSettingsProvider>
      </AuthProvider>
    </ChatAttachmentContext.Provider>
  );
}
