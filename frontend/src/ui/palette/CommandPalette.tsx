import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WorkspaceSearch } from "../../state/search/searchController";
import type { SearchHit } from "../../state/search/searchResults";
import { modelShortLabel } from "../../config/chat";
import { timeAgo } from "../../shared/format";
import { HighlightedText } from "../primitives/HighlightedText";
import { ActiveFilterChips } from "../sidebar/search/ActiveFilterChips";
import {
  CornerDownLeft,
  Folder,
  Loader,
  MessageSquare,
  Search,
  SlidersHorizontal,
} from "../primitives/icons";

// Enough to fill the list without rendering hundreds of rows nobody scrolls to.
const MAX_VISIBLE_RESULTS = 50;

function whyItMatched(hit: SearchHit): string | null {
  switch (hit.matchedField) {
    case "project":
      return hit.doc.project ? `project · ${hit.doc.project.name}` : "project";
    case "path":
      return hit.doc.chat.cwd ? `path · ${hit.doc.chat.cwd}` : "path";
    case "skill":
      return "skill";
    case "model":
      return `model · ${modelShortLabel(hit.doc.chat.model)}`;
    default:
      return null;
  }
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => search.outcome.hits.slice(0, MAX_VISIBLE_RESULTS),
    [search.outcome]
  );

  useEffect(() => {
    if (!open) return;
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
    if (!open) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  function choose(index: number) {
    const hit = results[index];
    if (!hit) return;
    onSelectChat(hit.doc.chat.id);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
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
      class="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[3px] modal-backdrop-fade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        class="theme-menu-surface modal-card-pop flex w-full max-w-[640px] flex-col overflow-hidden
               rounded-panel border border-line bg-raised shadow-modal"
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
          {search.activeFilterCount > 0 && (
            <span class="flex flex-none items-center gap-1 rounded-full bg-accent-blue/[0.14] px-2 py-0.5 text-[10.5px] font-semibold text-accent-blue">
              <SlidersHorizontal class="h-3 w-3" />
              {search.activeFilterCount}
            </span>
          )}
        </div>

        {search.activeFilterCount > 0 && (
          <div class="flex-none border-b border-line px-4 pb-2.5">
            <ActiveFilterChips search={search} />
          </div>
        )}

        <div ref={listRef} class="min-h-0 flex-1 overflow-y-auto touch-scroll scrollbar-thin p-1.5">
          {results.length === 0 ? (
            <p class="px-3 py-8 text-center text-[13px] text-ink-400">
              {search.isSearching ? "No chats match." : "Start typing to search."}
            </p>
          ) : (
            results.map((hit, index) => {
              const chat = hit.doc.chat;
              const active = index === activeIndex;
              const reason = whyItMatched(hit);
              return (
                <button
                  key={chat.id}
                  type="button"
                  data-active={active ? "true" : "false"}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  class={`flex w-full items-start gap-2.5 rounded-card px-3 py-2 text-left transition-colors
                          ${active ? "bg-accent-blue/[0.14]" : "hover:bg-tint"}`}
                >
                  {chat.running ? (
                    <Loader class="mt-0.5 h-4 w-4 flex-none animate-spin text-accent-blue" />
                  ) : (
                    <MessageSquare
                      class={`mt-0.5 h-4 w-4 flex-none ${active ? "text-accent-blue" : "text-ink-400"}`}
                    />
                  )}

                  <span class="min-w-0 flex-1">
                    <HighlightedText
                      text={chat.title || "Untitled"}
                      spans={hit.titleSpans}
                      class={`block truncate text-[13.5px] leading-snug ${
                        active ? "text-ink-50" : "text-ink-100"
                      }`}
                    />
                    <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                      {hit.doc.project && (
                        <>
                          <Folder class="h-3 w-3 flex-none" />
                          <span class="truncate">{hit.doc.project.name}</span>
                        </>
                      )}
                      {!hit.doc.project && <span class="truncate">Unassigned</span>}
                      <span aria-hidden="true">·</span>
                      <span class="flex-none">{timeAgo(chat.lastMessageAt)}</span>
                      {reason && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span class="truncate text-ink-500">{reason}</span>
                        </>
                      )}
                    </span>
                  </span>

                  {active && (
                    <CornerDownLeft class="mt-1 h-3.5 w-3.5 flex-none text-accent-blue" />
                  )}
                </button>
              );
            })
          )}
        </div>

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
      </div>
    </div>
  );
}
