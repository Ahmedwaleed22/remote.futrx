// What the engine hands back. Separate from the query shape so a caller that
// only renders results never sees the filter vocabulary.

import type { ChatSearchDoc, SearchFieldId } from "./searchDoc.ts";
import type { FacetId } from "./facetRegistry.ts";
import type { MatchSpan } from "./textMatch.ts";

/** Which field carried the match, for the "why did this match" line. */
export type MatchedField = SearchFieldId | "none";

export interface SearchHit {
  doc: ChatSearchDoc;
  score: number;
  /** Highlight spans against `chat.title`. Empty when the title didn't match. */
  titleSpans: MatchSpan[];
  matchedField: MatchedField;
}

/** Per-option result counts, computed against every *other* active facet. */
export type FacetCounts = Record<FacetId, Map<string, number>>;

export interface SearchOutcome {
  hits: SearchHit[];
  counts: FacetCounts;
  /** Total chats considered before any filtering. */
  total: number;
}
