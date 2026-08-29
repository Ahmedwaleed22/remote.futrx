import { useEffect, useRef, useState } from "preact/hooks";
import type { FacetView, FilterControl } from "../../../state/search/searchController";
import { isDateFilterActive } from "../../../state/search/dateRange";
import { SORT_OPTIONS } from "../../../state/search/searchQuery";
import type { SortId } from "../../../state/search/searchQuery";
import { DateRangeControl } from "./DateRangeControl";
import { FilterSection } from "./FilterSection";
import { MultiSelectList } from "./MultiSelectList";
import { X } from "../../primitives/icons";

/** One facet rendered as a collapsible checkbox list. */
function FacetFilterSection({
  facet,
  expanded,
  onToggleSection,
  search,
}: {
  facet: FacetView;
  expanded: boolean;
  onToggleSection: () => void;
  search: FilterControl;
}) {
  return (
    <FilterSection
      label={facet.label}
      expanded={expanded}
      selectedCount={facet.selected.length}
      onToggle={onToggleSection}
      onClear={() => search.clearFacet(facet.id)}
    >
      <MultiSelectList
        options={facet.options}
        selected={facet.selected}
        counts={facet.counts}
        emptyHint={facet.emptyHint}
        filterPlaceholder={`Filter ${facet.label.toLowerCase()}`}
        onToggle={(value) => search.toggleFacetValue(facet.id, value)}
        onSetAll={(values) => search.setFacetValues(facet.id, values)}
      />
    </FilterSection>
  );
}

/**
 * The filter menu. Every section except the date range is generated from the
 * facet registry, so adding a filter there makes it appear here automatically.
 */
export function FilterPanel({
  search,
  resultCount,
  onClose,
}: {
  search: FilterControl;
  resultCount: number;
  onClose: () => void;
}) {
  // Keyed by section: every facet id, plus "date" and "advanced" for the two
  // sections that aren't facets. Facet ids never collide with those two.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    project: true,
    date: true,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Counts are only worth computing while this menu is on screen.
  const { setCountsEnabled } = search;
  useEffect(() => {
    setCountsEnabled(true);
    return () => setCountsEnabled(false);
  }, [setCountsEnabled]);

  // Move focus into the panel so keyboard and screen-reader users land here.
  useEffect(() => {
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  function toggleSection(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  }

  const basicFacets = search.facetViews.filter((facet) => !facet.advanced);
  const advancedFacets = search.facetViews.filter((facet) => facet.advanced);
  const dateActive = isDateFilterActive(search.filters.date);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Search filters"
      class="theme-menu-surface flex max-h-[min(70vh,32rem)] flex-col overflow-hidden rounded-lg
             border border-white/10 bg-[#14161d] shadow-2xl focus:outline-none"
    >
      <header class="flex flex-none items-center gap-2 border-b border-white/10 px-3 py-2">
        <span class="text-[12px] font-semibold text-ink-50">Filters</span>
        {search.hasActiveFilters && (
          <button
            type="button"
            onClick={search.resetFilters}
            class="rounded px-1.5 py-0.5 text-[11px] text-ink-300 hover:bg-white/[0.08] hover:text-ink-50 transition-colors"
          >
            Reset all
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          class="ml-auto grid h-6 w-6 flex-none place-items-center rounded text-ink-300 hover:bg-white/10 hover:text-ink-50 transition-colors"
          aria-label="Close filters"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto touch-scroll scrollbar-thin px-1 py-1">
        {basicFacets.map((facet) => (
          <FacetFilterSection
            key={facet.id}
            facet={facet}
            expanded={expanded[facet.id] === true}
            onToggleSection={() => toggleSection(facet.id)}
            search={search}
          />
        ))}

        <FilterSection
          label="Date"
          expanded={expanded.date === true}
          selectedCount={dateActive ? 1 : 0}
          onToggle={() => toggleSection("date")}
          onClear={() => search.setDateFilter({ preset: "any", field: search.filters.date.field })}
        >
          <DateRangeControl value={search.filters.date} onChange={search.setDateFilter} />
        </FilterSection>

        <FilterSection
          label="Advanced"
          expanded={expanded.advanced === true}
          selectedCount={advancedFacets.reduce((total, facet) => total + facet.selected.length, 0)}
          onToggle={() => toggleSection("advanced")}
        >
          <div class="space-y-1">
            {advancedFacets.map((facet) => (
              <FacetFilterSection
                key={facet.id}
                facet={facet}
                expanded={expanded[facet.id] === true}
                onToggleSection={() => toggleSection(facet.id)}
                search={search}
              />
            ))}
          </div>
        </FilterSection>
      </div>

      <footer class="flex flex-none items-center gap-2 border-t border-white/10 px-2.5 py-2">
        <span class="text-[11.5px] text-ink-300">
          {resultCount} chat{resultCount === 1 ? "" : "s"}
        </span>
        <label class="ml-auto flex items-center gap-1.5 text-[11px] text-ink-400">
          Sort
          <select
            value={search.sort}
            onChange={(event) =>
              search.setSort((event.currentTarget as HTMLSelectElement).value as SortId)
            }
            class="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-[11px] text-ink-100
                   focus:outline-none focus:border-accent-blue/60"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </footer>
    </div>
  );
}
