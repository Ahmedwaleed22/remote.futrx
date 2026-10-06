import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCapabilitiesCatalog } from "../../../models/agentCapabilities.ts";
import {
  createAgentCapabilityCatalogStore,
  selectAgentCapabilityCatalog,
} from "./agentCapabilityCatalogStore.ts";

function catalog(label: string): AgentCapabilitiesCatalog {
  return {
    providers: [{
      provider: "claude",
      label,
      source: "live",
      models: [],
      modes: [],
    }],
  };
}

function read(
  store: ReturnType<typeof createAgentCapabilityCatalogStore>,
  userId: string,
  projectId?: string,
) {
  return selectAgentCapabilityCatalog(userId, projectId)(store.getState());
}

test("keeps the previous response visible while consulting the shared backend cache", async () => {
  let resolveRefresh: ((value: AgentCapabilitiesCatalog) => void) | undefined;
  let calls = 0;
  const store = createAgentCapabilityCatalogStore(async () => {
    calls++;
    if (calls === 1) return catalog("initial");
    return new Promise((resolve) => { resolveRefresh = resolve; });
  });
  await store.getState().load("user@example.com", "project-1");

  const refreshing = store.getState().load("user@example.com", "project-1");
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
  const store = createAgentCapabilityCatalogStore(async () => {
    calls++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  });

  const first = store.getState().load("user@example.com", "project-1");
  const second = store.getState().load("user@example.com", "project-1", { force: true });
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveRequest?.(catalog("loaded"));
  await Promise.all([first, second]);
});

test("manual refresh reaches the shared backend refresh path", async () => {
  const refreshValues: Array<boolean | undefined> = [];
  const store = createAgentCapabilityCatalogStore(async (_projectId, options) => {
    refreshValues.push(options?.refresh);
    return catalog("loaded");
  });

  await store.getState().load("user@example.com", "project-1");
  await store.getState().load("user@example.com", "project-1", { force: true });
  assert.deepEqual(refreshValues, [false, true]);
});

test("failed requests retain the last visible catalog", async () => {
  let calls = 0;
  const store = createAgentCapabilityCatalogStore(async () => {
    calls++;
    if (calls === 1) return catalog("existing");
    throw new Error("provider unavailable");
  });
  await store.getState().load("user@example.com", "project-1");
  await assert.rejects(store.getState().load("user@example.com", "project-1"));

  const snapshot = read(store, "user@example.com", "project-1");
  assert.equal(snapshot.catalog?.providers[0]?.label, "existing");
  assert.equal(snapshot.error, "provider unavailable");
});

test("catalog rendering state remains isolated by user and project", async () => {
  const store = createAgentCapabilityCatalogStore(async (projectId) => catalog(projectId || "host"));
  await store.getState().load("USER@example.com", "project-1");

  assert.equal(
    read(store, "user@example.com", "project-1").catalog?.providers[0]?.label,
    "project-1",
  );
  assert.equal(read(store, "other@example.com", "project-1").catalog, null);
  assert.equal(read(store, "user@example.com", "project-2").catalog, null);
});

test("polls only observed scopes and publishes fast providers before slow ones", async () => {
 let calls=0;
 const store=createAgentCapabilityCatalogStore(async()=>{
  calls++;
  const response=catalog("fast");
  if(calls===1)response.providers.push({...response.providers[0],provider:"codex",label:"slow",source:"fallback",refreshing:true});
  return response;
 });
 const unobserve=store.getState().observe("user", "project");
 await store.getState().load("user","project");
 assert.equal(read(store,"user","project").refreshing,true);
 assert.equal(read(store,"user","project").catalog?.providers[0].source,"live");
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(calls,2);
 assert.equal(read(store,"user","project").refreshing,false);
 unobserve();
});

test("inactive scope cache is bounded and unobserving cancels polling",async()=>{
 const store=createAgentCapabilityCatalogStore(async()=>({...catalog("cached"),providers:[{...catalog("cached").providers[0],refreshing:true}]}));
 const unobserve=store.getState().observe("user","active");
 await store.getState().load("user","active");
 unobserve();
 for(let i=0;i<80;i++)await store.getState().load("user",`project-${i}`);
 assert.ok(store.getState().scopes.size<=32);
});
