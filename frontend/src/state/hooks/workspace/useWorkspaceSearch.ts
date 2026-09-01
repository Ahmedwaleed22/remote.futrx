import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMeta } from "../../../models/chat.ts";
import type { ProjectMeta } from "../../../models/project.ts";
import type {
  DateFilter,
  DateFilterView,
  FacetId,
  FacetView,
  SearchFilters,
  SearchHit,
  SearchOutcome,
  SearchPreferences,
  SortId,
} from "../../../models/search.ts";
import { searchFilterService } from "../../../services/workspace/searchFilterService.ts";
import { searchPreferenceService } from "../../../services/workspace/searchPreferenceService.ts";
import { workspaceSearchService } from "../../../services/workspace/workspaceSearchService.ts";

/** The keyword box: the text, and how to change it. */
export interface QueryControl {
  query: string;
  setQuery: (query: string) => void;
}

/** The filter menu and the chips: the selection, and every way to change it. */
export interface FilterControl {
  filters: SearchFilters;
  facetViews: FacetView[];
  dateView: DateFilterView;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  sort: SortId;
  setSort: (sort: SortId) => void;
  toggleFacetValue: (facetId: FacetId, value: string) => void;
  setFacetValues: (facetId: FacetId, values: string[]) => void;
  clearFacet: (facetId: FacetId) => void;
  setDateFilter: (date: DateFilter) => void;
  /** Drop the date window, keeping which timestamp the user was asking about. */
  clearDate: () => void;
  resetFilters: () => void;
  /**
   * Ask for per-option facet counts, and release them with the returned
   * function. They are only worth their cost while a filter menu is on screen,
   * and two can be at once -- the sidebar's and the palette's -- so this is a
   * retain count rather than a flag either one could switch off underneath the
   * other.
   */
  retainCounts: () => () => void;
}

/** What anything that renders results needs, and nothing more. */
export interface ResultsView {
  outcome: SearchOutcome;
  /** True when a keyword or any filter is narrowing the list. */
  isSearching: boolean;
  /** Why a hit is in the list, when its title alone doesn't show it. */
  describeMatch: (hit: SearchHit) => string | null;
}

/**
 * The whole search surface. Components take the slice they use: the chips and
 * the filter menu take `FilterControl` and cannot reach the query or the
 * results; the palette takes all of it because it genuinely is all of it.
 */
export interface WorkspaceSearch extends QueryControl, FilterControl, ResultsView {
  /** Drop the keyword and every filter at once. */
  clearAll: () => void;
}

/**
 * Owns workspace search: the keyword, the filter selection, and the derived
 * results.
 *
 * The index is rebuilt only when chats or projects change, so keystrokes pay
 * for comparison alone. Facet counts are computed only while the filter menu is
 * open, since nothing else displays them.
 *
 * Each call owns a separate selection. Two surfaces searching the same chats
 * are two calls, not one shared state -- filtering in the palette leaves the
 * sidebar's scoping alone. `preferences` decides whether that selection
 * outlives the mount.
 */
export function useWorkspaceSearch(
  chats: readonly ChatMeta[],
  projects: readonly ProjectMeta[],
  preferences: SearchPreferences = searchPreferenceService
): WorkspaceSearch {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(() => preferences.readFilters());
  const [sort, setSortState] = useState<SortId>(() => preferences.readSort());
  const [countsEnabled, setCountsEnabled] = useState(false);
  const countsRetained = useRef(0);
  const hydrated = useRef(false);

  const docs = useMemo(
    () => workspaceSearchService.buildIndex(chats, projects),
    [chats, projects]
  );

  // `now` is pinned per render pass rather than read inside the search, so a
  // date-bounded result set can't shift underneath a single render.
  const outcome = useMemo(
    () =>
      workspaceSearchService.run(docs, filters, query, sort, Date.now(), {
        withCounts: countsEnabled,
      }),
    [docs, filters, query, sort, countsEnabled]
  );

  const facetViews = useMemo(
    () => workspaceSearchService.facetViews(docs, filters, outcome),
    [docs, filters, outcome]
  );

  useEffect(() => {
    // Skip the write triggered by hydrating from storage on mount.
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    preferences.writeFilters(filters);
  }, [filters, preferences]);

  const setSort = useCallback(
    (next: SortId) => {
      setSortState(next);
      preferences.writeSort(next);
    },
    [preferences]
  );

  const toggleFacetValue = useCallback((facetId: FacetId, value: string) => {
    setFilters((current) => searchFilterService.toggleFacetValue(current, facetId, value));
  }, []);

  const setFacetValues = useCallback((facetId: FacetId, values: string[]) => {
    setFilters((current) => searchFilterService.withFacetValues(current, facetId, values));
  }, []);

  const clearFacet = useCallback((facetId: FacetId) => {
    setFilters((current) => searchFilterService.clearFacet(current, facetId));
  }, []);

  const setDateFilter = useCallback((date: DateFilter) => {
    setFilters((current) => searchFilterService.withDate(current, date));
  }, []);

  const clearDate = useCallback(() => {
    setFilters((current) =>
      searchFilterService.withDate(current, searchFilterService.clearedDate(current.date))
    );
  }, []);

  const retainCounts = useCallback(() => {
    countsRetained.current += 1;
    setCountsEnabled(true);
    let released = false;
    return () => {
      // Idempotent, so a double release cannot drop the count below the number
      // of menus still open.
      if (released) return;
      released = true;
      countsRetained.current -= 1;
      if (countsRetained.current === 0) setCountsEnabled(false);
    };
  }, []);

  const describeMatch = useCallback(
    (hit: SearchHit) => workspaceSearchService.describeMatch(hit),
    []
  );

  const resetFilters = useCallback(() => setFilters(searchFilterService.defaults()), []);

  const clearAll = useCallback(() => {
    setQuery("");
    setFilters(searchFilterService.defaults());
  }, []);

  const dateView: DateFilterView = {
    active: searchFilterService.isDateActive(filters.date),
    label: searchFilterService.describeDate(filters.date),
  };

  const activeFilterCount = searchFilterService.countActive(filters);

  return {
    query,
    setQuery,
    filters,
    sort,
    setSort,
    outcome,
    facetViews,
    dateView,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    isSearching: query.trim().length > 0 || activeFilterCount > 0,
    describeMatch,
    toggleFacetValue,
    setFacetValues,
    clearFacet,
    setDateFilter,
    clearDate,
    resetFilters,
    clearAll,
    retainCounts,
  };
}
