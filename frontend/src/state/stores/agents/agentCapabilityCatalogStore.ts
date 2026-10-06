import type { AgentCapabilityCatalogMutations } from "../../../port/agents/agentCapabilityCatalog.ts";
import { createStore } from "zustand/vanilla";
import type {
  AgentCapabilityCatalogSnapshot,
  AgentCapabilityCatalogStoreState,
} from "../../../models/agentCapabilities.ts";
import { EMPTY_AGENT_CAPABILITY_CATALOG_SNAPSHOT } from "../../../config/agents.ts";
import { catalogKey } from "../../../services/agents/agentCapabilityScope.ts";

export function createAgentCapabilityCatalogStore() {
  return createStore<AgentCapabilityCatalogStoreState & AgentCapabilityCatalogMutations>()(
    (set) => ({
      scopes: new Map(),
      replaceScopes: (scopes) => set({ scopes }),
    }),
  );
}
export function selectAgentCapabilityCatalog(
  userId: string,
  projectId?: string,
) {
  const key = catalogKey(userId, projectId);
  return (
    state: AgentCapabilityCatalogStoreState,
  ): AgentCapabilityCatalogSnapshot =>
    state.scopes.get(key) ?? EMPTY_AGENT_CAPABILITY_CATALOG_SNAPSHOT;
}
