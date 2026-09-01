// Normalizing text so two spellings of one word compare equal.
//
// Folding is deliberately length-preserving: every transform maps one source
// character to exactly one output character, so an offset into the folded
// string is a valid offset into the original. That is what lets a caller fold
// once at index time and still emit highlight spans against the raw text.
//
// It is separated from matching because the two change for different reasons:
// this file changes when a script or a spelling variant needs handling, the
// matcher when ranking is tuned. Find-in-chat also folds without ever scoring.
//
// Leaf service: it knows about the language, never about chats or filters.

import { FOLD_CACHE_LIMIT } from "../../config/search.ts";

/**
 * One-to-one character equivalences that NFD cannot express, so a word matches
 * however the writer happened to spell it. Every entry maps a single code point
 * to a single code point, which is what keeps folding length-preserving.
 *
 * The Arabic set is the usual orthographic drift: alef maksura written for yeh,
 * teh marbuta for heh, and the Persian/Urdu keheh and yeh for their Arabic
 * counterparts. Hamza carriers (أ إ آ ؤ ئ) already fold through NFD.
 */
const CHAR_EQUIVALENTS: ReadonlyMap<string, string> = new Map([
  ["ى", "ي"], // alef maksura -> yeh
  ["ة", "ه"], // teh marbuta -> heh
  ["ی", "ي"], // farsi yeh -> yeh
  ["ک", "ك"], // keheh -> kaf
  ["ڪ", "ك"], // swash kaf -> kaf
  ["ٰ", "ا"], // superscript alef -> alef
  // Arabic-Indic and extended Arabic-Indic digits, so "٥" and "۵" find "5".
  ...Array.from({ length: 10 }, (_, d) => [String.fromCharCode(0x0660 + d), String(d)] as const),
  ...Array.from({ length: 10 }, (_, d) => [String.fromCharCode(0x06F0 + d), String(d)] as const),
]);

class TextFoldService {
  readonly #cache = new Map<string, string>();

  /**
   * Lowercase, strip diacritics and settle script-specific spelling variants
   * without changing string length, so span offsets stay aligned with the
   * original text.
   *
   * The guard is per character rather than per string: each source character
   * contributes exactly its own length, and any transform that would not
   * (lowercasing "İ" to "i̇", decomposing an astral char) leaves it as it was.
   * A whole-string fallback could still return a differently sized string,
   * which is the one thing highlighting cannot survive.
   */
  fold(value: string): string {
    if (!value) return "";
    const cached = this.#cache.get(value);
    if (cached !== undefined) return cached;

    let out = "";
    for (const char of value) {
      // NFD splits an accented char into base + combining marks; taking the base
      // keeps one char per source char. Astral chars keep their own length.
      const base = char.toLowerCase().normalize("NFD")[0] ?? char;
      const folded = base.length === char.length ? base : char;
      out += CHAR_EQUIVALENTS.get(folded) ?? folded;
    }
    // Bounded so a long session cannot grow the cache without limit.
    if (this.#cache.size < FOLD_CACHE_LIMIT) this.#cache.set(value, out);
    return out;
  }
}

export const textFoldService = new TextFoldService();
