import { createAgentCapabilities } from "../../../app/agentCapabilities.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCapabilitiesCatalog } from "../../../models/agentCapabilities.ts";
import { selectAgentCapabilityCatalog } from "./agentCapabilityCatalogStore.ts";

function catalog(label: string): AgentCapabilitiesCatalog {
  return {
    providers: [
      {
        provider: "claude",
        label,
        source: "live",
        models: [],
        modes: [],
      },
    ],
  };
}

function read(
  store: ReturnType<typeof createAgentCapabilities>,
  userId: string,
  projectId?: string,
) {
  return selectAgentCapabilityCatalog(
    userId,
    projectId,
  )(store.store.getState());
}

test("keeps the previous response visible while consulting the shared backend cache", async () => {
  let resolveRefresh: ((value: AgentCapabilitiesCatalog) => void) | undefined;
  let calls = 0;
  const store = createAgentCapabilities(async () => {
    calls++;
    if (calls === 1) return catalog("initial");
    return new Promise((resolve) => {
      resolveRefresh = resolve;
    });
  });
  await store.catalog.load("user@example.com", "project-1");

  const refreshing = store.catalog.load("user@example.com", "project-1");
  const current = read(store, "user@example.com", "project-1");
  assert.equal(current.catalog?.providers[0]?.label, "initial");
  assert.equal(current.loading, false);
  assert.equal(current.refreshing, true);

  resolveRefresh?.(catalog("shared backend response"));
  await refreshing;
  assert.equal(
    read(store, "user@example.com", "project-1").catalog?.providers[0]?.label,
    "shared backend response",
  );
});

test("coalesces simultaneous requests within one browser", async () => {
  let resolveRequest: ((value: AgentCapabilitiesCatalog) => void) | undefined;
  let calls = 0;
  const store = createAgentCapabilities(async () => {
    calls++;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  });

  const first = store.catalog.load("user@example.com", "project-1");
  const second = store.catalog.load("user@example.com", "project-1", {
    force: true,
  });
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveRequest?.(catalog("loaded"));
  await Promise.all([first, second]);
});

test("manual refresh reaches the shared backend refresh path", async () => {
  const refreshValues: Array<boolean | undefined> = [];
  const store = createAgentCapabilities(async (_projectId, options) => {
    refreshValues.push(options?.refresh);
    return catalog("loaded");
  });

  await store.catalog.load("user@example.com", "project-1");
  await store.catalog.load("user@example.com", "project-1", { force: true });
  assert.deepEqual(refreshValues, [false, true]);
});

test("failed requests retain the last visible catalog", async () => {
  let calls = 0;
  const store = createAgentCapabilities(async () => {
    calls++;
    if (calls === 1) return catalog("existing");
    throw new Error("provider unavailable");
  });
  await store.catalog.load("user@example.com", "project-1");
  await assert.rejects(store.catalog.load("user@example.com", "project-1"));

  const snapshot = read(store, "user@example.com", "project-1");
  assert.equal(snapshot.catalog?.providers[0]?.label, "existing");
  assert.equal(snapshot.error, "provider unavailable");
});

test("catalog rendering state remains isolated by user and project", async () => {
  const store = createAgentCapabilities(async (projectId) =>
    catalog(projectId || "host"),
  );
  await store.catalog.load("USER@example.com", "project-1");

  assert.equal(
    read(store, "user@example.com", "project-1").catalog?.providers[0]?.label,
    "project-1",
  );
  assert.equal(read(store, "other@example.com", "project-1").catalog, null);
  assert.equal(read(store, "user@example.com", "project-2").catalog, null);
});

test("polls only observed scopes and publishes fast providers before slow ones", async () => {
  let calls = 0;
  const store = createAgentCapabilities(async () => {
    calls++;
    const response = catalog("fast");
    if (calls === 1)
      response.providers.push({
        ...response.providers[0],
        provider: "codex",
        label: "slow",
        source: "fallback",
        refreshing: true,
      });
    return response;
  });
  const unobserve = store.catalog.observe("user", "project");
  await store.catalog.load("user", "project");
  assert.equal(read(store, "user", "project").refreshing, true);
  assert.equal(
    read(store, "user", "project").catalog?.providers[0].source,
    "live",
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(calls, 2);
  assert.equal(read(store, "user", "project").refreshing, false);
  unobserve();
});

test("inactive scope cache is bounded and unobserving cancels polling", async () => {
  const store = createAgentCapabilities(async () => ({
    ...catalog("cached"),
    providers: [{ ...catalog("cached").providers[0], refreshing: true }],
  }));
  const unobserve = store.catalog.observe("user", "active");
  await store.catalog.load("user", "active");
  unobserve();
  for (let i = 0; i < 80; i++) await store.catalog.load("user", `project-${i}`);
  assert.ok(store.store.getState().scopes.size <= 32);
});
