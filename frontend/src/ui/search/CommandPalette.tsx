import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WorkspaceSearch } from "../../state/hooks/workspace/useWorkspaceSearch";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { FilterPanelBody } from "./FilterPanel";
import { PaletteResultRow } from "./PaletteResultRow";
import { Search, SlidersHorizontal } from "../primitives/icons";

// Enough to fill the list without rendering hundreds of rows nobody scrolls to.
const MAX_VISIBLE_RESULTS = 50;

/**
 * Centered spotlight search, opened with Cmd/Ctrl+P or Cmd/Ctrl+K.
 *
 * It shares the sidebar's search state, so any project scoping set in the
 * filter menu also applies here — surfaced as chips rather than left implicit.
 */
export function CommandPalette({
  search,
  open,
  onClose,
  onSelectChat,
}: {
  search: WorkspaceSearch;
  open: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => search.outcome.hits.slice(0, MAX_VISIBLE_RESULTS),
    [search.outcome]
  );

  useEffect(() => {
    if (!open) {
      // A reopened palette starts on the results, never on a stale filter menu.
      setFiltersOpen(false);
      return;
    }
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Any change to the result set invalidates the previous cursor position.
  useEffect(() => setActiveIndex(0), [search.query, search.filters, open]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open || filtersOpen) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, filtersOpen]);

  if (!open) return null;

  function closeFilters() {
    setFiltersOpen(false);
    inputRef.current?.focus();
  }

  function choose(index: number) {
    const hit = results[index];
    if (!hit) return;
    onSelectChat(hit.doc.chat.id);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    // While the filter menu is up it owns the arrows and Enter; Escape steps
    // back to the results rather than closing the palette outright.
    if (filtersOpen) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeFilters();
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) =>
          results.length ? (current - 1 + results.length) % results.length : 0
        );
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, results.length - 1));
        break;
      case "Enter":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  }

  return (
    <div
      class="fixed inset-0 z-[60] flex items-start justify-center overflow-hidden bg-black/55
             px-4 pb-[8vh] pt-[8vh] backdrop-blur-[3px] modal-backdrop-fade sm:pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        class="theme-menu-surface modal-card-pop flex max-h-full w-full max-w-[640px] flex-col
               overflow-hidden rounded-panel border border-line bg-raised shadow-modal"
        onKeyDown={onKeyDown}
      >
        <div class="flex flex-none items-center gap-2.5 border-b border-line px-4 py-3">
          <Search class="h-4 w-4 flex-none text-ink-300" />
          <input
            ref={inputRef}
            value={search.query}
            onInput={(event) => search.setQuery((event.currentTarget as HTMLInputElement).value)}
            placeholder="Search chats and projects"
            class="min-w-0 flex-1 bg-transparent text-[15px] text-ink-50 placeholder:text-ink-400 focus:outline-none"
            autocomplete="off"
            spellcheck={false}
            aria-label="Search chats and projects"
          />
          <button
            type="button"
            onClick={() => (filtersOpen ? closeFilters() : setFiltersOpen(true))}
            class={`flex flex-none items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold transition-colors
                    ${filtersOpen || search.hasActiveFilters
                      ? "bg-accent-blue/[0.14] text-accent-blue"
                      : "text-ink-300 hover:bg-tint-strong hover:text-ink-50"}`}
            aria-label="Filters"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            title="Filters"
          >
            <SlidersHorizontal class="h-3.5 w-3.5" />
            {search.activeFilterCount > 0 && search.activeFilterCount}
          </button>
        </div>

        {/* The chips restate what the menu already shows, so they step aside for it. */}
        {!filtersOpen && search.activeFilterCount > 0 && (
          <div class="flex-none border-b border-line px-4 pb-2.5">
            <ActiveFilterChips search={search} />
          </div>
        )}

        {filtersOpen ? (
          <div class="flex min-h-0 flex-1 flex-col">
            <FilterPanelBody
              search={search}
              resultCount={search.outcome.total}
              onClose={closeFilters}
            />
          </div>
        ) : (
          <div ref={listRef} class="min-h-0 flex-1 overflow-y-auto touch-scroll scrollbar-thin p-1.5">
            {results.length === 0 ? (
              <p class="px-3 py-8 text-center text-[13px] text-ink-400">
                {search.isSearching ? "No chats match." : "Start typing to search."}
              </p>
            ) : (
              results.map((hit, index) => (
                <PaletteResultRow
                  key={hit.doc.chat.id}
                  hit={hit}
                  active={index === activeIndex}
                  onActivate={() => setActiveIndex(index)}
                  onSelect={() => choose(index)}
                />
              ))
            )}
          </div>
        )}

        {/* The filter menu carries its own count and sort footer. */}
        {!filtersOpen && (
          <footer class="flex flex-none items-center gap-3 border-t border-line px-4 py-2 text-[10.5px] text-ink-400">
            <span>
              <kbd class="rounded bg-tint-strong px-1 py-0.5 font-mono">↑</kbd>{" "}
              <kbd class="rounded bg-tint-strong px-1 py-0.5 font-mono">↓</kbd> navigate
            </span>
            <span>
              <kbd class="rounded bg-tint-strong px-1 py-0.5 font-mono">↵</kbd> open
            </span>
            <span>
              <kbd class="rounded bg-tint-strong px-1 py-0.5 font-mono">esc</kbd> close
            </span>
            <span class="ml-auto tabular-nums">
              {search.outcome.hits.length} of {search.outcome.total}
              {search.outcome.hits.length > MAX_VISIBLE_RESULTS &&
                ` · showing ${MAX_VISIBLE_RESULTS}`}
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
