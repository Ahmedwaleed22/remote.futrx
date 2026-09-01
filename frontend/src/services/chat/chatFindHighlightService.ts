// Showing where find-in-chat's matches are, in a thread that is already
// rendered.
//
// Two concerns the find state should not have to hold: which CSS highlight
// layers the matches are painted into, and how a match is brought into view
// without disturbing anything else on the page. Both are about the document,
// so they live together here and the hook keeps only the query and the cursor.

import { CHAT_FIND_REVEAL_MARGIN } from "../../config/chat.ts";
import { clearHighlight, paintHighlight } from "../platform/textHighlight.ts";

// Two layers so the current match reads differently from the rest. The current
// one is painted separately rather than held out of `ALL`, so its rule wins by
// being registered second. Styled in index.css as `::highlight(...)`; these
// names and those selectors have to stay in step.
const ALL_MATCHES = "chat-find";
const CURRENT_MATCH = "chat-find-current";

class ChatFindHighlightService {
  /** Paint every match, with `current` marked out among them. */
  show(matches: readonly Range[], current: Range | null): void {
    paintHighlight(ALL_MATCHES, matches);
    if (current) paintHighlight(CURRENT_MATCH, [current]);
    else clearHighlight(CURRENT_MATCH);
  }

  clear(): void {
    clearHighlight(ALL_MATCHES);
    clearHighlight(CURRENT_MATCH);
  }

  /** Scroll `range` into view inside `scroller`, and nothing else. */
  reveal(scroller: HTMLElement | null, range: Range): void {
    if (!scroller) return;
    const rect = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) return;
    if (
      rect.top >= box.top + CHAT_FIND_REVEAL_MARGIN &&
      rect.bottom <= box.bottom - CHAT_FIND_REVEAL_MARGIN
    ) {
      return;
    }
    // Deliberately not `scrollIntoView`: that walks up and scrolls every
    // scrollable ancestor, including the workspace card, which would drag the
    // thread's own header out of view.
    scroller.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
  }
}

export const chatFindHighlightService = new ChatFindHighlightService();
