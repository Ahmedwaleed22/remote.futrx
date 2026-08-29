// Keyword matching for workspace search.
//
// The sidebar used to test `haystack.includes(query)`, which missed reordered
// words ("futrx remote" vs "remote.futrx"), separator variants, and typos, and
// gave no way to rank one hit above another. This module replaces that with a
// scored match that also reports where it hit, so the UI can highlight.
//
// Normalization is deliberately length-preserving: every transform maps one
// source character to exactly one output character, so an offset into the
// folded string is a valid offset into the original. That lets us fold once at
// index time and still emit highlight spans against the raw text.

export interface MatchSpan {
  start: number;
  end: number;
}

export interface FieldMatch {
  score: number;
  spans: MatchSpan[];
}

// Score per matched token, by how directly it matched. The gaps are wide so a
// stronger tier on one token always outranks a weaker tier on another.
const TIER_EXACT = 120;
const TIER_PREFIX = 90;
const TIER_WORD_START = 70;
const TIER_SUBSTRING = 45;
const TIER_SUBSEQUENCE = 22;
const TIER_FUZZY = 14;

const foldCache = new Map<string, string>();

/**
 * Lowercase and strip diacritics without changing string length, so span
 * offsets stay aligned with the original text.
 */
export function fold(value: string): string {
  if (!value) return "";
  const cached = foldCache.get(value);
  if (cached !== undefined) return cached;

  let out = "";
  const lowered = value.toLowerCase();
  for (const char of lowered) {
    // NFD splits an accented char into base + combining marks; taking the base
    // keeps one char per source char. Astral chars keep their own length.
    const base = char.normalize("NFD")[0] ?? char;
    out += base.length === char.length ? base : char;
  }
  // Guard the rare locale cases where lowercasing changed length (e.g. "İ").
  const result = out.length === value.length ? out : value.toLowerCase();
  if (foldCache.size < 4096) foldCache.set(value, result);
  return result;
}

/**
 * Split a query or field into comparable tokens. Breaks on separators and on
 * camelCase boundaries, so `workspaceSidebarState.ts` yields
 * ["workspace", "sidebar", "state", "ts"].
 */
export function tokenize(value: string): string[] {
  if (!value) return [];
  const withBoundaries = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2");
  return fold(withBoundaries)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** True when the character before `index` ends a word, making `index` a word start. */
function isWordStart(folded: string, index: number): boolean {
  if (index === 0) return true;
  const previous = folded.charCodeAt(index - 1);
  const isAlphaNumeric =
    (previous >= 97 && previous <= 122) || (previous >= 48 && previous <= 57);
  return !isAlphaNumeric;
}

/**
 * Levenshtein distance with an early bail-out once it provably exceeds `max`.
 * Bounded so a long title can never cost more than a few rows of work.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowBest = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > max) return false;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length] <= max;
}

/** Typo tolerance scales with token length; short tokens get none. */
function allowedTypos(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/**
 * Find `token` as an ordered subsequence of `folded`, preferring characters
 * that sit at word starts. Catches acronym-ish input like "wss" for
 * "workspace sidebar state".
 */
function matchSubsequence(folded: string, token: string): MatchSpan[] | null {
  const spans: MatchSpan[] = [];
  let cursor = 0;
  for (const char of token) {
    const found = folded.indexOf(char, cursor);
    if (found < 0) return null;
    const last = spans[spans.length - 1];
    if (last && last.end === found) last.end = found + 1;
    else spans.push({ start: found, end: found + 1 });
    cursor = found + 1;
  }
  return spans;
}

/** Match one already-folded token against one already-folded field. */
function matchToken(folded: string, token: string): FieldMatch | null {
  if (!folded || !token) return null;

  const direct = folded.indexOf(token);
  if (direct >= 0) {
    const spans = [{ start: direct, end: direct + token.length }];
    if (folded.length === token.length) return { score: TIER_EXACT, spans };
    if (direct === 0) return { score: TIER_PREFIX, spans };
    if (isWordStart(folded, direct)) return { score: TIER_WORD_START, spans };
    return { score: TIER_SUBSTRING, spans };
  }

  // Typo tolerance runs per word rather than across the whole field, so an
  // edit budget can't be spent bridging unrelated words.
  const budget = allowedTypos(token);
  if (budget > 0) {
    const wordPattern = /[a-z0-9]+/g;
    let word: RegExpExecArray | null;
    while ((word = wordPattern.exec(folded)) !== null) {
      if (withinEditDistance(word[0], token, budget)) {
        return {
          score: TIER_FUZZY,
          spans: [{ start: word.index, end: word.index + word[0].length }],
        };
      }
    }
  }

  const subsequence = matchSubsequence(folded, token);
  if (subsequence) return { score: TIER_SUBSEQUENCE, spans: subsequence };

  return null;
}

/**
 * Match every query token against one field. Returns null unless all tokens
 * match, so extra words narrow rather than widen the result set.
 */
export function matchField(folded: string, queryTokens: string[]): FieldMatch | null {
  if (queryTokens.length === 0) return { score: 0, spans: [] };
  if (!folded) return null;

  let score = 0;
  const spans: MatchSpan[] = [];
  for (const token of queryTokens) {
    const hit = matchToken(folded, token);
    if (!hit) return null;
    score += hit.score;
    spans.push(...hit.spans);
  }
  return { score, spans: mergeSpans(spans) };
}

/** Sort and coalesce overlapping/adjacent spans so highlighting stays clean. */
export function mergeSpans(spans: MatchSpan[]): MatchSpan[] {
  if (spans.length <= 1) return spans;
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  const merged: MatchSpan[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= last.end) last.end = Math.max(last.end, next.end);
    else merged.push({ ...next });
  }
  return merged;
}
