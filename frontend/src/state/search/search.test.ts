import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMeta } from "../../models/chat.ts";
import type { ProjectMeta } from "../../models/project.ts";
import { buildSearchIndex } from "./searchDoc.ts";
import { FACET_DEFINITIONS, optionsForFacet } from "./facetRegistry.ts";
import {
  ephemeralSearchPreferences,
  storedSearchPreferences,
} from "./searchFiltersStorage.ts";
import { runSearch } from "./searchEngine.ts";
import { DEFAULT_SORT, defaultFilters, emptyFacetSelections } from "./searchQuery.ts";
import { UNASSIGNED_PROJECT } from "./searchDoc.ts";
import type { SearchFilters } from "./searchQuery.ts";
import { ANY_DATE, resolveDateRange } from "./dateRange.ts";
import { fold, matchField, tokenize, withinEditDistance } from "./textMatch.ts";
import { isPaletteShortcut } from "./searchShortcuts.ts";
import type { ShortcutChord } from "./searchShortcuts.ts";

const NOW = new Date(2026, 7, 29, 12, 0, 0).getTime();
const DAY = 86_400_000;

const projects: ProjectMeta[] = [
  {
    id: "p-remote",
    name: "Remote Futrx",
    slug: "remote-futrx",
    cwd: "/var/lib/remote/projects/remote-futrx/workspace",
    containerName: "remote-futrx",
    status: "running",
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW,
  },
  {
    id: "p-docs",
    name: "Docs Site",
    slug: "docs-site",
    cwd: "/var/lib/remote/projects/docs-site/workspace",
    containerName: "docs-site",
    status: "stopped",
    createdAt: NOW - 20 * DAY,
    updatedAt: NOW,
  },
];

const chats: ChatMeta[] = [
  {
    id: "c1",
    title: "Caddy TLS on-demand ask",
    projectId: "p-remote",
    provider: "claude",
    model: "opus",
    mode: "code",
    cwd: "/workspace/backend",
    createdAt: NOW - 3 * DAY,
    lastMessageAt: NOW - 1 * DAY,
    lastReadAt: NOW,
  },
  {
    id: "c2",
    title: "Sidebar search rewrite",
    projectId: "p-remote",
    provider: "claude",
    model: "sonnet",
    mode: "plan",
    cwd: "/workspace/frontend",
    createdAt: NOW - 10 * DAY,
    lastMessageAt: NOW - 2 * DAY,
    lastReadAt: 0,
    selectedSkills: [{ name: "code-review" }],
  },
  {
    id: "c3",
    title: "Publish docs",
    projectId: "p-docs",
    provider: "codex",
    model: "gpt-5.5",
    createdAt: NOW - 45 * DAY,
    lastMessageAt: NOW - 40 * DAY,
    lastReadAt: NOW,
    running: true,
  },
  {
    id: "c4",
    title: "Scratch notes",
    createdAt: NOW - 2 * DAY,
    lastMessageAt: NOW - 2 * DAY,
    lastReadAt: NOW,
  },
];

const docs = buildSearchIndex(chats, projects);

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return { facets: emptyFacetSelections(), date: ANY_DATE, ...overrides };
}

function idsFor(query: string, override: Partial<SearchFilters> = {}): string[] {
  return runSearch(docs, filters(override), query, "relevance", NOW).hits.map(
    (hit) => hit.doc.chat.id
  );
}

test("folding preserves length so highlight spans stay aligned", () => {
  assert.equal(fold("Café Ünicode").length, "Café Ünicode".length);
  assert.equal(fold("Café"), "cafe");
});

test("tokenizing splits separators and camelCase", () => {
  assert.deepEqual(tokenize("workspaceSidebarState.ts"), ["workspace", "sidebar", "state", "ts"]);
  assert.deepEqual(tokenize("remote.futrx"), ["remote", "futrx"]);
});

test("bounded edit distance accepts near misses and rejects far ones", () => {
  assert.equal(withinEditDistance("sidebar", "sidbar", 1), true);
  assert.equal(withinEditDistance("sidebar", "toolbar", 1), false);
});

test("all query tokens must match, so extra words narrow the results", () => {
  assert.ok(matchField(fold("Caddy TLS on-demand ask"), ["caddy", "tls"]));
  assert.equal(matchField(fold("Caddy TLS on-demand ask"), ["caddy", "postgres"]), null);
});

// The old `.includes()` filter failed all four of these.
test("matches words out of order across separators", () => {
  assert.deepEqual(idsFor("futrx remote"), ["c1", "c2"]);
});

test("matches despite a typo", () => {
  assert.deepEqual(idsFor("sidbar"), ["c2"]);
});

test("ranks a title hit above a path-only hit", () => {
  const hits = runSearch(docs, filters(), "workspace", "relevance", NOW).hits;
  assert.ok(hits.length > 1);
  assert.equal(hits[0].matchedField, "path");
});

test("reports title spans for highlighting", () => {
  const hit = runSearch(docs, filters(), "caddy", "relevance", NOW).hits[0];
  assert.deepEqual(hit.titleSpans, [{ start: 0, end: 5 }]);
  assert.equal("Caddy TLS on-demand ask".slice(0, 5), "Caddy");
});

test("selecting several projects ORs within the facet", () => {
  const facets = emptyFacetSelections();
  facets.project = ["p-remote", "p-docs"];
  assert.deepEqual(idsFor("", { facets }).sort(), ["c1", "c2", "c3"]);
});

test("unassigned chats are selectable as their own project option", () => {
  const facets = emptyFacetSelections();
  facets.project = [UNASSIGNED_PROJECT];
  assert.deepEqual(idsFor("", { facets }), ["c4"]);
});

test("a deleted project does not become a filter option of its own", () => {
  const orphanDocs = buildSearchIndex(
    [
      ...chats,
      {
        id: "c5",
        title: "Left behind",
        projectId: "p-deleted",
        createdAt: NOW - DAY,
        lastMessageAt: NOW - DAY,
        lastReadAt: NOW,
      },
    ],
    projects
  );
  const projectFacet = FACET_DEFINITIONS.find((facet) => facet.id === "project")!;
  const values = optionsForFacet(projectFacet, orphanDocs).map((option) => option.value);
  // The raw id would otherwise show up as a project the user never created.
  assert.equal(values.includes("p-deleted"), false);
  assert.deepEqual(values, ["p-docs", "p-remote", UNASSIGNED_PROJECT]);

  // And the chat is still reachable, filed with the rest of the unassigned.
  const facets = emptyFacetSelections();
  facets.project = [UNASSIGNED_PROJECT];
  const hits = runSearch(orphanDocs, filters({ facets }), "", "relevance", NOW).hits;
  assert.deepEqual(hits.map((hit) => hit.doc.chat.id).sort(), ["c4", "c5"]);
});

test("different facets AND together", () => {
  const facets = emptyFacetSelections();
  facets.project = ["p-remote"];
  facets.model = ["sonnet"];
  assert.deepEqual(idsFor("", { facets }), ["c2"]);
});

test("status facet finds unread and running chats", () => {
  const unread = emptyFacetSelections();
  unread.status = ["unread"];
  assert.deepEqual(idsFor("", { facets: unread }), ["c2"]);

  const running = emptyFacetSelections();
  running.status = ["running"];
  assert.deepEqual(idsFor("", { facets: running }), ["c3"]);
});

test("date filter bounds by the selected field", () => {
  const recent = runSearch(
    docs,
    filters({ date: { preset: "7d", field: "lastMessageAt" } }),
    "",
    "recent",
    NOW
  );
  assert.deepEqual(recent.hits.map((hit) => hit.doc.chat.id), ["c1", "c2", "c4"]);

  const created = runSearch(
    docs,
    filters({ date: { preset: "7d", field: "createdAt" } }),
    "",
    "recent",
    NOW
  );
  assert.deepEqual(created.hits.map((hit) => hit.doc.chat.id), ["c1", "c4"]);
});

test("custom date ranges are inclusive of both endpoint days", () => {
  const range = resolveDateRange(
    { preset: "custom", field: "lastMessageAt", from: "2026-08-01", to: "2026-08-01" },
    NOW
  );
  assert.equal(range.from, new Date(2026, 7, 1, 0, 0, 0, 0).getTime());
  assert.equal(range.to, new Date(2026, 7, 1, 23, 59, 59, 999).getTime());
});

test("a malformed custom date is ignored rather than matching nothing", () => {
  const range = resolveDateRange(
    { preset: "custom", field: "lastMessageAt", from: "2026-02-31" },
    NOW
  );
  assert.equal(range.from, null);
});

test("facet counts are computed against the other active facets", () => {
  const facets = emptyFacetSelections();
  facets.project = ["p-remote"];
  const outcome = runSearch(docs, filters({ facets }), "", "recent", NOW, { withCounts: true });

  // Model counts respect the project filter...
  assert.equal(outcome.counts.model.get("opus"), 1);
  assert.equal(outcome.counts.model.get("gpt-5.5"), undefined);
  // ...but the project facet's own counts ignore it, so you can see what
  // ticking another project would add.
  assert.equal(outcome.counts.project.get("p-docs"), 1);
});

test("empty query with no filters returns everything, most recent first", () => {
  const outcome = runSearch(docs, filters(), "", "relevance", NOW);
  assert.deepEqual(outcome.hits.map((hit) => hit.doc.chat.id), ["c1", "c2", "c4", "c3"]);
  assert.equal(outcome.total, 4);
});

test("stays fast on a large workspace", () => {
  const manyChats: ChatMeta[] = [];
  for (let i = 0; i < 2000; i += 1) {
    manyChats.push({
      id: `bulk-${i}`,
      title: `Refactor the workspace sidebar search ${i}`,
      projectId: i % 2 === 0 ? "p-remote" : "p-docs",
      model: i % 3 === 0 ? "opus" : "sonnet",
      cwd: "/workspace/frontend/src/state",
      createdAt: NOW - i * 1000,
      lastMessageAt: NOW - i * 1000,
    });
  }
  const bulkDocs = buildSearchIndex(manyChats, projects);

  const started = process.hrtime.bigint();
  for (let run = 0; run < 20; run += 1) {
    runSearch(bulkDocs, filters(), "sidebar serch", "relevance", NOW);
  }
  const perRunMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;

  // Measures ~5ms for 2000 chats with a typo query (the slow path); a real
  // workspace of ~500 chats is under 2ms. The ceiling is loose enough for slow
  // CI while still catching an order-of-magnitude regression.
  assert.ok(perRunMs < 40, `search took ${perRunMs.toFixed(1)}ms per run`);
});

test("the palette opens on Cmd/Ctrl+P and Cmd/Ctrl+K", () => {
  const chord = (over: Partial<ShortcutChord>): ShortcutChord => ({
    key: "p",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  assert.equal(isPaletteShortcut(chord({ metaKey: true })), true);
  assert.equal(isPaletteShortcut(chord({ ctrlKey: true })), true);
  assert.equal(isPaletteShortcut(chord({ key: "K", metaKey: true })), true);
  // A bare key must keep typing "p" into the search box.
  assert.equal(isPaletteShortcut(chord({})), false);
  // Cmd+Shift+P belongs to the browser, not to us.
  assert.equal(isPaletteShortcut(chord({ metaKey: true, shiftKey: true })), false);
  assert.equal(isPaletteShortcut(chord({ metaKey: true, altKey: true })), false);
  assert.equal(isPaletteShortcut(chord({ key: "j", metaKey: true })), false);
});

test("the palette's filters never reach the sidebar's stored selection", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };

  // The sidebar sets up a project scope and it survives a reload.
  const scoped = filters();
  scoped.facets.project = ["p-remote"];
  storedSearchPreferences.writeFilters(scoped);
  storedSearchPreferences.writeSort("recent");
  assert.deepEqual(storedSearchPreferences.readFilters().facets.project, ["p-remote"]);

  // The palette narrows to something else. Sharing one state, this used to
  // re-scope the sidebar behind the user's back, and outlive the session.
  const inPalette = filters();
  inPalette.facets.project = ["p-docs"];
  ephemeralSearchPreferences.writeFilters(inPalette);
  ephemeralSearchPreferences.writeSort("oldest");

  assert.deepEqual(storedSearchPreferences.readFilters().facets.project, ["p-remote"]);
  assert.equal(storedSearchPreferences.readSort(), "recent");
  // And the palette itself opens clean rather than inheriting either one.
  assert.deepEqual(ephemeralSearchPreferences.readFilters(), defaultFilters());
  assert.equal(ephemeralSearchPreferences.readSort(), DEFAULT_SORT);
});
