import type {
  AgentCapabilitiesCatalog,
  AgentCapabilityCatalogLoadOptions,
  AgentCapabilityCatalogSnapshot,
} from "../../models/agentCapabilities.ts";

export type AgentCapabilityCatalogRequester = (
  projectId?: string,
  options?: { refresh?: boolean },
) => Promise<AgentCapabilitiesCatalog>;
export interface AgentCapabilityCatalogState {
  readScopes(): ReadonlyMap<string, AgentCapabilityCatalogSnapshot>;
  readScope(key: string): AgentCapabilityCatalogSnapshot;
  replaceScopes(
    scopes: ReadonlyMap<string, AgentCapabilityCatalogSnapshot>,
  ): void;
}
export interface AgentCapabilityCatalogCommands {
  observe(userId: string, projectId?: string): () => void;
  load(
    userId: string,
    projectId?: string,
    options?: AgentCapabilityCatalogLoadOptions,
  ): Promise<AgentCapabilitiesCatalog>;
  invalidateUser(userId: string): void;
  removeProject(userId: string, projectId: string): void;
}

export interface AgentCapabilityCatalogMutations {
  replaceScopes(scopes: ReadonlyMap<string, AgentCapabilityCatalogSnapshot>): void;
}
