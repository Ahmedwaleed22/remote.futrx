import type { SearchHit } from "../../../state/search/searchResults";
import { modelShortLabel } from "../../../config/chat";
import { timeAgo } from "../../../shared/format";
import { HighlightedText } from "../../primitives/HighlightedText";
import { Clock, Folder, Loader, MessageSquare } from "../../primitives/icons";

/**
 * One ranked search result. Unlike `ChatRow` it always names the chat's project
 * — with results ordered by relevance rather than grouped, that context is the
 * only way to tell two similarly-titled chats apart.
 */
export function SearchResultRow({
  hit,
  active,
  onSelect,
}: {
  hit: SearchHit;
  active: boolean;
  onSelect: () => void;
}) {
  const chat = hit.doc.chat;
  const unread = !active && !chat.running && hit.doc.unread;

  return (
    <button
      type="button"
      onClick={onSelect}
      class={`flex w-full items-start gap-2 rounded px-2.5 py-2 text-left transition-colors
              ${active
                ? "bg-accent-blue/[0.14] border border-accent-blue/[0.32]"
                : "border border-transparent hover:bg-white/[0.04]"}`}
    >
      {chat.running ? (
        <Loader class="mt-0.5 h-3.5 w-3.5 flex-none animate-spin text-accent-blue" />
      ) : unread ? (
        <span class="mt-0.5 grid h-3.5 w-3.5 flex-none place-items-center" title="Unread">
          <span class="h-2.5 w-2.5 rounded-full bg-accent-green shadow-[0_0_0_3px_rgba(43,213,118,0.12)]" />
        </span>
      ) : (
        <MessageSquare
          class={`mt-0.5 h-3.5 w-3.5 flex-none ${active ? "text-accent-blue" : "text-ink-400"}`}
        />
      )}

      <span class="min-w-0 flex-1">
        <HighlightedText
          text={chat.title || "Untitled"}
          spans={hit.titleSpans}
          class={`block truncate text-[13px] leading-snug ${
            active ? "font-medium text-ink-50" : "text-ink-100"
          }`}
        />
        <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Folder class="h-3 w-3 flex-none" />
          <span class="truncate">{hit.doc.project?.name ?? "Unassigned"}</span>
          <span
            class={`flex-none whitespace-nowrap rounded bg-white/[0.06] px-1 py-0.5 text-[10px] leading-none
                    ${active ? "text-accent-blue" : ""}`}
          >
            {modelShortLabel(chat.model)}
          </span>
          <Clock class="h-3 w-3 flex-none" />
          <span class="flex-none">{timeAgo(chat.lastMessageAt)}</span>
        </span>
      </span>
    </button>
  );
}
