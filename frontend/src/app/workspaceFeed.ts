import { chatApi } from "../api/chatApi.ts";
import { workspaceApi } from "../api/workspaceApi.ts";
import { createWorkspaceStore } from "../state/stores/workspace/workspaceStore.ts";
import { WorkspaceChatService } from "../services/workspace/workspaceChatService.ts";

const store = createWorkspaceStore(workspaceApi.subscribe);
export const workspaceFeed = {
  store,
  chats: new WorkspaceChatService(chatApi, {
    snapshot: () => store.getState().snapshot,
    generation: () => store.getState().connectionGeneration(),
    appendPage: (page) => store.getState().appendPage(page),
    seedChat: store.getState().seedChat,
  }),
};
