import { capabilitiesApi } from "../api/agents/capabilitiesApi.ts";
import { createAgentCapabilityCatalogService } from "../services/agents/agentCapabilityCatalogService.ts";
import { createAgentCapabilityCatalogStore } from "../state/stores/agents/agentCapabilityCatalogStore.ts";
import { EMPTY_AGENT_CAPABILITY_CATALOG_SNAPSHOT } from "../config/agents.ts";
import type { AgentCapabilityCatalogRequester } from "../port/agents/agentCapabilityCatalog.ts";

export function createAgentCapabilities(
  request: AgentCapabilityCatalogRequester,
) {
  const store = createAgentCapabilityCatalogStore();
  const catalog = createAgentCapabilityCatalogService(request, {
    readScopes: () => store.getState().scopes,
    readScope: (key) =>
      store.getState().scopes.get(key) ??
      EMPTY_AGENT_CAPABILITY_CATALOG_SNAPSHOT,
    replaceScopes: (scopes) => store.getState().replaceScopes(scopes),
  });
  return { store, catalog };
}
// Shared for the open application's lifetime; construction starts no I/O.
export const agentCapabilities = createAgentCapabilities(capabilitiesApi.list);
