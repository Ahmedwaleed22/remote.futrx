// What search reads from a chat, and the shape it reads it out of.
//
// A searchable field used to be declared in four places: a `foldedX` property
// on the doc, a line in the index builder, a weight constant in the engine, and
// one of five near-identical scoring blocks. `SEARCH_FIELDS` is now the single
// declaration — the doc's folded text, the ranking weights, and the engine's
// scoring loop all derive from it, the same way filters derive from
// `FACET_DEFINITIONS`.

import type { ChatMeta } from "../../models/chat";
import type { ProjectMeta } from "../../models/project";
import { fold } from "./textMatch.ts";

/** Sentinel for chats that belong to no project, so it can be a normal option. */
export const UNASSIGNED_PROJECT = " unassigned";

export interface SearchFieldDefinition {
  readonly id: string;
  /** How much a match here is worth relative to the title. */
  readonly weight: number;
  /** The one field whose match spans are rendered as highlights on the row. */
  readonly highlighted?: boolean;
  /** The raw text to search, before folding. */
  textOf(chat: ChatMeta, project: ProjectMeta | null): string;
}

// Declaration order is also evaluation order, and ties in the "best field"
// comparison keep the earlier entry — so this order is the tie-break rule.
const SEARCH_FIELD_TABLE = [
  {
    id: "title",
    weight: 1,
    highlighted: true,
    textOf: (chat) => chat.title || "",
  },
  {
    id: "project",
    weight: 0.55,
    textOf: (_chat, project) => (project ? `${project.name} ${project.slug}` : ""),
  },
  {
    id: "path",
    weight: 0.4,
    textOf: (chat) => chat.cwd || "",
  },
  {
    id: "skill",
    weight: 0.35,
    textOf: (chat) => chat.selectedSkills?.map((skill) => skill.name).join(" ") ?? "",
  },
  {
    id: "model",
    weight: 0.3,
    textOf: (chat) => chat.model || "",
  },
] as const satisfies readonly SearchFieldDefinition[];

export type SearchFieldId = (typeof SEARCH_FIELD_TABLE)[number]["id"];

export const SEARCH_FIELDS: readonly SearchFieldDefinition[] = SEARCH_FIELD_TABLE;

export const SEARCH_FIELD_IDS: readonly SearchFieldId[] = SEARCH_FIELD_TABLE.map(
  (field) => field.id
);

/** Index into `ChatSearchDoc.folded` of the field that supplies highlights. */
export const HIGHLIGHTED_FIELD_INDEX = SEARCH_FIELDS.findIndex(
  (field) => field.highlighted === true
);

/**
 * A chat flattened for search: its raw metadata plus the folded text of every
 * searchable field, positionally aligned with `SEARCH_FIELDS`. Built once per
 * chats/projects change so keystrokes never pay normalization cost.
 */
export interface ChatSearchDoc {
  chat: ChatMeta;
  project: ProjectMeta | null;
  folded: string[];
  unread: boolean;
}

/**
 * Flatten chats into search docs, pre-folding every searchable field.
 *
 * This runs once per chats/projects change — never per keystroke — so typing
 * only ever pays for comparison, not normalization.
 */
export function buildSearchIndex(
  chats: readonly ChatMeta[],
  projects: readonly ProjectMeta[]
): ChatSearchDoc[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return chats.map((chat) => {
    const project = (chat.projectId && projectsById.get(chat.projectId)) || null;
    return {
      chat,
      project,
      folded: SEARCH_FIELDS.map((field) => fold(field.textOf(chat, project))),
      unread: (chat.lastMessageAt || 0) > (chat.lastReadAt || 0),
    };
  });
}
