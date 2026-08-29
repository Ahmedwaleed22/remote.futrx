// Painting find matches without touching the DOM.
//
// The CSS Custom Highlight API styles live Ranges, so matches can be marked
// inside rendered markdown without wrapping anything in <mark> -- no reflow, no
// risk of splitting an element the markdown renderer built, and nothing to undo
// when the query changes. Browsers without it (Safari before 17.2) simply show
// no highlight; find still counts, navigates and scrolls.

/** The slice of the Custom Highlight API this module uses. */
interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
type HighlightConstructor = new (...ranges: Range[]) => unknown;

const ALL = "chat-find";
const CURRENT = "chat-find-current";

function registry(): HighlightRegistry | null {
  const api = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const constructor = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  return api?.highlights && constructor ? api.highlights : null;
}

/** Mark every match, and the current one on top of it. */
export function paintFindHighlights(all: readonly Range[], current: Range | null): void {
  const highlights = registry();
  if (!highlights) return;
  const Ctor = (globalThis as { Highlight?: HighlightConstructor }).Highlight!;
  // The current match is registered separately rather than excluded from
  // `all`, so its own rule wins by being the later-registered highlight.
  highlights.set(ALL, new Ctor(...all));
  if (current) highlights.set(CURRENT, new Ctor(current));
  else highlights.delete(CURRENT);
}

export function clearFindHighlights(): void {
  const highlights = registry();
  if (!highlights) return;
  highlights.delete(ALL);
  highlights.delete(CURRENT);
}
