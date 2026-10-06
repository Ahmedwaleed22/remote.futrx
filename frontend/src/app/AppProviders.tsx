import type { ComponentChildren } from "preact";
import { AgentCapabilityAuthProvider as AuthProvider } from "./containers/AgentCapabilityAuthProvider.tsx";
import { ConfirmProvider } from "./containers/ConfirmProvider";
import { UserSettingsProvider } from "../state/context/UserSettingsContext";

export function AppProviders({ children }: { children: ComponentChildren }) {
  return (
    <AuthProvider>
      <UserSettingsProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </UserSettingsProvider>
    </AuthProvider>
  );
}
