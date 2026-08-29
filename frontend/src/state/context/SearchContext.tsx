import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { useWorkspaceContext } from "./WorkspaceContext";
import { useWorkspaceSearch } from "../hooks/workspace/useWorkspaceSearch";
import { isPaletteShortcut } from "../search/paletteShortcut";
import { ephemeralSearchPreferences } from "../search/searchFiltersStorage";
import type { WorkspaceSearch } from "../search/searchController";

interface SearchContextValue {
  /** The sidebar's search: remembered across reloads. */
  sidebarSearch: WorkspaceSearch;
  /** The palette's own search, independent of the sidebar's. */
  paletteSearch: WorkspaceSearch;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);


/**
 * Holds a search state per surface. They were one shared state, which meant
 * narrowing the palette to a project silently re-scoped the sidebar behind it
 * -- a filter you never set, on a list you were not looking at. The palette is
 * a scratch surface, so it gets its own selection and saves none of it.
 *
 * Both read the same chats and projects, so results agree; only the selection
 * is separate.
 */
export function SearchProvider({ children }: { children: ComponentChildren }) {
  const workspace = useWorkspaceContext();
  const sidebarSearch = useWorkspaceSearch(workspace.chats, workspace.projects);
  const paletteSearch = useWorkspaceSearch(
    workspace.chats,
    workspace.projects,
    ephemeralSearchPreferences
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isPaletteShortcut(event)) return;
      // Browsers map Cmd/Ctrl+P to Print; preventDefault suppresses it.
      event.preventDefault();
      setPaletteOpen((open) => !open);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SearchContext.Provider
      value={{ sidebarSearch, paletteSearch, paletteOpen, openPalette, closePalette }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext(): SearchContextValue {
  const value = useContext(SearchContext);
  if (!value) throw new Error("useSearchContext must be used within SearchProvider");
  return value;
}
