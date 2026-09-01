import assert from "node:assert/strict";
import test from "node:test";
import type { ShortcutChord } from "../models/search.ts";
import { isPaletteShortcut } from "./shortcuts.ts";

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

