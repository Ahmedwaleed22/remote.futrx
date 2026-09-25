import { useMemo, useRef } from "preact/hooks";
import { MarkdownBlocks } from "../markdown/Markdown";
import { parseMarkdown, parseStreamingMarkdownState } from "../markdown/blockParser";
import { PendingBlockFeedback } from "./PendingBlockFeedback";
import { TokenStreamingText } from "./TokenStreamingText";

interface Props {
  text: string;
  streaming: boolean;
  chatId?: string;
  cwd?: string;
  presentation?: "blocks" | "tokens";
  hydrated?: boolean;
}

export function StreamingText(props: Props) {
  // The transcript snapshot was written before this component mounted. Keep it
  // visible immediately on reconnect, including an unfinished final block.
  // Later tool calls create new text parts and use the normal reveal path.
  const hydrated = useRef(props.hydrated ?? false);
  // Capability discovery can finish after a text part starts. Keep that
  // part's presentation stable rather than replacing visible text mid-reply.
  const presentation = useRef(props.presentation ?? "tokens");
  const stream = useRef({ text: props.text, requested: props.streaming, active: props.streaming });
  if (props.hydrated) hydrated.current = true;
  if (hydrated.current) return <HydratedText {...props} />;

  // sendPrompt marks the thread streaming before the next user/assistant event
  // arrives. The previous reply may still be the last block in that window.
  // Keep its settled Markdown visible until this text part actually changes.
  if (!props.streaming) {
    stream.current.active = false;
  } else if (!stream.current.requested && props.text === stream.current.text) {
    stream.current.active = false;
  } else if (props.text !== stream.current.text) {
    stream.current.active = true;
  }
  stream.current.text = props.text;
  stream.current.requested = props.streaming;
  const currentProps = { ...props, streaming: stream.current.active };
  return presentation.current === "blocks"
    ? <BlockStreamingText {...currentProps} />
    : <TokenStreamingText {...currentProps} />;
}

function HydratedText({ text, chatId, cwd }: Props) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <MarkdownBlocks blocks={blocks} chatId={chatId} cwd={cwd} streaming={false} />;
}

function BlockStreamingText({ text, streaming, chatId, cwd }: Props) {
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
