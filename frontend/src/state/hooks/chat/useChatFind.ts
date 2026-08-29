import { useCallback, useEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { findRanges } from "../../../ui/chat/find/findRanges";
import {
  clearFindHighlights,
  paintFindHighlights,
} from "../../../ui/chat/find/chatFindHighlight";
import { isFindShortcut } from "../../search/searchShortcuts";

/** Keep the match this far from the scroller's edges when revealing it. */
const REVEAL_MARGIN = 80;

export interface ChatFind {
  open: boolean;
  query: string;
  /** 0-based position of the current match; -1 when there are none. */
  index: number;
  matchCount: number;
  setQuery: (query: string) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
}

/** Scroll `range` into view inside `scroller`, and nothing else. */
function reveal(scroller: HTMLElement | null, range: Range): void {
  if (!scroller) return;
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return;
  if (rect.top >= box.top + REVEAL_MARGIN && rect.bottom <= box.bottom - REVEAL_MARGIN) return;
  // Deliberately not `scrollIntoView`: that walks up and scrolls every
  // scrollable ancestor, including the workspace card, which would drag the
  // thread's own header out of view.
  scroller.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
}

/**
 * Find-in-chat: the query, where you are in the results, and the highlighting.
 *
 * Matches come from the rendered thread rather than the message model, so what
 * it counts is exactly what is on screen -- see `findRanges`. `revision` is any
 * value that changes when the thread's content does, so a match list cannot go
 * stale against a streaming reply.
 */
export function useChatFind({
  scrollRef,
  contentRef,
  revision,
}: {
  scrollRef: RefObject<HTMLDivElement>;
  contentRef: RefObject<HTMLDivElement>;
  revision: number;
}): ChatFind {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isFindShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A new query starts from the first match rather than wherever the last one
  // left off.
  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    if (!open || !contentRef.current) {
      setMatchCount(0);
      clearFindHighlights();
      return;
    }
    const ranges = findRanges(contentRef.current, query);
    setMatchCount(ranges.length);
    if (ranges.length === 0) {
      clearFindHighlights();
      return;
    }
    // Content can shrink under a held cursor (a message collapsing, older
    // messages dropping out), so the index is clamped rather than trusted.
    if (index >= ranges.length) {
      setIndex(0);
      return;
    }
    paintFindHighlights(ranges, ranges[index]);
    reveal(scrollRef.current, ranges[index]);
  }, [open, query, index, revision, contentRef, scrollRef]);

  useEffect(() => clearFindHighlights, []);

  const step = useCallback(
    (delta: number) =>
      setIndex((current) => (matchCount === 0 ? 0 : (current + delta + matchCount) % matchCount)),
    [matchCount]
  );

  return {
    open,
    query,
    index: matchCount === 0 ? -1 : index,
    matchCount,
    setQuery,
    next: useCallback(() => step(1), [step]),
    previous: useCallback(() => step(-1), [step]),
    close,
  };
}
