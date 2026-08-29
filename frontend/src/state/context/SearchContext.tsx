import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { useWorkspaceContext } from "./WorkspaceContext";
import { useWorkspaceSearch } from "../hooks/workspace/useWorkspaceSearch";
import { isPaletteShortcut } from "../search/paletteShortcut";
import type { WorkspaceSearch } from "../search/searchController";

interface SearchContextValue {
  search: WorkspaceSearch;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);


/**
 * Holds one search state shared by the sidebar and the command palette, so
 * scoping to a set of projects in one place applies in the other rather than
 * silently diverging.
 */
export function SearchProvider({ children }: { children: ComponentChildren }) {
  const workspace = useWorkspaceContext();
  const search = useWorkspaceSearch(workspace.chats, workspace.projects);
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
    <SearchContext.Provider value={{ search, paletteOpen, openPalette, closePalette }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext(): SearchContextValue {
  const value = useContext(SearchContext);
  if (!value) throw new Error("useSearchContext must be used within SearchProvider");
  return value;
}
