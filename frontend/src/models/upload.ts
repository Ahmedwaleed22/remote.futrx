export interface Attachment {
  id: string;
  name: string;
  size: number;
  serverPath: string;
  isImage: boolean;
  objectUrl?: string;
  /** 0–1, only set while uploading. */
  progress?: number;
  /** Error message from the tus client; presence implies the upload failed. */
  error?: string;
}

export interface AttachmentDraftState {
  attachments: ReadonlyMap<string, Attachment[]>;
  pending: ReadonlyMap<string, number>;
}
export interface AttachmentDraftActions {
  update: (chatId: string, change: (previous: Attachment[]) => Attachment[], persist?: boolean) => void;
  begin: (chatId: string) => void;
  finish: (chatId: string) => void;
}

export interface AttachmentUploadTarget {
  attachmentBasePath: string;
  projectId?: string;
}
