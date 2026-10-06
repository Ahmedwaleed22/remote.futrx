import assert from "node:assert/strict";
import test from "node:test";
import { TextFoldService, textFoldService } from "./textFoldService.ts";

test("folding preserves length so highlight spans stay aligned", () => {
  assert.equal(textFoldService.fold("Café Ünicode").length, "Café Ünicode".length);
  assert.equal(textFoldService.fold("Café"), "cafe");
  // Scripts with their own casing, marks, or none of either keep their length,
  // including the locale cases where lowercasing alone would not.
  for (const sample of ["İstanbul", "مُحَمَّد", "Привет ЖУРНАЛ", "工作区 · 検索", "🚀 ship"]) {
    assert.equal(textFoldService.fold(sample).length, sample.length, sample);
  }
});

test("folding settles Arabic spelling variants and digits", () => {
  // Hamza carriers via NFD, alef maksura/teh marbuta via the equivalence table.
  assert.equal(textFoldService.fold("أحمد"), textFoldService.fold("احمد"));
  assert.equal(textFoldService.fold("مدرسة"), textFoldService.fold("مدرسه"));
  assert.equal(textFoldService.fold("علي"), textFoldService.fold("على"));
  assert.equal(textFoldService.fold("٥٧"), "57");
});

test("find-in-chat cannot retain large transcript strings in the global fold cache", () => {
 const fold = new TextFoldService();
 fold.fold("a".repeat(100_000));
 assert.equal(fold.cachedCharacters, 0);
 for (let i=0;i<300;i++) fold.fold(`${i}-${"text".repeat(2000)}`);
 assert.ok(fold.cachedCharacters <= 1_000_000);
 assert.equal(fold.fold("Café"), "cafe");
});
