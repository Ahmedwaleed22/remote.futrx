import { createStore } from "zustand/vanilla";
import type {
  SearchFilters,
  SearchPreferences,
  WorkspaceSearchStoreActions,
  WorkspaceSearchStoreState,
} from "../../../models/search";
import { searchFilterService } from "../../../services/workspace/searchFilterService.ts";
import {
  ephemeralSearchPreferenceService,
  searchPreferenceService,
} from "../../../services/workspace/searchPreferenceService.ts";

/**
 * One surface's search selection, held outside the component tree.
 *
 * Only the selection lives here. The index and the ranked results are derived
 * from it and from the chats the workspace feed is pushing, so they are
 * computed where both are in hand -- in `useWorkspaceSearch` -- rather than
 * mirrored into a second store that would have to be kept in step with the
 * first.
 *
 * `preferences` is injected rather than imported so the two instances below can
 * differ in exactly one thing: whether the selection outlives the session. It
 * is also what keeps this module free of a fixed storage key, which is what
 * lets a test drive it with a hand-held boundary.
 *
 * Every write goes through `preferences`, so nothing is saved that the user did
 * not do. The previous version mirrored the filters from an effect and needed a
 * ref to suppress the write that hydrating from storage triggered on mount.
 */
export function createWorkspaceSearchStore(preferences: SearchPreferences) {
  return createStore<WorkspaceSearchStoreState & WorkspaceSearchStoreActions>()(
    (set, get) => {
      function commitFilters(filters: SearchFilters): void {
        set({ filters });
        preferences.writeFilters(filters);
      }

      return {
        query: "",
        filters: preferences.readFilters(),
        sort: preferences.readSort(),
        countsRetained: 0,

        setQuery: (query) => set({ query }),

        setSort: (sort) => {
          set({ sort });
          preferences.writeSort(sort);
        },

        toggleFacetValue: (facetId, value) => {
          commitFilters(searchFilterService.toggleFacetValue(get().filters, facetId, value));
        },

        setFacetValues: (facetId, values) => {
          commitFilters(searchFilterService.withFacetValues(get().filters, facetId, values));
        },

        clearFacet: (facetId) => {
          commitFilters(searchFilterService.clearFacet(get().filters, facetId));
        },

        setDateFilter: (date) => {
          commitFilters(searchFilterService.withDate(get().filters, date));
        },

        clearDate: () => {
          const { filters } = get();
          commitFilters(
            searchFilterService.withDate(filters, searchFilterService.clearedDate(filters.date)),
          );
        },

        resetFilters: () => commitFilters(searchFilterService.defaults()),

        clearAll: () => {
          set({ query: "" });
          commitFilters(searchFilterService.defaults());
        },

        retainCounts: () => {
          set((state) => ({ countsRetained: state.countsRetained + 1 }));
          let released = false;
          return () => {
            // Single-use, so a menu that releases twice cannot drop the count
            // below the number of menus still open.
            if (released) return;
            released = true;
            set((state) => ({ countsRetained: state.countsRetained - 1 }));
          };
        },
      };
    },
  );
}

// A search state per surface. They were one shared state, which meant narrowing
// the palette to a project silently re-scoped the sidebar behind it -- a filter
// you never set, on a list you were not looking at.
//
// Both read the same chats and projects, so results agree; only the selection is
// separate. The sidebar's is a place you set up and come back to, so it is
// remembered across reloads; the palette is a scratch surface you open, use and
// dismiss, so it starts from the defaults every time and saves none of it.
export const sidebarSearchStore = createWorkspaceSearchStore(searchPreferenceService);

export const paletteSearchStore = createWorkspaceSearchStore(ephemeralSearchPreferenceService);
