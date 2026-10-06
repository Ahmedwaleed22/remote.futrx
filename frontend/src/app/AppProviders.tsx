import { WorkspaceFeedContext } from "../state/context/WorkspaceFeedContext.ts";
import { workspaceFeed } from "./workspaceFeed.ts";
import { AgentCapabilityContext } from "../state/context/AgentCapabilityContext.ts";
import { agentCapabilities } from "./agentCapabilities.ts";
import type { ComponentChildren } from "preact";
import { AuthProvider } from "../state/context/AuthContext";
import { ConfirmProvider } from "./containers/ConfirmProvider";
import { UserSettingsProvider } from "../state/context/UserSettingsContext";

export function AppProviders({ children }: { children: ComponentChildren }) {
  return (
    <WorkspaceFeedContext.Provider value={workspaceFeed}>
      <AgentCapabilityContext.Provider value={agentCapabilities}>
        <AuthProvider>
          <UserSettingsProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </UserSettingsProvider>
        </AuthProvider>
      </AgentCapabilityContext.Provider>
    </WorkspaceFeedContext.Provider>
  );
}
