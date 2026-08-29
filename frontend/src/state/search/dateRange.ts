// Date filtering for workspace search.
//
// Ranges resolve in the user's local timezone: someone picking "Today" means
// their calendar day, not UTC's. `now` is always injected so the resolver stays
// pure and testable.

// The preset and field vocabularies are declared once, as the option tables the
// menu renders; the id unions and the lists storage validates against are
// derived from them, so a new preset cannot be added to one and missed in the
// other.

export const DATE_PRESET_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom range" },
] as const;

export const DATE_FIELD_OPTIONS = [
  { value: "lastMessageAt", label: "Last activity" },
  { value: "createdAt", label: "Created" },
] as const;

export type DatePresetId = (typeof DATE_PRESET_OPTIONS)[number]["value"];
export type DateField = (typeof DATE_FIELD_OPTIONS)[number]["value"];

export const DATE_PRESET_IDS: readonly DatePresetId[] = DATE_PRESET_OPTIONS.map(
  (option) => option.value
);
export const DATE_FIELD_IDS: readonly DateField[] = DATE_FIELD_OPTIONS.map(
  (option) => option.value
);

export interface DateFilter {
  preset: DatePresetId;
  field: DateField;
  /** ISO `YYYY-MM-DD`, inclusive. Only read when preset is "custom". */
  from?: string;
  /** ISO `YYYY-MM-DD`, inclusive to end-of-day. Only read when preset is "custom". */
  to?: string;
}

export interface ResolvedRange {
  from: number | null;
  to: number | null;
}

export const ANY_DATE: DateFilter = { preset: "any", field: "lastMessageAt" };

const DAY_MS = 86_400_000;

function startOfLocalDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Parse `YYYY-MM-DD` as local midnight. Returns null for anything malformed. */
function parseLocalDate(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject roll-over dates like 2026-02-31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

/**
 * Turn a filter into an inclusive epoch-ms window. `null` on either end means
 * unbounded in that direction.
 */
export function resolveDateRange(filter: DateFilter, now: number): ResolvedRange {
  const today = startOfLocalDay(now);

  switch (filter.preset) {
    case "today":
      return { from: today, to: today + DAY_MS - 1 };
    case "yesterday":
      return { from: today - DAY_MS, to: today - 1 };
    case "7d":
      return { from: today - 6 * DAY_MS, to: null };
    case "30d":
      return { from: today - 29 * DAY_MS, to: null };
    case "90d":
      return { from: today - 89 * DAY_MS, to: null };
    case "custom": {
      const from = parseLocalDate(filter.from);
      const parsedTo = parseLocalDate(filter.to);
      // An end date is inclusive of the whole day the user picked.
      const to = parsedTo === null ? null : parsedTo + DAY_MS - 1;
      // A backwards range would silently match nothing; swap instead.
      if (from !== null && to !== null && from > to) return { from: to - DAY_MS + 1, to: from + DAY_MS - 1 };
      return { from, to };
    }
    case "any":
    default:
      return { from: null, to: null };
  }
}

export function isDateFilterActive(filter: DateFilter): boolean {
  if (filter.preset === "any") return false;
  if (filter.preset === "custom") return Boolean(filter.from || filter.to);
  return true;
}

export function inRange(at: number, range: ResolvedRange): boolean {
  if (range.from !== null && at < range.from) return false;
  if (range.to !== null && at > range.to) return false;
  return true;
}

/** Short human label for the active-filter chip. */
export function describeDateFilter(filter: DateFilter): string {
  const fieldLabel =
    DATE_FIELD_OPTIONS.find((option) => option.value === filter.field)?.label ?? "Last activity";
  if (filter.preset === "custom") {
    if (filter.from && filter.to) return `${fieldLabel}: ${filter.from} → ${filter.to}`;
    if (filter.from) return `${fieldLabel}: after ${filter.from}`;
    if (filter.to) return `${fieldLabel}: before ${filter.to}`;
    return `${fieldLabel}: custom`;
  }
  const presetLabel =
    DATE_PRESET_OPTIONS.find((option) => option.value === filter.preset)?.label ?? "Any time";
  return `${fieldLabel}: ${presetLabel}`;
}
