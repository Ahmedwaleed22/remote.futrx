import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatMeta } from "../../../models/chat";
import type { ProjectMeta } from "../../../models/project";
import { buildSearchIndex } from "../../search/searchDoc";
import { runSearch } from "../../search/searchEngine";
import { FACET_DEFINITIONS, optionsForFacet } from "../../search/facetRegistry";
import type { FacetId } from "../../search/facetRegistry";
import { isDateFilterActive } from "../../search/dateRange";
import type { DateFilter } from "../../search/dateRange";
import { countActiveFacets, defaultFilters } from "../../search/searchQuery";
import type { SearchFilters, SortId } from "../../search/searchQuery";
import type { FacetView, WorkspaceSearch } from "../../search/searchController";
import {
  readFilters,
  readSort,
  writeFilters,
  writeSort,
} from "../../search/searchFiltersStorage";

/**
 * Owns workspace search: the keyword, the filter selection, and the derived
 * results.
 *
 * The index is rebuilt only when chats or projects change, so keystrokes pay
 * for comparison alone. Facet counts are computed only while the filter menu is
 * open, since nothing else displays them.
 */
export function useWorkspaceSearch(
  chats: readonly ChatMeta[],
  projects: readonly ProjectMeta[]
): WorkspaceSearch {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(() => readFilters());
  const [sort, setSortState] = useState<SortId>(() => readSort());
  const [countsEnabled, setCountsEnabled] = useState(false);
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
      FACET_DEFINITIONS.map((facet) => ({
        id: facet.id,
        label: facet.label,
        advanced: facet.advanced,
        emptyHint: facet.emptyHint,
        options: optionsForFacet(facet, docs),
        selected: filters.facets[facet.id] ?? [],
        counts: outcome.counts[facet.id],
      })),
    [docs, filters, outcome]
  );

  useEffect(() => {
    // Skip the write triggered by hydrating from storage on mount.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    writeFilters(filters);
  }, [filters]);

  const setSort = useCallback((next: SortId) => {
    setSortState(next);
    writeSort(next);
  }, []);

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
    setCountsEnabled,
  };
}
