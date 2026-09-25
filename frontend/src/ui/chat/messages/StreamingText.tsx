import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Markdown, MarkdownBlocks } from "../markdown/Markdown";
import { parseMarkdown, parseStreamingMarkdownState } from "../markdown/blockParser";
import { getTextAlignClass, getTextDirection } from "../markdown/bidi";

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

const waitingLabels = ["Creating...", "Writing...", "Working on it..."];

function PendingBlockFeedback({ pending, progressKey }: { pending: boolean; progressKey: string }) {
  const [feedback, setFeedback] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setFeedback({ key: progressKey, label: waitingLabels[Math.floor(Math.random() * waitingLabels.length)] });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pending, progressKey]);

  const visible = pending && feedback?.key === progressKey;
  return <div class={`streaming-feedback${visible ? " streaming-feedback-visible" : ""}`} role="status" aria-hidden={!visible}>
    {feedback?.label}
  </div>;
}

// Typewriter-style renderer: buffers incoming text and reveals it at a steady
// rate so chunky deltas from claude CLI feel like smooth per-token streaming.
//
// • Base rate: 80 chars/sec (~feels native).
// • If the backlog grows past 200 chars, we accelerate proportionally so a
//   2KB chunk doesn't take 25 seconds to animate.
// • When `streaming` flips false, snap to the full text immediately.
// • For history replay (mounted with streaming=false), render instantly.
function TokenStreamingText({ text, streaming, chatId, cwd }: Props) {
  const [displayed, setDisplayed] = useState<string>(() => (streaming ? "" : text));
  const targetRef = useRef(text);
  targetRef.current = text;

  // When streaming ends, jump to the full text — don't make the user wait.
  useEffect(() => {
    if (!streaming) setDisplayed(text);
  }, [streaming, text]);

  // Animation loop only runs while streaming is true.
  useEffect(() => {
    if (!streaming) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setDisplayed((prev) => {
        const target = targetRef.current;
        if (prev.length >= target.length) return prev;
        const lag = target.length - prev.length;
        // Steady rate plus catch-up: 80 cps base, +3 cps per char of backlog over 200.
        const cps = lag > 200 ? 80 + (lag - 200) * 3 : 80;
        const add = Math.max(1, Math.round((dt / 1000) * cps));
        return target.slice(0, prev.length + add);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming]);

  // Subtle blinking caret while we're still revealing characters.
  const showCaret = streaming && displayed.length < text.length;
  const dir = getTextDirection(displayed);
  const align = getTextAlignClass(displayed);

  return (
    <div class="relative">
      {streaming ? (
        <div
          dir={dir}
          class={`whitespace-pre-wrap [overflow-wrap:anywhere] ${align}`}
          style={{ unicodeBidi: "plaintext" }}
        >
          {displayed}
        </div>
      ) : (
        <Markdown chatId={chatId} cwd={cwd}>{displayed}</Markdown>
      )}
      {showCaret && (
        <span
          class="inline-block w-1.5 h-4 -mb-0.5 mx-0.5 align-middle bg-accent-blue/80 animate-pulse-fast rounded-sm"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
