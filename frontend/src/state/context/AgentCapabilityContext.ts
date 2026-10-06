import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { StoreApi } from "zustand/vanilla";
import type { AgentCapabilityCatalogStoreState } from "../../models/agentCapabilities.ts";
import type { AgentCapabilityCatalogCommands } from "../../port/agents/agentCapabilityCatalog.ts";

interface AgentCapabilities {
  store: StoreApi<AgentCapabilityCatalogStoreState>;
  catalog: AgentCapabilityCatalogCommands;
}
export const AgentCapabilityContext = createContext<AgentCapabilities | null>(
  null,
);
export function useAgentCapabilityContext(): AgentCapabilities {
  const value = useContext(AgentCapabilityContext);
  if (!value) throw new Error("AgentCapabilityContext is required");
  return value;
}
