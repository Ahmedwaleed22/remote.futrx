// Assembling what the filter menu renders, from what the engine returned.
//
// One facet's view is three things joined: the values in use (with their
// labels), how many chats each would match given the *other* filters, and which
// are ticked. Keeping the join here rather than inside the hook means the rule
// that decides what is offered can be read -- and tested -- without a browser.

import { FACET_DEFINITIONS, offerableOptions, optionsForFacet } from "./facetRegistry.ts";
import type { FacetView } from "./searchController.ts";
import type { ChatSearchDoc } from "./searchDoc.ts";
import type { SearchFilters } from "./searchQuery.ts";
import type { SearchOutcome } from "./searchResults.ts";

/**
 * Resolve every facet for display against one search outcome.
 *
 * Options are scoped by the other active filters, so ticking Codex leaves the
 * Model facet offering Codex's models. That scoping is derived from the counts,
 * which are only tallied while a filter menu is open; with none open the
 * unscoped list stands in, since the only thing reading it then is the chips,
 * and they only look up values that are already selected.
 */
export function buildFacetViews(
  docs: readonly ChatSearchDoc[],
  filters: SearchFilters,
  outcome: SearchOutcome
): FacetView[] {
  return FACET_DEFINITIONS.map((facet) => {
    const selected = filters.facets[facet.id] ?? [];
    const counts = outcome.counts[facet.id];
    const inUse = optionsForFacet(facet, docs);
    return {
      id: facet.id,
      label: facet.label,
      advanced: facet.advanced,
      emptyHint: facet.emptyHint,
      options: outcome.counted ? offerableOptions(inUse, counts, selected) : inUse,
      selected,
      counts,
    };
  });
}
