import { useMemo, useRef } from "preact/hooks";
import { MarkdownBlocks } from "../markdown/Markdown";
import { parseStreamingMarkdownState } from "../markdown/blockParser";
import { PendingBlockFeedback } from "./PendingBlockFeedback";

interface BlockStreamingTextProps {
  text: string;
  streaming: boolean;
  chatId?: string;
  cwd?: string;
}

export function BlockStreamingText({ text, streaming, chatId, cwd }: BlockStreamingTextProps) {
  const { blocks, pending } = useMemo(() => parseStreamingMarkdownState(text, !streaming), [text, streaming]);
  const hasStreamed = useRef(streaming);
  if (streaming) hasStreamed.current = true;
  const last = blocks[blocks.length - 1];
  const progressKey = `${blocks.length}:${last?.type === "list" ? last.items.length
    : last?.type === "table" ? last.rows.length : 0}`;
  return <>
    <MarkdownBlocks blocks={blocks} chatId={chatId} cwd={cwd} streaming={hasStreamed.current} />
    <PendingBlockFeedback pending={streaming && pending} progressKey={progressKey} />
  </>;
}
