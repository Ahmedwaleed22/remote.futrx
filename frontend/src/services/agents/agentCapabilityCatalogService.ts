import type {
  AgentCapabilitiesCatalog,
  AgentCapabilityCatalogLoadOptions,
  AgentCapabilityCatalogSnapshot,
} from "../../models/agentCapabilities.ts";
import type {
  AgentCapabilityCatalogRequester,
  AgentCapabilityCatalogState,
  AgentCapabilityCatalogCommands,
} from "../../port/agents/agentCapabilityCatalog.ts";
import {
  AGENT_CATALOG_INITIAL_POLL_MS,
  AGENT_CATALOG_MAX_POLL_MS,
  AGENT_CATALOG_SCOPE_LIMIT,
} from "../../config/agents.ts";
import { catalogKey, normalizeUserId } from "./agentCapabilityScope.ts";

interface ObservedScope {
  userId: string;
  projectId: string;
  observers: number;
}

// One owner for request coalescing, observers, and their polling lifecycle.
export function createAgentCapabilityCatalogService(
  request: AgentCapabilityCatalogRequester,
  state: AgentCapabilityCatalogState,
): AgentCapabilityCatalogCommands {
  const inFlight = new Map<string, Promise<AgentCapabilitiesCatalog>>();
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pollDelays = new Map<string, number>();
  const observed = new Map<string, ObservedScope>();

  function setScope(
    key: string,
    snapshot: AgentCapabilityCatalogSnapshot,
  ): void {
    const scopes = new Map(state.readScopes());
    scopes.delete(key);
    scopes.set(key, snapshot);
    // Keep the same insertion order and eviction eligibility.
    for (const candidate of scopes.keys()) {
      if (scopes.size <= AGENT_CATALOG_SCOPE_LIMIT) break;
      if (!observed.has(candidate) && !inFlight.has(candidate))
        scopes.delete(candidate);
    }
    state.replaceScopes(scopes);
  }

  function load(
    userId: string,
    projectId?: string,
    options: AgentCapabilityCatalogLoadOptions = {},
  ): Promise<AgentCapabilitiesCatalog> {
    const key = catalogKey(userId, projectId);
    const timer = pollTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pollTimers.delete(key);
    }
    if (options.force) pollDelays.delete(key);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const running = (async () => {
      try {
        const catalog = await request(projectId, { refresh: !!options.force });
        inFlight.delete(key);
        setScope(key, {
          catalog,
          loading:
            catalog.providers.length > 0 &&
            catalog.providers.every(
              (provider) => provider.refreshing && provider.source !== "live",
            ),
          refreshing: catalog.providers.some((provider) => provider.refreshing),
          error: "",
        });
        if (
          catalog.providers.some((provider) => provider.refreshing) &&
          observed.has(key)
        ) {
          const delay = pollDelays.get(key) ?? AGENT_CATALOG_INITIAL_POLL_MS;
          pollDelays.set(key, Math.min(delay * 2, AGENT_CATALOG_MAX_POLL_MS));
          pollTimers.set(
            key,
            setTimeout(() => {
              pollTimers.delete(key);
              if (observed.has(key))
                void load(userId, projectId).catch(() => undefined);
            }, delay),
          );
        } else {
          pollDelays.delete(key);
        }
        return catalog;
      } catch (cause) {
        inFlight.delete(key);
        const current = state.readScope(key);
        setScope(key, {
          ...current,
          loading: false,
          refreshing: false,
          error: errorMessage(cause),
        });
        throw cause;
      }
    })();

    inFlight.set(key, running);
    const current = state.readScope(key);
    setScope(key, {
      ...current,
      loading: !current.catalog,
      refreshing: true,
      error: "",
    });
    return running;
  }

  return {
    observe: (userId, projectId) => {
      const key = catalogKey(userId, projectId);
      const scope = observed.get(key) ?? {
        userId: normalizeUserId(userId),
        projectId: projectId || "",
        observers: 0,
      };
      scope.observers += 1;
      observed.set(key, scope);
      let isObserved = true;
      return () => {
        if (!isObserved) return;
        isObserved = false;
        scope.observers -= 1;
        if (scope.observers === 0) {
          observed.delete(key);
          const timer = pollTimers.get(key);
          if (timer) clearTimeout(timer);
          pollTimers.delete(key);
          pollDelays.delete(key);
        }
      };
    },
    load,
    invalidateUser: (userId) => {
      // A managed host-auth change can alter every catalog. Request a
      // force-refresh for scopes currently observed by this browser; an
      // existing request for the same scope remains coalesced.
      const normalizedUser = normalizeUserId(userId);
      for (const scope of observed.values()) {
        if (scope.userId !== normalizedUser) continue;
        void load(scope.userId, scope.projectId || undefined, {
          force: true,
        }).catch(() => undefined);
      }
    },
    removeProject: (userId, projectId) => {
      const key = catalogKey(userId, projectId);
      const refreshing = inFlight.has(key);
      if (refreshing) {
        setScope(key, {
          catalog: null,
          loading: true,
          refreshing: true,
          error: "",
        });
        return;
      }
      const scopes = new Map(state.readScopes());
      scopes.delete(key);
      state.replaceScopes(scopes);
    },
  };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Could not load agent capabilities";
}
