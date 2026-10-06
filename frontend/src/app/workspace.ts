import { workspaceApi } from "../api/workspaceApi.ts";
import { createWorkspaceStore } from "../state/stores/workspace/workspaceStore.ts";
import { chatAttachments } from "./chatAttachments.ts";

// Cleanup belongs to the chat session, before deletion is delivered to the feed.
export const workspaceStore = createWorkspaceStore((onMessage) =>
  workspaceApi.subscribe((message) => {
    if (message.type === "chat.delete") {
      chatAttachments.drafts.discardChat(message.id);
    }
    onMessage(message);
  }),
);
