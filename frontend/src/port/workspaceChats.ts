import type { ChatMeta, ChatMetadataPage } from "../models/chat.ts";
import type { WorkspaceSnapshot } from "../models/workspace.ts";

export interface WorkspaceChatGateway {
  page(params: { before?: string }): Promise<ChatMetadataPage>;
  fetch(chatId: string): Promise<ChatMeta>;
}
export interface WorkspaceChatState {
  snapshot(): WorkspaceSnapshot;
  generation(): number;
  appendPage(page: ChatMetadataPage): void;
  seedChat(chat: ChatMeta): void;
}
