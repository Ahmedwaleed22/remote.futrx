import { useStore } from "zustand";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useWorkspaceFeed } from "../../context/WorkspaceFeedContext.ts";
import type {
  WorkspaceSnapshot,
  WorkspaceStoreActions,
} from "../../../models/workspace";

interface WorkspaceFeed
  extends WorkspaceSnapshot,
    Pick<WorkspaceStoreActions, "seedChat"> {
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  ensureChat: (chatId: string) => Promise<boolean>;
}

/** The chats and projects the server is pushing. */
export function useWorkspaceData(enabled: boolean): WorkspaceFeed {
  const { store: workspaceStore, chats } = useWorkspaceFeed();
  const seedChat = workspaceStore.getState().seedChat;
  const snapshot = useStore(workspaceStore, (state) => state.snapshot);

  useEffect(() => {
    workspaceStore.getState().setConnected(enabled);
    return () => {
      workspaceStore.getState().setConnected(false);
    };
  }, [enabled, workspaceStore]);

  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (loadingMore || !snapshot.hasMore) return;
    setLoadingMore(true);
    try {
      await chats.loadPage(snapshot.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, snapshot.hasMore, snapshot.nextBefore, chats]);
  const ensureChat = chats.ensureChat;
  return { ...snapshot, seedChat, loadMore, loadingMore, ensureChat };
}
