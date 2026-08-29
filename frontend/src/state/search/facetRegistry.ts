// The single source of truth for workspace search filters.
//
// Every filter section in the UI, every active-filter chip, the badge count,
// the reset behaviour, and the result counting all render from this table.
// Adding a filter means adding one entry here — not editing six components.
// `FacetId` and `FACET_IDS` are derived from the table, so a new entry needs no
// matching edit to a union or a list that could drift out of sync with it.
//
// Option lists are derived from the chats that actually exist rather than from
// the static catalog, so the menu never offers a provider or model the user has
// never used, and free-form model strings show up without a code change.

import { CHAT_MODE_OPTIONS, modelDisplayLabel, providerDisplayLabel } from "../../config/chatCatalog.ts";
import { UNASSIGNED_PROJECT } from "./searchDoc.ts";
import type { ChatSearchDoc } from "./searchDoc.ts";

export interface FacetOption {
  value: string;
  label: string;
  /** Secondary text, e.g. a project slug under its name. */
  hint?: string;
}

/**
 * The authoring contract for one table entry. Consumers use `FacetDefinition`
 * below, which narrows `id` to the ids the table actually declares — this one
 * has to stay `string` so the table can be checked against it while still
 * being the thing `FacetId` is derived from.
 */
interface FacetSpec {
  readonly id: string;
  readonly label: string;
  /** Advanced facets start collapsed behind a disclosure. */
  readonly advanced: boolean;
  /** Empty-state copy when no chat carries a value for this facet. */
  readonly emptyHint: string;
  /**
   * The doc's values for this facet. A doc passes when the selection is empty
   * or intersects this list. Also drives per-option counting.
   */
  valuesOf(doc: ChatSearchDoc): readonly string[];
  /** Human label for a raw value, used in both the menu and the chips. */
  labelFor(value: string, doc?: ChatSearchDoc): string;
  /** Optional secondary line in the menu (e.g. a project slug). */
  hintFor?(value: string, doc?: ChatSearchDoc): string | undefined;
}

const NONE = "";

const MODE_LABELS = new Map(CHAT_MODE_OPTIONS.map((option) => [option.value, option.label]));

export const STATUS_UNREAD = "unread";
export const STATUS_RUNNING = "running";

/** Title-case a raw enum value that has no catalog label of its own. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// `as const` keeps the ids as literal types so `FacetId` can be derived below;
// `satisfies` still type-checks every entry against the contract.
const FACET_TABLE = [
  {
    id: "project",
    label: "Projects",
    advanced: false,
    emptyHint: "No projects yet",
    valuesOf: (doc) => [doc.chat.projectId || UNASSIGNED_PROJECT],
    labelFor: (value, doc) => {
      if (value === UNASSIGNED_PROJECT) return "Unassigned chats";
      return doc?.project?.name || value;
    },
    hintFor: (value, doc) => (value === UNASSIGNED_PROJECT ? undefined : doc?.project?.slug),
  },
  {
    id: "provider",
    label: "Provider",
    advanced: false,
    emptyHint: "No providers recorded",
    valuesOf: (doc) => [doc.chat.provider || NONE],
    labelFor: (value) => (value === NONE ? "Default" : providerDisplayLabel(value as never)),
  },
  {
    id: "model",
    label: "Model",
    advanced: false,
    emptyHint: "No models recorded",
    valuesOf: (doc) => [doc.chat.model || NONE],
    labelFor: (value, doc) =>
      value === NONE ? "Auto" : modelDisplayLabel(value, doc?.chat.provider),
  },
  {
    id: "mode",
    label: "Mode",
    advanced: false,
    emptyHint: "No modes recorded",
    valuesOf: (doc) => [doc.chat.mode || NONE],
    labelFor: (value) => (value === NONE ? "Unset" : MODE_LABELS.get(value as never) ?? value),
  },
  {
    id: "status",
    label: "Status",
    advanced: false,
    emptyHint: "No status to filter",
    valuesOf: (doc) => {
      const values: string[] = [];
      if (doc.unread) values.push(STATUS_UNREAD);
      if (doc.chat.running) values.push(STATUS_RUNNING);
      return values;
    },
    labelFor: (value) => (value === STATUS_RUNNING ? "Running" : "Unread"),
  },
  {
    id: "effort",
    label: "Reasoning effort",
    advanced: true,
    emptyHint: "No effort levels recorded",
    valuesOf: (doc) => [doc.chat.reasoningEffort || NONE],
    labelFor: (value) => (value === NONE ? "Auto" : capitalize(value)),
  },
  {
    id: "tier",
    label: "Service tier",
    advanced: true,
    emptyHint: "No service tiers recorded",
    valuesOf: (doc) => [doc.chat.serviceTier || NONE],
    labelFor: (value) => (value === NONE ? "Auto" : capitalize(value)),
  },
  {
    id: "skill",
    label: "Skills",
    advanced: true,
    emptyHint: "No skills selected in any chat",
    valuesOf: (doc) => doc.chat.selectedSkills?.map((skill) => skill.name) ?? [],
    labelFor: (value) => value,
  },
] as const satisfies readonly FacetSpec[];

export type FacetId = (typeof FACET_TABLE)[number]["id"];

/** A facet as consumers see it: the spec, with `id` narrowed to a known facet. */
export type FacetDefinition = FacetSpec & { readonly id: FacetId };

export const FACET_DEFINITIONS: readonly FacetDefinition[] = FACET_TABLE;

export const FACET_IDS: readonly FacetId[] = FACET_TABLE.map((facet) => facet.id);

/**
 * Build the selectable options for one facet from the docs themselves, keeping
 * one representative doc per value so labels can consult sibling metadata (a
 * project's name, a chat's provider when labelling its model).
 */
export function optionsForFacet(
  facet: FacetDefinition,
  docs: readonly ChatSearchDoc[]
): FacetOption[] {
  const representatives = new Map<string, ChatSearchDoc>();
  for (const doc of docs) {
    for (const value of facet.valuesOf(doc)) {
      if (!representatives.has(value)) representatives.set(value, doc);
    }
  }

  const options: FacetOption[] = [];
  for (const [value, doc] of representatives) {
    options.push({
      value,
      label: facet.labelFor(value, doc),
      hint: facet.hintFor?.(value, doc),
    });
  }

  // Unassigned sorts last; everything else alphabetically by label.
  options.sort((left, right) => {
    if (left.value === UNASSIGNED_PROJECT) return 1;
    if (right.value === UNASSIGNED_PROJECT) return -1;
    return left.label.localeCompare(right.label);
  });
  return options;
}
