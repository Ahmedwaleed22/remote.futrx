import type {
  ChatEvent,
  ChatEventPage,
  ChatRenderState,
  ChatStatus,
} from "../../../models/chat";
import { EMPTY_CHAT_USAGE_TOTALS } from "../../../models/chatUsage.ts";
import { chatMessageBlockBuilder } from "./chatMessageBlockBuilder.ts";
import { chatUsageAccumulator } from "./chatUsageAccumulator.ts";
import { isTerminalTurnStatus } from "../../../services/chat/turnStatus.ts";

class ChatEventStateProjector {
  empty(): ChatRenderState {
    return {
      events: [],
      blocks: [],
      usageTotals: EMPTY_CHAT_USAGE_TOTALS,
      eventCount: 0,
      hasOlder: false,
      nextBefore: 0,
    };
  }

  fromEvents(
    events: ChatEvent[],
    page: Pick<ChatEventPage, "hasMore" | "nextBefore">
  ): ChatRenderState {
    return {
      events,
      blocks: chatMessageBlockBuilder.fromEvents(events),
      usageTotals: chatUsageAccumulator.totalFor(events),
      eventCount: events.length,
      hasOlder: page.hasMore,
      nextBefore: page.nextBefore ?? 0,
    };
  }

  append(state: ChatRenderState, events: ChatEvent[]): ChatRenderState {
    if (events.length === 0) return state;
    const tail = state.events.at(-1);
    // Streaming normally appends ordered events. Fold only the new batch,
    // retaining block identity for old messages instead of replaying history.
    if (events.every((event, index) => {
      const previous = index === 0 ? tail : events[index - 1];
      return !previous || this.eventOrder(event) > this.eventOrder(previous);
    })) {
      return {
        ...state,
        events: [...state.events, ...events],
        blocks: chatMessageBlockBuilder.appendEvents(state.blocks, events),
        usageTotals: events.reduce(
          (totals, event) => chatUsageAccumulator.add(totals, event),
          state.usageTotals,
        ),
        eventCount: state.eventCount + events.length,
      };
    }
    const merged = this.mergeEvents(state.events, events);
    return this.fromEvents(merged, {
      hasMore: state.hasOlder,
      nextBefore: state.nextBefore,
    });
  }

  replaceWindow(state: ChatRenderState, page: ChatEventPage): ChatRenderState {
    const firstSeq = page.events.find((event) => event.seq)?.seq;
    if (!firstSeq || page.indexing) return state;
    const retained = state.events.filter(
      (event) => !event.seq || event.seq < firstSeq || event.seq > page.lastSeq,
    );
    return this.fromEvents(this.mergeEvents(retained, page.events), {
      hasMore: state.hasOlder,
      nextBefore: state.nextBefore,
    });
  }

  prepend(state: ChatRenderState, page: ChatEventPage): ChatRenderState {
    return this.fromEvents(this.mergeEvents(page.events, state.events), page);
  }

  latestSequence(events: ChatEvent[]): number {
    return events.reduce((max, event) => Math.max(max, event.seq || 0), 0);
  }

  statusAfter(event: ChatEvent, current: ChatStatus): ChatStatus {
    const terminalTurnStatus = event.type === "turn_status" && isTerminalTurnStatus(event.status);
    if (event.type === "complete" || event.type === "error" || terminalTurnStatus) {
      // The backend clears the run lock in a later sync event. Keep streaming
      // until sync running=false so queued prompts are not sent into a locked
      // run. If that sync arrived first, a terminal provider event must not
      // reactivate the already-finished run.
      return current === "streaming" ? "streaming" : "ready";
    }
    return "streaming";
  }

  private mergeEvents(first: ChatEvent[], second: ChatEvent[]): ChatEvent[] {
    const merged = [...first];
    const seenSequences = new Set<number>();
    for (const event of merged) {
      if (event.seq) seenSequences.add(event.seq);
    }
    for (const event of second) {
      if (event.seq && seenSequences.has(event.seq)) continue;
      merged.push(event);
      if (event.seq) seenSequences.add(event.seq);
    }
    return merged.sort((left, right) => this.eventOrder(left) - this.eventOrder(right));
  }

  private eventOrder(event: ChatEvent): number {
    return event.seq || event.t;
  }
}

export const chatEventStateProjector = new ChatEventStateProjector();
