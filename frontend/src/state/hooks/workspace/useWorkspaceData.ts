import { useStore } from "zustand";
import { useEffect } from "preact/hooks";
import { workspaceStore } from "../../../app/workspace.ts";
import type {
  WorkspaceSnapshot,
  WorkspaceStoreActions,
} from "../../../models/workspace";

interface WorkspaceFeed
  extends WorkspaceSnapshot,
    Pick<WorkspaceStoreActions, "seedChat"> {}

// Defined once with the store, so a caller may list it as an effect or callback
// dependency without churning.
const seedChat = workspaceStore.getState().seedChat;

/** The chats and projects the server is pushing. */
export function useWorkspaceData(enabled: boolean): WorkspaceFeed {
  const snapshot = useStore(workspaceStore, (state) => state.snapshot);

  useEffect(() => {
    workspaceStore.getState().setConnected(enabled);
    return () => {
      workspaceStore.getState().setConnected(false);
    };
  }, [enabled]);

  return { ...snapshot, seedChat };
}
