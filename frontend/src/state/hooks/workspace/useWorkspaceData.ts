import { useStore } from "zustand";
import { useCallback, useEffect, useState } from "preact/hooks";
import { chatApi } from "../../../api/chatApi";
import { workspaceApi } from "../../../api/workspaceApi";
import type {
  WorkspaceSnapshot,
  WorkspaceStoreActions,
} from "../../../models/workspace";
import { createWorkspaceStore } from "../../stores/workspace/workspaceStore";

interface WorkspaceFeed extends WorkspaceSnapshot, Pick<WorkspaceStoreActions, "seedChat"> {
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  ensureChat: (chatId: string) => Promise<boolean>;
}

// One feed for the whole app. The concrete socket is wired here rather than
// inside the store so the store stays free of the api layer and testable.
const workspaceStore = createWorkspaceStore(workspaceApi.subscribe);

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

  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (loadingMore || !snapshot.hasMore) return;
    setLoadingMore(true);
    const generation = workspaceStore.getState().connectionGeneration();
    try {
      const page = await chatApi.page({ before: snapshot.nextBefore });
      if (workspaceStore.getState().snapshot.loaded && workspaceStore.getState().connectionGeneration() === generation) workspaceStore.getState().appendPage(page);
    } finally { setLoadingMore(false); }
  }, [loadingMore, snapshot.hasMore, snapshot.nextBefore]);
  const ensureChat = useCallback(async (chatId: string) => {
    const generation = workspaceStore.getState().connectionGeneration();
    try {
      const chat = await chatApi.fetch(chatId);
      if (!workspaceStore.getState().snapshot.loaded || workspaceStore.getState().connectionGeneration() !== generation) return false;
      seedChat(chat);
      return true;
    } catch { return false; }
  }, []);
  return { ...snapshot, seedChat, loadMore, loadingMore, ensureChat };
}
