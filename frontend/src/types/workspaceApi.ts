import type { ChatMeta } from "../models/chat";
import type { ProjectMeta } from "../models/project";

export type WorkspaceMessage =
  | { type: "workspace.snapshot"; chats: ChatMeta[]; projects: ProjectMeta[]; nextBefore?: string; hasMore?: boolean; totalChats?: number }
  | { type: "chat.upsert"; chat: ChatMeta }
  | { type: "chat.delete"; id: string }
  | { type: "project.upsert"; project: ProjectMeta }
  | { type: "project.delete"; id: string };
