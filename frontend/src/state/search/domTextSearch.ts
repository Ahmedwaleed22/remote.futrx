import { fold } from "./textMatch";

/** A rendered text node and where its text starts in the concatenated string. */
interface TextChunk {
  node: Text;
  start: number;
}

/** Text the reader cannot see is not text the find bar should match. */
function isSearchable(node: Text): boolean {
  if (node.data.length === 0) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  return !parent.closest("script, style, [hidden], [data-find-skip]");
}

function locate(chunks: readonly TextChunk[], offset: number, isEnd: boolean) {
  for (const chunk of chunks) {
    const end = chunk.start + chunk.node.data.length;
    if (isEnd ? offset <= end : offset < end) {
      return { node: chunk.node, offset: offset - chunk.start };
    }
  }
  const last = chunks[chunks.length - 1];
  return { node: last.node, offset: last.node.data.length };
}

/**
 * Every occurrence of `query` in the text rendered under `root`, in document
 * order.
 *
 * Matching runs over the whole subtree's concatenated text rather than node by
 * node, so a phrase still counts when markdown splits it across elements --
 * `**bad**ly` reads as one word and should match as one. `fold` preserves
 * length, which is what lets an offset in the folded text index straight back
 * into the original nodes.
 *
 * Searching the DOM rather than the message model is deliberate: it is what
 * Cmd+F means everywhere else, and it keeps the count honest about the thread
 * as rendered -- tool output, code blocks and all -- instead of quietly
 * matching text the reader cannot see.
 */
export function findRanges(root: Node, query: string): Range[] {
  const needle = fold(query);
  if (needle.trim().length === 0) return [];

  const chunks: TextChunk[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    if (!isSearchable(textNode)) continue;
    chunks.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  if (chunks.length === 0) return [];

  const haystack = fold(text);
  const ranges: Range[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    const from = locate(chunks, at, false);
    const to = locate(chunks, at + needle.length, true);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    ranges.push(range);
  }
  return ranges;
}
