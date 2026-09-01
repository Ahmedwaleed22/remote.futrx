// The one place a keyboard shortcut is bound to the window.
//
// Cmd/Ctrl+P, Cmd/Ctrl+F, and the Escape that closes each overlay had each
// grown their own copy of the same effect: add a `keydown` listener, compare
// `event.key` inline, call the handler, remove the listener. Nine copies meant
// nine chances to spell a chord differently from `config/shortcuts.ts`, and
// several of them needed a hand-rolled ref so the listener could see current
// state without re-registering. Both problems are solved once here.

import { useEffect, useRef } from "preact/hooks";
import type { ShortcutChord } from "../../../models/shortcuts.ts";

export interface ShortcutOptions {
  /** Listen only while true; defaults to always. */
  enabled?: boolean;
  /**
   * Listen on the way down instead of on the way back up.
   *
   * Two surfaces can both want the same chord -- Escape closes find-in-chat,
   * and the Escape underneath it cancels a streaming reply. A capturing
   * listener runs before every bubbling one, so the surface on top claims the
   * chord first and calls `stopPropagation()` to keep the one below from also
   * acting on it.
   */
  capture?: boolean;
}

/**
 * Run `onMatch` whenever a `keydown` on the window matches `matches`.
 *
 * `matches` is one of the predicates from `config/shortcuts.ts`, so the chord
 * itself is described in exactly one place. Neither callback needs to be
 * stable: both are read through a ref, so an inline arrow closing over current
 * state is correct here and does not re-register the listener.
 *
 * The event is handed to `onMatch` rather than pre-empted, because claiming a
 * chord from the browser (`preventDefault`) or from a handler underneath
 * (`stopPropagation`) is the caller's decision, not a property of the chord.
 */
export function useShortcut(
  matches: (chord: ShortcutChord) => boolean,
  onMatch: (event: KeyboardEvent) => void,
  { enabled = true, capture = false }: ShortcutOptions = {}
): void {
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (matchesRef.current(event)) onMatchRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [enabled, capture]);
}
