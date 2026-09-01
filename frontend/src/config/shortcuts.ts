/** The keyboard chords this app claims, and what each one opens. */

import type { ShortcutChord } from "../models/search.ts";

/**
 * Cmd/Ctrl+P (VS Code's quick open) or Cmd/Ctrl+K opens the search palette.
 *
 * Cmd/Ctrl+Shift+P is deliberately left alone: it is the conventional "command
 * palette" chord, and swallowing it would break the browser's handling of a
 * shortcut this app does not implement.
 */
export function isPaletteShortcut(event: ShortcutChord): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "p" && key !== "k") return false;
  if (key === "p" && event.shiftKey) return false;
  return true;
}

/**
 * Cmd/Ctrl+F opens find-in-chat.
 *
 * It deliberately takes the browser's own find, because the two would otherwise
 * compete over the same thread: the native one cannot reach messages the list
 * has not rendered, and it searches the sidebar and composer alongside them.
 */
export function isFindShortcut(event: ShortcutChord): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === "f";
}
