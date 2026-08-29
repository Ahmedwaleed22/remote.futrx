// The contract between workspace search state and the UI that drives it.
//
// It lives here rather than on the hook that implements it so a component
// declares a dependency on the *search surface*, not on a particular hook, and
// so each component can name the slice it actually uses: the chips and the
// filter menu take `FilterControl` and cannot reach the query or the results,
// the palette takes the whole thing because it genuinely is the whole surface.

import type { DateFilter } from "./dateRange.ts";
import type { FacetId, FacetOption } from "./facetRegistry.ts";
import type { SearchFilters, SortId } from "./searchQuery.ts";
import type { SearchOutcome } from "./searchResults.ts";

/** One facet resolved for display: its options, what is ticked, and the counts. */
export interface FacetView {
  id: FacetId;
  label: string;
  advanced: boolean;
  emptyHint: string;
  options: FacetOption[];
  selected: string[];
  counts: Map<string, number>;
}

/** The keyword box: the text, and how to change it. */
export interface QueryControl {
  query: string;
  setQuery: (query: string) => void;
}

/** The filter menu and the chips: the selection, and every way to change it. */
export interface FilterControl {
  filters: SearchFilters;
  facetViews: FacetView[];
  activeFilterCount: number;
  hasActiveFilters: boolean;
  sort: SortId;
  setSort: (sort: SortId) => void;
  toggleFacetValue: (facetId: FacetId, value: string) => void;
  setFacetValues: (facetId: FacetId, values: string[]) => void;
  clearFacet: (facetId: FacetId) => void;
  setDateFilter: (date: DateFilter) => void;
  resetFilters: () => void;
  /** Toggled by the filter menu so counts are only computed while it's open. */
  setCountsEnabled: (enabled: boolean) => void;
}

/** What anything that renders results needs, and nothing more. */
export interface ResultsView {
  outcome: SearchOutcome;
  /** True when a keyword or any filter is narrowing the list. */
  isSearching: boolean;
}

/** The full surface, as the provider hands it out. */
export interface WorkspaceSearch extends QueryControl, FilterControl, ResultsView {
  /** Drop the keyword and every filter at once. */
  clearAll: () => void;
}
