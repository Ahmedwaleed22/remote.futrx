// What the engine hands back. Separate from the query shape so a caller that
// only renders results never sees the filter vocabulary.

import type { ChatSearchDoc, SearchFieldId } from "./searchDoc.ts";
import type { FacetId } from "./facetRegistry.ts";
import type { MatchSpan } from "../../models/search.ts";

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
  /**
   * Whether `counts` were actually tallied. Counting is opt-in, and an empty
   * count map otherwise reads the same as one where nothing matched -- callers
   * that narrow by the counts have to tell those apart, and asking the outcome
   * beats carrying the answer alongside it.
   */
  counted: boolean;
  /** Total chats considered before any filtering. */
  total: number;
}
