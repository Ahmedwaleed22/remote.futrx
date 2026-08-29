// Runs a workspace search: facet filtering, keyword scoring, ordering, and the
// per-option counts the filter menu shows.
//
// Everything happens in a single pass over the docs. Facet predicates are
// cheap (Set lookups and integer compares) and run before keyword scoring, so
// narrowing to one project means the expensive stage only sees that project's
// chats.
//
// Both the fields that are scored and the facets that filter come from
// registries (`SEARCH_FIELDS`, `FACET_DEFINITIONS`) rather than being spelled
// out here, so adding either does not touch this file.

import { FACET_DEFINITIONS } from "./facetRegistry.ts";
import { inRange, isDateFilterActive, resolveDateRange } from "./dateRange.ts";
import {
  HIGHLIGHTED_FIELD_INDEX,
  SEARCH_FIELDS,
  SEARCH_FIELD_IDS,
} from "./searchDoc.ts";
import type { ChatSearchDoc } from "./searchDoc.ts";
import type { FacetSelections, SearchFilters, SortId } from "./searchQuery.ts";
import type { FacetCounts, MatchedField, SearchHit, SearchOutcome } from "./searchResults.ts";
import { matchField, tokenize } from "./textMatch.ts";
import type { MatchSpan } from "./textMatch.ts";

const FACET_COUNT = FACET_DEFINITIONS.length;
const ALL_FACETS_MASK = (1 << FACET_COUNT) - 1;
const SEARCH_FIELD_COUNT = SEARCH_FIELDS.length;

// Tie-breakers, kept small so they never outrank a genuinely better match.
const RECENCY_WEIGHT = 18;
const RECENCY_WINDOW_MS = 30 * 86_400_000;
const SECONDARY_FIELD_BONUS = 0.15;

export interface SearchOptions {
  /** Compute per-option facet counts. Only the open filter menu needs these. */
  withCounts?: boolean;
}

interface KeywordScore {
  score: number;
  spans: MatchSpan[];
  field: MatchedField;
}

/**
 * Score one doc against the query across every searchable field, or null when
 * none of them match.
 *
 * The best-matching field counts at full weight and every other matching field
 * adds a small bonus, so a chat matching on both its title and its project
 * outranks one matching on either alone without letting weak fields pile up
 * into a better score than a strong one.
 */
function scoreDoc(doc: ChatSearchDoc, tokens: string[]): KeywordScore | null {
  let best = -1;
  let total = 0;
  let spans: MatchSpan[] = [];
  let field: MatchedField = "none";

  for (let f = 0; f < SEARCH_FIELD_COUNT; f += 1) {
    const hit = matchField(doc.folded[f], tokens);
    if (!hit) continue;

    const value = hit.score * SEARCH_FIELDS[f].weight;
    total += value;
    // Strictly greater, so ties keep the earlier — higher-weighted — field.
    if (value > best) {
      best = value;
      field = SEARCH_FIELD_IDS[f];
    }
    if (f === HIGHLIGHTED_FIELD_INDEX) spans = hit.spans;
  }

  if (best < 0) return null;
  return { score: best + (total - best) * SECONDARY_FIELD_BONUS, spans, field };
}

/**
 * Applies the facet selection to each doc and, optionally, tallies how many
 * docs each option would match.
 *
 * The selection sets, the per-facet flags, and the scratch space for a doc's
 * values are one unit of state that must stay index-aligned with
 * `FACET_DEFINITIONS`, so they live together rather than as parallel arrays
 * threaded through the search loop. Nothing here allocates per doc: the scratch
 * array is reused, and a facet's values are only materialized when it actually
 * filters or is being counted.
 */
class FacetMatcher {
  readonly #selections: ReadonlySet<string>[] = new Array(FACET_COUNT);
  readonly #active: boolean[] = new Array(FACET_COUNT);
  readonly #needValues: boolean[] = new Array(FACET_COUNT);
  readonly #docValues: (readonly string[] | null)[] = new Array(FACET_COUNT).fill(null);
  readonly #counts: FacetCounts;
  readonly #withCounts: boolean;

  constructor(facets: FacetSelections, withCounts: boolean) {
    this.#withCounts = withCounts;
    this.#counts = {} as FacetCounts;

    for (let i = 0; i < FACET_COUNT; i += 1) {
      const facet = FACET_DEFINITIONS[i];
      const selected = facets[facet.id] ?? [];
      this.#selections[i] = new Set(selected);
      this.#active[i] = selected.length > 0;
      this.#needValues[i] = this.#active[i] || withCounts;
      this.#counts[facet.id] = new Map<string, number>();
    }
  }

  /** Every option's match count, valid once every doc has been `accepts`-ed. */
  get counts(): FacetCounts {
    return this.#counts;
  }

  /** True when the doc satisfies every facet. Tallies counts as a side effect. */
  accepts(doc: ChatSearchDoc): boolean {
    let mask = 0;
    for (let i = 0; i < FACET_COUNT; i += 1) {
      if (!this.#needValues[i]) {
        // Nothing selected and no counting: this facet cannot exclude anything.
        mask |= 1 << i;
        this.#docValues[i] = null;
        continue;
      }
      const values = FACET_DEFINITIONS[i].valuesOf(doc);
      this.#docValues[i] = values;
      if (!this.#active[i] || intersects(values, this.#selections[i])) mask |= 1 << i;
    }

    if (this.#withCounts) this.#tally(mask);
    return mask === ALL_FACETS_MASK;
  }

  /**
   * A doc counts toward facet i's options when it passes every *other* facet,
   * so the numbers show what each checkbox would actually add.
   */
  #tally(mask: number): void {
    for (let i = 0; i < FACET_COUNT; i += 1) {
      const others = ALL_FACETS_MASK & ~(1 << i);
      if ((mask & others) !== others) continue;
      const values = this.#docValues[i];
      if (!values) continue;
      const bucket = this.#counts[FACET_DEFINITIONS[i].id];
      for (let v = 0; v < values.length; v += 1) {
        bucket.set(values[v], (bucket.get(values[v]) ?? 0) + 1);
      }
    }
  }
}

function intersects(values: readonly string[], selection: ReadonlySet<string>): boolean {
  for (let i = 0; i < values.length; i += 1) if (selection.has(values[i])) return true;
  return false;
}

function recencyBoost(lastMessageAt: number, now: number): number {
  const age = now - lastMessageAt;
  if (age <= 0) return RECENCY_WEIGHT;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return RECENCY_WEIGHT * (1 - age / RECENCY_WINDOW_MS);
}

function compareHits(left: SearchHit, right: SearchHit, sort: SortId): number {
  switch (sort) {
    case "recent":
      return right.doc.chat.lastMessageAt - left.doc.chat.lastMessageAt;
    case "oldest":
      return left.doc.chat.lastMessageAt - right.doc.chat.lastMessageAt;
    case "title":
      return (left.doc.chat.title || "").localeCompare(right.doc.chat.title || "");
    case "relevance":
    default:
      if (right.score !== left.score) return right.score - left.score;
      return right.doc.chat.lastMessageAt - left.doc.chat.lastMessageAt;
  }
}

export function runSearch(
  docs: readonly ChatSearchDoc[],
  filters: SearchFilters,
  query: string,
  sort: SortId,
  now: number,
  options: SearchOptions = {}
): SearchOutcome {
  const tokens = tokenize(query);
  const scoring = tokens.length > 0;
  const facets = new FacetMatcher(filters.facets, options.withCounts === true);
  const hits: SearchHit[] = [];

  const range = isDateFilterActive(filters.date)
    ? resolveDateRange(filters.date, now)
    : null;
  const dateField = filters.date.field;

  for (let d = 0; d < docs.length; d += 1) {
    const doc = docs[d];

    if (range) {
      const at = dateField === "createdAt" ? doc.chat.createdAt : doc.chat.lastMessageAt;
      if (!inRange(at || 0, range)) continue;
    }

    let keyword: KeywordScore | null = null;
    if (scoring) {
      keyword = scoreDoc(doc, tokens);
      if (!keyword) continue;
    }

    // Counting happens inside `accepts`, so it sees only docs that already
    // passed the date window and the keyword — the same set the list shows.
    if (!facets.accepts(doc)) continue;

    hits.push({
      doc,
      score: (keyword?.score ?? 0) + recencyBoost(doc.chat.lastMessageAt || 0, now),
      titleSpans: keyword?.spans ?? [],
      matchedField: keyword?.field ?? "none",
    });
  }

  const effectiveSort: SortId = sort === "relevance" && !scoring ? "recent" : sort;
  hits.sort((left, right) => compareHits(left, right, effectiveSort));

  return { hits, counts: facets.counts, total: docs.length };
}
