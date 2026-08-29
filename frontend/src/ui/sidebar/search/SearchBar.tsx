import { useRef, useState } from "preact/hooks";
import type { FilterControl, QueryControl } from "../../../state/search/searchController";
import { useDismissOnOutside } from "../../primitives/popover";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { FilterPanel } from "./FilterPanel";
import { Search, SlidersHorizontal, X } from "../../primitives/icons";

/**
 * The sidebar search row: a plain keyword input plus the filter menu trigger.
 *
 * Keeping the input free of query syntax is deliberate — the filters live
 * behind a discoverable button so nobody has to learn a grammar to use them.
 */
export function SearchBar({
  search,
  resultCount,
}: {
  search: QueryControl & FilterControl;
  resultCount: number;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useDismissOnOutside(filtersOpen, () => setFiltersOpen(false), rootRef);

  const showClear = search.query.length > 0;

  return (
    <div ref={rootRef} class="relative mt-3">
      <div class="flex items-center gap-1.5">
        <label class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#0b0d11] px-3 transition-colors focus-within:border-accent-blue/70">
          <Search class="h-4 w-4 flex-none text-ink-300" />
          <input
            ref={inputRef}
            value={search.query}
            onInput={(event) => search.setQuery((event.currentTarget as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              if (!search.query) return;
              // Clear the query before letting Escape bubble out and close the
              // whole sidebar — one Escape, one obvious effect.
              event.stopPropagation();
              search.setQuery("");
            }}
            placeholder="Search chats and projects"
            class="min-w-0 flex-1 bg-transparent text-[14px] text-ink-100 placeholder:text-ink-300 focus:outline-none"
            autocomplete="off"
            spellcheck={false}
            aria-label="Search chats and projects"
          />
          {showClear && (
            <button
              type="button"
              onClick={() => {
                search.setQuery("");
                inputRef.current?.focus();
              }}
              class="grid h-7 w-7 flex-none place-items-center rounded text-ink-300 hover:bg-white/10 hover:text-ink-100 transition-colors"
              aria-label="Clear search"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          class={`relative grid h-10 w-10 flex-none place-items-center rounded-md transition-colors
                  ${filtersOpen || search.hasActiveFilters
                    ? "bg-accent-blue/[0.16] text-accent-blue"
                    : "bg-white/5 text-ink-200 hover:bg-white/[0.09] hover:text-ink-50"}`}
          aria-label="Filters"
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          title="Filters"
        >
          <SlidersHorizontal class="h-4 w-4" />
          {search.activeFilterCount > 0 && (
            <span class="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-blue px-1 text-[9.5px] font-bold leading-none text-[#0f1014]">
              {search.activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <ActiveFilterChips search={search} />

      {filtersOpen && (
        <div class="absolute left-0 right-0 top-full z-50 mt-1.5">
          <FilterPanel
            search={search}
            resultCount={resultCount}
            onClose={() => setFiltersOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
