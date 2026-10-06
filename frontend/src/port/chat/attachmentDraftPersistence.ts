import type { Attachment } from "../../models/upload.ts";

export interface AttachmentDraftPersistence {
  read(): Map<string, Attachment[]>;
  write(drafts: ReadonlyMap<string, Attachment[]>): void;
}
