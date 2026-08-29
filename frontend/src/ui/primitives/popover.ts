// Shared popover dismissal behaviour.
//
// `ComposerOptionDropdown`, `SkillPicker`, and `WorkspaceActions` each grew
// their own copy of this logic. New menus use these hooks instead of adding a
// fourth; the existing three can be migrated onto them separately.

import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

/** Close on an outside pointer press or Escape, while `open`. */
export function useDismissOnOutside(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement>
): void {
  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePress(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) onClose();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Stop the sidebar's own Escape handler from also closing the drawer.
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("mousedown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, onClose, rootRef]);
}
