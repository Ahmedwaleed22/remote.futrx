// Where a search surface keeps its filter selection between mounts.
//
// Two implementations, because the two surfaces want different things: the
// sidebar's search is a place you set up and come back to, so it persists
// across reloads alongside the existing `remote.futrx.sidebarCollapsed`
// preference; the palette is a scratch surface you open, use and dismiss, and
// persisting it would both surprise the user and overwrite the sidebar's
// selection through the same key.
//
// Stored values are treated as untrusted: a hand-edited or stale entry (say, a
// facet that no longer exists) must degrade to "no filter" rather than throw
// during startup. The accepted vocabularies are the ones the rest of the app
// declares, so this file never needs updating when a preset or sort is added.

import { ANY_DATE, DATE_FIELD_IDS, DATE_PRESET_IDS } from "./dateRange.ts";
import type { DateField, DateFilter, DatePresetId } from "./dateRange.ts";
import { defaultFilters, DEFAULT_SORT, emptyFacetSelections, SORT_IDS } from "./searchQuery.ts";
import type { SearchFilters, SortId } from "./searchQuery.ts";
import { FACET_IDS } from "./facetRegistry.ts";

const FILTERS_KEY = "remote.futrx.searchFilters";
const SORT_KEY = "remote.futrx.searchSort";

/** How one search surface loads and saves its selection. */
export interface SearchPreferences {
  readFilters(): SearchFilters;
  writeFilters(filters: SearchFilters): void;
  readSort(): SortId;
  writeSort(sort: SortId): void;
}

function parseDate(raw: unknown): DateFilter {
  if (!raw || typeof raw !== "object") return { ...ANY_DATE };
  const value = raw as Record<string, unknown>;
  const preset = DATE_PRESET_IDS.includes(value.preset as DatePresetId)
    ? (value.preset as DatePresetId)
    : ANY_DATE.preset;
  const field = DATE_FIELD_IDS.includes(value.field as DateField)
    ? (value.field as DateField)
    : ANY_DATE.field;
  const filter: DateFilter = { preset, field };
  if (typeof value.from === "string") filter.from = value.from;
  if (typeof value.to === "string") filter.to = value.to;
  return filter;
}

export function parseFilters(raw: unknown): SearchFilters {
  if (!raw || typeof raw !== "object") return defaultFilters();
  const value = raw as Record<string, unknown>;
  const facets = emptyFacetSelections();
  const storedFacets = (value.facets ?? {}) as Record<string, unknown>;

  for (const id of FACET_IDS) {
    const selected = storedFacets[id];
    if (!Array.isArray(selected)) continue;
    facets[id] = selected.filter((entry): entry is string => typeof entry === "string");
  }

  return { facets, date: parseDate(value.date) };
}

export function readFilters(): SearchFilters {
  try {
    const stored = localStorage.getItem(FILTERS_KEY);
    if (!stored) return defaultFilters();
    return parseFilters(JSON.parse(stored));
  } catch {
    return defaultFilters();
  }
}

export function writeFilters(filters: SearchFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

export function readSort(): SortId {
  try {
    const stored = localStorage.getItem(SORT_KEY) as SortId | null;
    return stored && SORT_IDS.includes(stored) ? stored : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

export function writeSort(sort: SortId): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {}
}

/** Remembered across reloads. What the sidebar's search uses. */
export const storedSearchPreferences: SearchPreferences = {
  readFilters,
  writeFilters,
  readSort,
  writeSort,
};

/**
 * Starts from the defaults every mount and saves nothing. What the palette
 * uses, so its filters neither outlive the session nor reach into the
 * sidebar's stored selection.
 */
export const ephemeralSearchPreferences: SearchPreferences = {
  readFilters: defaultFilters,
  writeFilters: () => {},
  readSort: () => DEFAULT_SORT,
  writeSort: () => {},
};
