import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { StoreApi } from "zustand/vanilla";
import type {
  WorkspaceStoreActions,
  WorkspaceStoreState,
} from "../../models/workspace.ts";
import type { WorkspaceChatService } from "../../services/workspace/workspaceChatService.ts";

interface WorkspaceFeed {
  store: StoreApi<WorkspaceStoreState & WorkspaceStoreActions>;
  chats: WorkspaceChatService;
}
export const WorkspaceFeedContext = createContext<WorkspaceFeed | null>(null);
export function useWorkspaceFeed(): WorkspaceFeed {
  const value = useContext(WorkspaceFeedContext);
  if (!value) throw new Error("WorkspaceFeedContext is required");
  return value;
}
