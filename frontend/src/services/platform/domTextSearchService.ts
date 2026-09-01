// Finding rendered text in the DOM.
//
// Matching runs over a subtree's concatenated text rather than node by node,
// so a phrase still counts when markdown splits it across elements --
// `**bad**ly` reads as one word and should match as one. Folding preserves
// length, which is what lets an offset in the folded text index straight back
// into the original nodes.
//
// Searching the DOM rather than a message model is deliberate: it is what
// Cmd+F means everywhere else, and it keeps the count honest about what is
// rendered -- tool output, code blocks and all -- instead of quietly matching
// text the reader cannot see.
//
// Leaf service: it knows about the document, never about chats.

import { textMatchService } from "./textMatchService.ts";

/** A rendered text node and where its text starts in the concatenated string. */
interface TextChunk {
  node: Text;
  start: number;
}

/** Marks a subtree as not-text-to-find, e.g. the find bar's own input. */
const SKIP_SELECTOR = "script, style, [hidden], [data-find-skip]";

class DomTextSearchService {
  /** Every occurrence of `query` in the text rendered under `root`, in document order. */
  findRanges(root: Node, query: string): Range[] {
    const needle = textMatchService.fold(query);
    if (needle.trim().length === 0) return [];

    const chunks = this.#collectChunks(root);
    if (chunks.length === 0) return [];

    const haystack = textMatchService.fold(chunks.map((chunk) => chunk.node.data).join(""));
    const ranges: Range[] = [];
    for (
      let at = haystack.indexOf(needle);
      at !== -1;
      at = haystack.indexOf(needle, at + needle.length)
    ) {
      const from = this.#locate(chunks, at, false);
      const to = this.#locate(chunks, at + needle.length, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      ranges.push(range);
    }
    return ranges;
  }

  #collectChunks(root: Node): TextChunk[] {
    const chunks: TextChunk[] = [];
    let length = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      if (!this.#isSearchable(textNode)) continue;
      chunks.push({ node: textNode, start: length });
      length += textNode.data.length;
    }
    return chunks;
  }

  /** Text the reader cannot see is not text the find bar should match. */
  #isSearchable(node: Text): boolean {
    if (node.data.length === 0) return false;
    const parent = node.parentElement;
    if (!parent) return false;
    return !parent.closest(SKIP_SELECTOR);
  }

  #locate(
    chunks: readonly TextChunk[],
    offset: number,
    isEnd: boolean
  ): { node: Text; offset: number } {
    for (const chunk of chunks) {
      const end = chunk.start + chunk.node.data.length;
      if (isEnd ? offset <= end : offset < end) {
        return { node: chunk.node, offset: offset - chunk.start };
      }
    }
    const last = chunks[chunks.length - 1];
    return { node: last.node, offset: last.node.data.length };
  }
}

export const domTextSearchService = new DomTextSearchService();
