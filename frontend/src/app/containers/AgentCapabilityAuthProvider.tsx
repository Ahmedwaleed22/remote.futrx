import type { ComponentChildren } from "preact";
import { AgentCapabilityContext } from "../../state/context/AgentCapabilityContext.ts";
import { AuthProvider } from "../../state/context/AuthContext.tsx";
import { agentCapabilities } from "../agentCapabilities.ts";

/** Compose model discovery with the authentication session that invalidates it. */
export function AgentCapabilityAuthProvider({ children }: { children: ComponentChildren }) {
  return (
    <AgentCapabilityContext.Provider value={agentCapabilities}>
      <AuthProvider>{children}</AuthProvider>
    </AgentCapabilityContext.Provider>
  );
}
