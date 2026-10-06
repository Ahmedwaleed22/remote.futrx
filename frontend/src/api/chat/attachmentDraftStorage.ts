import type { Attachment } from "../../models/upload.ts";
import type { ComposerSessionStorage } from "../../models/chat.ts";
import type { AttachmentDraftPersistence } from "../../port/chat/attachmentDraftPersistence.ts";
import { API_ROUTES } from "../../config/routes.ts";
import { SESSION_STORAGE_KEYS } from "../../config/storageKeys.ts";

export function createAttachmentDraftStorage(
  storage: ComposerSessionStorage | null,
): AttachmentDraftPersistence {
  function read(): Map<string, Attachment[]> {
    const attachments = new Map<string, Attachment[]>();
    try {
      const saved = JSON.parse(
        storage?.getItem(SESSION_STORAGE_KEYS.attachmentDrafts) || "{}",
      );
      for (const [chatId, value] of Object.entries(saved)) {
        if (!Array.isArray(value)) continue;
        const valid = value.filter(
          (a): a is Attachment =>
            !!a &&
            typeof a.id === "string" &&
            typeof a.name === "string" &&
            typeof a.size === "number" &&
            typeof a.serverPath === "string" &&
            !!a.serverPath,
        );
        if (valid.length)
          attachments.set(
            chatId,
            valid.map((a) => ({
              ...a,
              objectUrl: a.isImage
                ? API_ROUTES.chats.mediaOpen(chatId, a.serverPath)
                : undefined,
            })),
          );
      }
    } catch {
      /* Storage failures degrade to memory. */
    }
    return attachments;
  }
  function persist(drafts: ReadonlyMap<string, Attachment[]>) {
    try {
      const saved = Object.fromEntries(
        [...drafts].map(([id, items]) => [
          id,
          items
            .filter((a) => a.serverPath && !a.error)
            .map(({ objectUrl: _url, ...a }) => a),
        ]),
      );
      storage?.setItem(
        SESSION_STORAGE_KEYS.attachmentDrafts,
        JSON.stringify(saved),
      );
    } catch {
      /* Keep the in-memory draft on storage quota/privacy failures. */
    }
  }
  return { read, write: persist };
}
export function attachmentSessionStorage(): ComposerSessionStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
