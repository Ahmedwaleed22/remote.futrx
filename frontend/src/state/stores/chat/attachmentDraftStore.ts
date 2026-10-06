import { createStore } from "zustand/vanilla";
import type {
  AttachmentDraftState,
  AttachmentDraftActions,
} from "../../../models/upload.ts";
import type { AttachmentDraftPersistence } from "../../../port/chat/attachmentDraftPersistence.ts";

export function createAttachmentDraftStore(
  persistence: AttachmentDraftPersistence,
) {
  return createStore<AttachmentDraftState & AttachmentDraftActions>()(
    (set) => ({
      attachments: persistence.read(),
      pending: new Map(),
      update: (chatId, change, save = false) =>
        set((state) => {
          const attachments = new Map(state.attachments);
          const next = change(attachments.get(chatId) ?? []);
          if (next.length) attachments.set(chatId, next);
          else attachments.delete(chatId);
          if (save) persistence.write(attachments);
          return { attachments };
        }),
      begin: (chatId) =>
        set((state) => {
          const pending = new Map(state.pending);
          pending.set(chatId, (pending.get(chatId) ?? 0) + 1);
          return { pending };
        }),
      finish: (chatId) =>
        set((state) => {
          const pending = new Map(state.pending);
          const count = (pending.get(chatId) ?? 0) - 1;
          if (count > 0) pending.set(chatId, count);
          else pending.delete(chatId);
          return { pending };
        }),
    }),
  );
}
