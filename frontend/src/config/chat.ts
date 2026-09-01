import { capitalize } from "./text.ts";

export function modelShortLabel(model?: string): string {
  return model || "auto";
}

export function providerDisplayLabel(provider?: string): string {
  if (!provider) return "Codex";
  return capitalize(provider);
}

/**
 * Where a chat's attachments land. The backend anchors them at
 * `<workspace root>/.uploads` and keeps that root stable on purpose — its own
 * comment in service.go says it does so "so the frontend can predict it
 * exactly". These are that prediction; they must not drift from it.
 */
export const CHAT_UPLOAD_PATHS = {
  /** Subdirectory isolating attachments from the source tree. */
  dirName: ".uploads",
  /** The stable root a project chat's uploads hang off, whatever its live cwd. */
  projectRoot: "/workspace",
} as const;

/** Keep a find-in-chat match this far from the scroller's edges when revealing it. */
export const CHAT_FIND_REVEAL_MARGIN = 80;

/**
 * The CSS highlight layers find-in-chat paints into. These names are the
 * contract with `::highlight(...)` in index.css and have to stay in step with
 * it, the way `STORAGE_KEYS.themeChoice` does with index.html.
 *
 * Two layers, so the current match reads differently from the rest: it is
 * painted separately rather than held out of `all`, and its rule wins by being
 * registered second.
 */
export const CHAT_FIND_HIGHLIGHTS = {
  all: "chat-find",
  current: "chat-find-current",
} as const;

/** Opts a subtree out of find-in-chat's matches — the find bar itself, for one. */
export const CHAT_FIND_SKIP_ATTRIBUTE = "data-find-skip";

/**
 * What find-in-chat refuses to read: markup carrying no rendered text, hidden
 * subtrees, and anything opted out above. Text the reader cannot see is not
 * text the find bar should match.
 */
export const CHAT_FIND_SKIP_SELECTOR =
  `script, style, [hidden], [${CHAT_FIND_SKIP_ATTRIBUTE}]`;
