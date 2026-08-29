import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMeta } from "../../../models/chat";
import type { ProjectMeta } from "../../../models/project";
import { buildSearchIndex } from "../../search/searchDoc";
import { runSearch } from "../../search/searchEngine";
import { FACET_DEFINITIONS, offerableOptions, optionsForFacet } from "../../search/facetRegistry";
import type { FacetId } from "../../search/facetRegistry";
import { isDateFilterActive } from "../../search/dateRange";
import type { DateFilter } from "../../search/dateRange";
import { countActiveFacets, defaultFilters } from "../../search/searchQuery";
import type { SearchFilters, SortId } from "../../search/searchQuery";
import type { FacetView, WorkspaceSearch } from "../../search/searchController";
import { storedSearchPreferences } from "../../search/searchFiltersStorage";
import type { SearchPreferences } from "../../search/searchFiltersStorage";

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
  preferences: SearchPreferences = storedSearchPreferences
): WorkspaceSearch {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(() => preferences.readFilters());
  const [sort, setSortState] = useState<SortId>(() => preferences.readSort());
  const [countsEnabled, setCountsEnabled] = useState(false);
  const countsRetained = useRef(0);
  const firstRender = useRef(true);

  const docs = useMemo(() => buildSearchIndex(chats, projects), [chats, projects]);

  // `now` is pinned per render pass rather than read inside the engine, so a
  // date-bounded result set can't shift underneath a single render.
  const outcome = useMemo(
    () => runSearch(docs, filters, query, sort, Date.now(), { withCounts: countsEnabled }),
    [docs, filters, query, sort, countsEnabled]
  );

  const facetViews = useMemo<FacetView[]>(
    () =>
      FACET_DEFINITIONS.map((facet) => {
        const selected = filters.facets[facet.id] ?? [];
        const counts = outcome.counts[facet.id];
        const options = optionsForFacet(facet, docs);
        return {
          id: facet.id,
          label: facet.label,
          advanced: facet.advanced,
          emptyHint: facet.emptyHint,
          // Scoping a facet by the others needs the counts, and those are only
          // computed while a menu is open. Narrowing without them would empty
          // the list on the frame before the first count arrives.
          options: countsEnabled ? offerableOptions(options, counts, selected) : options,
          selected,
          counts,
        };
      }),
    [docs, filters, outcome, countsEnabled]
  );

  useEffect(() => {
    // Skip the write triggered by hydrating from storage on mount.
    if (firstRender.current) {
      firstRender.current = false;
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
    setFilters((current) => {
      const selected = current.facets[facetId] ?? [];
      const next = selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value];
      return { ...current, facets: { ...current.facets, [facetId]: next } };
    });
  }, []);

  const setFacetValues = useCallback((facetId: FacetId, values: string[]) => {
    setFilters((current) => ({
      ...current,
      facets: { ...current.facets, [facetId]: values },
    }));
  }, []);

  const clearFacet = useCallback((facetId: FacetId) => {
    setFilters((current) => ({
      ...current,
      facets: { ...current.facets, [facetId]: [] },
    }));
  }, []);

  const setDateFilter = useCallback((date: DateFilter) => {
    setFilters((current) => ({ ...current, date }));
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

  const resetFilters = useCallback(() => setFilters(defaultFilters()), []);

  const clearAll = useCallback(() => {
    setQuery("");
    setFilters(defaultFilters());
  }, []);

  const activeFilterCount =
    countActiveFacets(filters.facets) + (isDateFilterActive(filters.date) ? 1 : 0);

  return {
    query,
    setQuery,
    filters,
    sort,
    setSort,
    outcome,
    facetViews,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    isSearching: query.trim().length > 0 || activeFilterCount > 0,
    toggleFacetValue,
    setFacetValues,
    clearFacet,
    setDateFilter,
    resetFilters,
    clearAll,
    retainCounts,
  };
}
