// What the user is asking for: the facet selection, the date window, and the
// ordering. Kept apart from the engine that answers it and the registry that
// declares the facets, so the filter shape has one home.

import { ANY_DATE } from "./dateRange.ts";
import type { DateFilter } from "./dateRange.ts";
import { FACET_IDS } from "./facetRegistry.ts";
import type { FacetId } from "./facetRegistry.ts";

export type FacetSelections = Record<FacetId, string[]>;

export interface SearchFilters {
  facets: FacetSelections;
  date: DateFilter;
}

/**
 * Result ordering. The labels live here rather than in the filter menu so the
 * vocabulary has one definition — the menu renders it and storage validates
 * against it.
 */
export const SORT_OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "recent", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "Title" },
] as const;

export type SortId = (typeof SORT_OPTIONS)[number]["value"];

export const SORT_IDS: readonly SortId[] = SORT_OPTIONS.map((option) => option.value);

export const DEFAULT_SORT: SortId = "relevance";

export function emptyFacetSelections(): FacetSelections {
  const selections = {} as FacetSelections;
  for (const id of FACET_IDS) selections[id] = [];
  return selections;
}

export function defaultFilters(): SearchFilters {
  return { facets: emptyFacetSelections(), date: { ...ANY_DATE } };
}

export function countActiveFacets(facets: FacetSelections): number {
  let active = 0;
  for (const id of FACET_IDS) if (facets[id].length > 0) active += 1;
  return active;
}
