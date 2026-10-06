import { createAttachmentDraftStorage } from "../../../api/chat/attachmentDraftStorage.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createAttachmentDraftStore } from "./attachmentDraftStore.ts";
import type { Attachment } from "../../../models/upload.ts";
const image: Attachment = {
  id: "image-1",
  name: "screen.png",
  size: 1234,
  isImage: true,
  serverPath: "/workspace/.uploads/screen.png",
  objectUrl: "blob:original",
  progress: 1,
};
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("uploaded images survive navigation and store recreation without persisting blobs", () => {
  const saved = storage();
  const first = createAttachmentDraftStore(createAttachmentDraftStorage(saved));
  first.getState().update("aaaa", () => [image], true);
  first.getState().update("bbbb", () => [{ ...image, id: "second" }], true);
  const next = createAttachmentDraftStore(createAttachmentDraftStorage(saved));
  assert.equal(
    next.getState().attachments.get("aaaa")?.[0].serverPath,
    image.serverPath,
  );
  assert.match(
    next.getState().attachments.get("aaaa")?.[0].objectUrl ?? "",
    /^\/api\/chats\/aaaa\/media-open/,
  );
  assert.equal(next.getState().attachments.get("bbbb")?.[0].id, "second");
  assert.equal(
    JSON.stringify([...next.getState().attachments]).includes("blob:original"),
    false,
  );
  first.getState().update("aaaa", () => [], true);
  assert.equal(
    createAttachmentDraftStore(createAttachmentDraftStorage(saved))
      .getState()
      .attachments.has("aaaa"),
    false,
  );
  assert.equal(
    createAttachmentDraftStore(createAttachmentDraftStorage(saved))
      .getState()
      .attachments.has("bbbb"),
    true,
  );
});
test("overlapping uploads stay pending until all batches finish", () => {
  const store = createAttachmentDraftStore(createAttachmentDraftStorage(null));
  store.getState().begin("aaaa");
  store.getState().begin("aaaa");
  store.getState().finish("aaaa");
  assert.equal(store.getState().pending.get("aaaa"), 1);
  store.getState().finish("aaaa");
  assert.equal(store.getState().pending.has("aaaa"), false);
});
test("storage failures leave draft images in memory", () => {
  const store = createAttachmentDraftStore(
    createAttachmentDraftStorage({
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("quota");
      },
    }),
  );
  store.getState().update("aaaa", () => [image], true);
  assert.equal(store.getState().attachments.get("aaaa")?.[0].id, image.id);
});
