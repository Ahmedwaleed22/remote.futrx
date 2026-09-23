import { cloneElement } from "preact";
import { memo } from "preact/compat";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { parseMarkdown } from "./blockParser";
import { highlightCode } from "./highlight";
import { renderInline } from "./inlineParser";
import type { MarkdownBlock } from "./types";
import { getTextAlignClass, isRtlText } from "./bidi";

export function Markdown({ children, chatId, cwd }: { children: string; chatId?: string; cwd?: string }) {
  const docIsRtl = isRtlText(children);
  const blocks = useMemo(() => parseMarkdown(children), [children]);
  const context: MarkdownRenderContext = { chatId, cwd, docIsRtl };
  return <>{blocks.map((block, index) => renderBlock(block, `md-${index}`, context))}</>;
}

// Stable component types and keys preserve mounted blocks through deltas and
// completion, following T3 Code's ChatMarkdown renderer approach.
// Reference: https://github.com/pingdotgg/t3code/blob/10882bea739a98f11b942c20c6570eb6126dd010/apps/web/src/components/ChatMarkdown.tsx
// Each block owns its entrance animation for its entire lifetime; later tokens cannot
// remove/reapply the animation class or re-highlight completed code.
export function MarkdownBlocks({ blocks, chatId, cwd, streaming }: {
  blocks: MarkdownBlock[];
  chatId?: string;
  cwd?: string;
  streaming: boolean;
}) {
  return <>{blocks.map((block, index) => (
    <StableMarkdownBlock key={`md-${index}`} block={block} chatId={chatId} cwd={cwd} streaming={streaming} />
  ))}</>;
}

const StableMarkdownBlock = memo(function StableMarkdownBlock({ block, chatId, cwd, streaming }: {
  block: MarkdownBlock;
  chatId?: string;
  cwd?: string;
  streaming: boolean;
}) {
  const [animate] = useState(streaming);
  const contentVersion = block.type === "list" ? block.items.length
    : block.type === "table" ? block.rows.length + 1 : 0;
  const elementRef = useRevealHeight<HTMLElement>(animate, contentVersion);

  const rendered = renderBlock(block, "block", { chatId, cwd }, animate);
  return animate ? cloneElement(rendered, { ref: elementRef }) : rendered;
}, (previous, next) => previous.chatId === next.chatId && previous.cwd === next.cwd &&
  JSON.stringify(previous.block) === JSON.stringify(next.block));

function useRevealHeight<T extends HTMLElement>(animate: boolean, contentVersion: number) {
  const elementRef = useRef<T>(null);
  const initialized = useRef(false);
  const targetHeight = useRef(0);
  const animating = useRef(false);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!animate || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targetHeight.current = element.getBoundingClientRect().height;
      initialized.current = true;
      animating.current = false;
      element.style.height = "";
      element.style.overflow = "";
      element.style.maskImage = "";
      element.style.removeProperty("--stream-reveal-feather");
      return;
    }

    // Lists can gain items after mounting. Start from the visible height, then
    // measure the new natural height so one clean edge opens below the text.
    const from = !initialized.current ? 0
      : animating.current ? element.getBoundingClientRect().height : targetHeight.current;
    initialized.current = true;
    element.style.height = "auto";
    const to = element.getBoundingClientRect().height;
    targetHeight.current = to;
    if (to <= from + 0.5) {
      animating.current = false;
      element.style.height = "";
      element.style.overflow = "";
      element.style.maskImage = "";
      element.style.removeProperty("--stream-reveal-feather");
      return;
    }
    // Match duration to the remaining distance. With a linear transition,
    // repeated item arrivals keep roughly the same visual speed instead of
    // restarting a slow ease at every row.
    const duration = Math.min(1200, Math.max(80, ((to - from) / 900) * 1000));
    element.style.setProperty("--stream-reveal-duration", `${duration}ms`);
    const softenEdge = element.matches("ul, ol") || element.querySelector(":scope > table") !== null
      || to - from > 80 || !!element.style.maskImage;
    if (softenEdge) {
      element.style.maskImage = "linear-gradient(to bottom, black calc(100% - var(--stream-reveal-feather)), transparent 100%)";
      element.style.setProperty("--stream-reveal-feather", "18px");
    }
    animating.current = true;
    element.style.height = `${from}px`;
    element.style.overflow = "hidden";
    void element.offsetHeight;
    const frame = requestAnimationFrame(() => {
      element.style.height = `${to}px`;
      if (softenEdge) element.style.setProperty("--stream-reveal-feather", "0px");
    });
    const finish = (event: TransitionEvent) => {
      if (event.target !== element || event.propertyName !== "height") return;
      element.style.height = "";
      element.style.overflow = "";
      element.style.maskImage = "";
      element.style.removeProperty("--stream-reveal-feather");
      animating.current = false;
      element.removeEventListener("transitionend", finish);
    };
    element.addEventListener("transitionend", finish);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("transitionend", finish);
    };
  }, [animate, contentVersion]);
  return elementRef;
}

interface MarkdownRenderContext {
  chatId?: string;
  cwd?: string;
  docIsRtl?: boolean;
  isRtl?: boolean;
}

function renderBlock(block: MarkdownBlock, key: string, context: MarkdownRenderContext, animate = false) {
  const reveal = animate ? " markdown-block-reveal" : "";
  switch (block.type) {
    case "paragraph":
      return renderParagraph(block.text, key, context, reveal);
    case "heading":
      return renderHeading(block.level, block.text, key, context, reveal);
    case "code":
      return renderCode(block, key, reveal);
    case "blockquote":
      return renderBlockquote(block, key, context, reveal);
    case "list":
      return renderList(block, key, context, reveal);
    case "table":
      return renderTable(block, key, context, reveal);
    case "hr":
      return <hr key={key} class={`my-3 border-line${reveal}`} />;
  }
}

function renderParagraph(text: string, key: string, context: MarkdownRenderContext, reveal = "") {
  const isRtl = isRtlText(text);
  return (
    <p
      key={key}
      dir={isRtl ? "rtl" : "ltr"}
      class={`my-1.5 leading-relaxed break-words [overflow-wrap:anywhere] ${getTextAlignClass(text)}${reveal}`}
    >
      {renderInline(text, key, { ...context, isRtl })}
    </p>
  );
}

function renderCode(block: Extract<MarkdownBlock, { type: "code" }>, key: string, reveal = "") {
  return (
    <div key={key} dir="ltr" class={`relative my-3 rounded-lg border border-line bg-surface overflow-hidden text-left${reveal}`}>
      {block.lang && (
        <div dir="ltr" class="px-3 py-1 text-[11px] text-ink-300 border-b border-line bg-tint text-left">
          {block.lang}
        </div>
      )}
      <pre dir="ltr" class="md-code overflow-x-auto touch-scroll p-3 text-[12.5px] leading-relaxed font-mono text-left">
        <code dir="ltr">{highlightCode(block.text, block.lang)}</code>
      </pre>
    </div>
  );
}

function renderBlockquote(
  block: Extract<MarkdownBlock, { type: "blockquote" }>,
  key: string,
  context: MarkdownRenderContext,
  reveal = "",
) {
  const hasRtl = block.children.some(
    (child) => "text" in child && typeof child.text === "string" && isRtlText(child.text),
  );
  const borderClass = hasRtl
    ? "border-r-2 border-accent-blue/45 pr-3 text-right"
    : "border-l-2 border-accent-blue/45 pl-3 text-left";
  const blockquoteContext = { ...context, isRtl: hasRtl };

  return (
    <blockquote
      key={key}
      dir={hasRtl ? "rtl" : "ltr"}
      class={`${borderClass} my-2 text-ink-200 italic min-w-0 break-words [overflow-wrap:anywhere]${reveal}`}
    >
      {block.children.map((child, index) => renderBlock(child, `${key}-q-${index}`, blockquoteContext))}
    </blockquote>
  );
}

function renderTable(
  block: Extract<MarkdownBlock, { type: "table" }>,
  key: string,
  context: MarkdownRenderContext,
  reveal = "",
) {
  return (
    <div key={key} class={`max-w-full overflow-x-auto touch-scroll my-3 border border-line rounded-lg${reveal}`}>
      <table class="md-table w-full text-sm border-collapse">
        <thead class="bg-tint">
          <tr>
            {block.header.map((cell, index) => renderTableHeaderCell(cell, index, key, context))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => renderTableDataCell(cell, cellIndex, rowIndex, key, context))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderTableHeaderCell(
  cell: string,
  index: number,
  blockKey: string,
  context: MarkdownRenderContext,
) {
  const isRtl = isRtlText(cell);
  return (
    <th
      key={index}
      dir={isRtl ? "rtl" : "ltr"}
      class={`${getTextAlignClass(cell)} whitespace-nowrap px-3 py-1.5 font-semibold border-b border-line text-ink-100`}
    >
      {renderInline(cell, `${blockKey}-h-${index}`, { ...context, isRtl })}
    </th>
  );
}

function renderTableDataCell(
  cell: string,
  cellIndex: number,
  rowIndex: number,
  blockKey: string,
  context: MarkdownRenderContext,
) {
  const isRtl = isRtlText(cell);
  return (
    <td
      key={cellIndex}
      dir={isRtl ? "rtl" : "ltr"}
      class={`${getTextAlignClass(cell)} px-3 py-1.5 border-b border-line`}
    >
      {renderInline(cell, `${blockKey}-r-${rowIndex}-${cellIndex}`, { ...context, isRtl })}
    </td>
  );
}

function renderHeading(level: 1 | 2 | 3 | 4 | 5 | 6, text: string, key: string, context: MarkdownRenderContext, reveal = "") {
  const isRtl = isRtlText(text);
  const dir = isRtl ? "rtl" : "ltr";
  const align = getTextAlignClass(text);
  const headingContext = { ...context, isRtl };
  if (level === 1) {
    return (
      <h1 key={key} dir={dir} class={`text-xl font-bold mt-3 mb-1.5 break-words [overflow-wrap:anywhere] ${align}${reveal}`}>
        {renderInline(text, key, headingContext)}
      </h1>
    );
  }
  if (level === 2) {
    return (
      <h2 key={key} dir={dir} class={`text-lg font-bold mt-3 mb-1.5 break-words [overflow-wrap:anywhere] ${align}${reveal}`}>
        {renderInline(text, key, headingContext)}
      </h2>
    );
  }
  return (
    <h3 key={key} dir={dir} class={`text-base font-bold mt-2 mb-1 break-words [overflow-wrap:anywhere] ${align}${reveal}`}>
      {renderInline(text, key, headingContext)}
    </h3>
  );
}

function renderList(block: Extract<MarkdownBlock, { type: "list" }>, key: string, context: MarkdownRenderContext, reveal = "") {
  const isRtl = !!context.docIsRtl || block.items.some((item) => isRtlText(item.text));
  const dir = isRtl ? "rtl" : "ltr";
  const align = isRtl ? "text-right" : "text-left";
  const padding = isRtl ? "pr-5 pl-0 text-right" : "pl-5 pr-0 text-left";
  const className = `${block.ordered ? "list-decimal" : "list-disc"} list-outside ${padding} my-2 space-y-0.5${reveal}`;
  const items = block.items.map((item, index) => {
    const content = renderInline(item.text, `${key}-li-${index}`, { ...context, isRtl });
    if (item.checked === undefined) {
      return <li key={index} dir={dir} class={align}>{content}</li>;
    }
    return (
      <li key={index} dir={dir} class={`list-none ${isRtl ? "-mr-5" : "-ml-5"} flex items-start gap-2 ${align}`}>
        <input type="checkbox" checked={item.checked} disabled class="mt-1 h-3.5 w-3.5 flex-none" />
        <span>{content}</span>
      </li>
    );
  });

  if (block.ordered) {
    return <ol key={key} dir={dir} class={className} start={block.start}>{items}</ol>;
  }
  return <ul key={key} dir={dir} class={className}>{items}</ul>;
}
