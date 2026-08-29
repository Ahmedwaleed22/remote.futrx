/** The subset of a keyboard event the palette shortcut decision depends on. */
export interface ShortcutChord {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

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
