import type { ChatComposerSessionStoreActions } from "../../models/chat.ts";
import type { AttachmentUploadService } from "./attachmentUploadService.ts";

/** Coordinates the existing explicit discard order across composer state. */
export class ChatDraftSessionService {
  private readonly attachments: Pick<AttachmentUploadService, "discardChat" | "discardAll">;
  private readonly composer: () => Pick<ChatComposerSessionStoreActions, "setDraft" | "setQueuedPrompts" | "reset">;

  constructor(
    attachments: Pick<AttachmentUploadService, "discardChat" | "discardAll">,
    composer: () => Pick<ChatComposerSessionStoreActions, "setDraft" | "setQueuedPrompts" | "reset">,
  ) {
    this.attachments = attachments;
    this.composer = composer;
  }

  discardChat(chatId: string): void {
    this.attachments.discardChat(chatId);
    this.composer().setDraft(chatId, "");
    this.composer().setQueuedPrompts(chatId, []);
  }

  reset(): void {
    this.attachments.discardAll();
    this.composer().reset();
  }
}
