// Escape, bound for one dismissible surface.
//
// Eight surfaces close on Escape -- find-in-chat, a menu, four modals, the
// mobile sidebar, a streaming reply. Each was pairing `useShortcut` with
// `isDismissShortcut` itself, and the ones sitting above another had to
// remember to stop the event as well. Naming the pairing says the intent once
// and leaves the half-done version of it -- claiming the key first and then
// letting the surface underneath act on the same press -- unrepresentable.

import { isDismissShortcut } from "../../../config/shortcuts.ts";
import { useShortcut } from "./useShortcut.ts";

export interface DismissOptions {
  /** Listen only while the surface is on screen; defaults to always. */
  enabled?: boolean;
  /**
   * This surface sits in front of another that also closes on Escape.
   *
   * It then takes the key on the way down and stops it there, so one press
   * closes one surface: the menu inside a drawer without the drawer, or
   * find-in-chat without also cancelling the reply streaming behind it.
   */
  topmost?: boolean;
}

/**
 * Dismiss on Escape.
 *
 * The event is handed on, because whether Escape also has a browser default
 * worth suppressing depends on what the surface has focused -- a text input
 * behaves differently from a menu -- and is not a property of the chord.
 */
export function useDismissShortcut(
  onDismiss: (event: KeyboardEvent) => void,
  { enabled = true, topmost = false }: DismissOptions = {}
): void {
  useShortcut(
    isDismissShortcut,
    (event) => {
      if (topmost) event.stopPropagation();
      onDismiss(event);
    },
    { enabled, capture: topmost }
  );
}
