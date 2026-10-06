import { createStore } from "zustand/vanilla";
import type { Attachment, AttachmentDraftState, AttachmentDraftActions } from "../../../models/upload.ts";
import type { ComposerSessionStorage } from "../../../models/chat.ts";
import type { UploadHandle } from "../../../types/uploadApi.ts";
import { API_ROUTES } from "../../../config/routes.ts";
import { SESSION_STORAGE_KEYS } from "../../../config/storageKeys.ts";

// Uploads belong to a chat session, not to a mounted view.
export const attachmentUploadHandles = new Map<string, Map<string, UploadHandle>>();
export const attachmentUploadCompletions = new Map<string, () => void>();
export function createAttachmentDraftStore(storage: ComposerSessionStorage | null = defaultStorage()) {
  const attachments = new Map<string, Attachment[]>();
  try {
    const saved = JSON.parse(storage?.getItem(SESSION_STORAGE_KEYS.attachmentDrafts) || "{}");
    for (const [chatId, value] of Object.entries(saved)) {
      if (!Array.isArray(value)) continue;
      const valid = value.filter((a): a is Attachment => !!a && typeof a.id === "string" && typeof a.name === "string" && typeof a.size === "number" && typeof a.serverPath === "string" && !!a.serverPath);
      if (valid.length) attachments.set(chatId, valid.map((a) => ({ ...a, objectUrl: a.isImage ? API_ROUTES.chats.mediaOpen(chatId, a.serverPath) : undefined })));
    }
  } catch { /* Storage failures degrade to memory. */ }
  function persist(drafts: ReadonlyMap<string, Attachment[]>) {
    try {
      const saved = Object.fromEntries([...drafts].map(([id, items]) => [id, items.filter((a) => a.serverPath && !a.error).map(({ objectUrl: _url, ...a }) => a)]));
      storage?.setItem(SESSION_STORAGE_KEYS.attachmentDrafts, JSON.stringify(saved));
    } catch { /* Keep the in-memory draft on storage quota/privacy failures. */ }
  }
  return createStore<AttachmentDraftState & AttachmentDraftActions>()((set) => ({
    attachments, pending: new Map(),
    update: (chatId, change, save = false) => set((state) => {
      const attachments = new Map(state.attachments);
      const next = change(attachments.get(chatId) ?? []);
      if (next.length) attachments.set(chatId, next); else attachments.delete(chatId);
      if (save) persist(attachments);
      return { attachments };
    }),
    begin: (chatId) => set((state) => {
      const pending = new Map(state.pending);
      pending.set(chatId, (pending.get(chatId) ?? 0) + 1);
      return { pending };
    }),
    finish: (chatId) => set((state) => {
      const pending = new Map(state.pending);
      const count = (pending.get(chatId) ?? 0) - 1;
      if (count > 0) pending.set(chatId, count); else pending.delete(chatId);
      return { pending };
    }),
  }));
}
function defaultStorage(): ComposerSessionStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
export const attachmentDraftStore = createAttachmentDraftStore();

/** Release resources only after an explicit removal, send, deletion or sign-out. */
export function discardChatAttachments(chatId: string): void {
  for (const [id, handle] of attachmentUploadHandles.get(chatId) ?? []) {
    void handle.abort().catch(() => undefined);
    attachmentUploadCompletions.get(id)?.();
    attachmentUploadCompletions.delete(id);
  }
  attachmentUploadHandles.delete(chatId);
  attachmentDraftStore.getState().update(chatId, (items) => {
    for (const item of items) if (item.objectUrl?.startsWith("blob:")) URL.revokeObjectURL(item.objectUrl);
    return [];
  }, true);
}
export function discardAllChatAttachments(): void {
  const chatIds = new Set([...attachmentDraftStore.getState().attachments.keys(), ...attachmentUploadHandles.keys()]);
  for (const chatId of chatIds) discardChatAttachments(chatId);
}
