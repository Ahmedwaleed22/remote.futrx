import assert from "node:assert/strict";
import test from "node:test";
import { textMatchService } from "./textMatchService.ts";

test("folding preserves length so highlight spans stay aligned", () => {
  assert.equal(textMatchService.fold("Café Ünicode").length, "Café Ünicode".length);
  assert.equal(textMatchService.fold("Café"), "cafe");
});

test("tokenizing splits separators and camelCase", () => {
  assert.deepEqual(textMatchService.tokenize("workspaceSidebarState.ts"), [
    "workspace",
    "sidebar",
    "state",
    "ts",
  ]);
  assert.deepEqual(textMatchService.tokenize("remote.futrx"), ["remote", "futrx"]);
});

test("all query tokens must match, so extra words narrow the results", () => {
  const folded = textMatchService.fold("Caddy TLS on-demand ask");
  assert.ok(textMatchService.matchField(folded, ["caddy", "tls"]));
  assert.equal(textMatchService.matchField(folded, ["caddy", "postgres"]), null);
});

// The edit-distance bound is an internal of `matchField`, so it is pinned
// through the contract it serves: a near miss matches, a different word does
// not, and the typo scores below the direct hit it stands in for.
test("bounded typo tolerance accepts near misses and rejects far ones", () => {
  const folded = textMatchService.fold("Sidebar search rewrite");
  const exact = textMatchService.matchField(folded, ["sidebar"]);
  const typo = textMatchService.matchField(folded, ["sidbar"]);
  assert.ok(exact);
  assert.ok(typo);
  assert.ok(typo.score < exact.score);
  assert.equal(textMatchService.matchField(folded, ["toolbar"]), null);
});
