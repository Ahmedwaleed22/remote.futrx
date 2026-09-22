// Frontend extension API showcase for the Hello Remote template.
//
// Every compact action slot receives the same discoverable icon. The larger
// project settings surface receives a small explanatory panel. Both open one
// explorer so plugin authors can inspect the slot context and try the API from
// the exact surface where their contribution is running.

import {
  claimUploadIfArmed,
  mountSettingsShowcase,
  openFrontendExplorer,
} from "./showcaseExplorer.js";

const SPARK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.3 4.2L17.5 9l-4.2 1.8L12 15l-1.3-4.2L6.5 9l4.2-1.8L12 3Z"/>' +
  '<path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>';
const SPARK_BUTTON_ICON = SPARK_ICON.replace(
  "<svg ",
  '<svg width="16" height="16" '
);

const ACTION_SLOTS = [
  ["sidebarHeaderActions", "Sidebar header"],
  ["sidebarSearchActions", "Sidebar search"],
  ["projectRowActions", "Project row"],
  ["chatHeaderActions", "Chat header"],
  ["composerActions", "Chat composer"],
];

export function activateFrontendShowcase(remote) {
  const observedUploads = { count: 0, latest: null, claimNext: false, claimed: 0 };

  for (const [slotName, surface] of ACTION_SLOTS) {
    remote.ui.addIconButton(remote.slots[slotName], {
      icon: SPARK_ICON,
      label: `Explore Hello Remote from ${surface}`,
      title: `Frontend API · ${surface}`,
      onClick: (context) => openFrontendExplorer(remote, context, observedUploads),
    });
  }

  // A labeled action demonstrates addButton independently from the existing
  // greeting action. The predicate prevents it appearing on every app card.
  remote.ui.addButton(remote.slots.applicationCardActions, {
    label: "API",
    title: "Explore the frontend extension API",
    icon: SPARK_BUTTON_ICON,
    order: -9,
    when: (context) => context.instance?.applicationId === remote.application.id,
    onClick: (context) => openFrontendExplorer(remote, context, observedUploads),
  });

  remote.ui.register(
    remote.slots.projectSettingsPanel,
    (host, context) => mountSettingsShowcase(host, remote, context, observedUploads),
    { order: -100 }
  );

  // Watching is passive unless the user explicitly arms the pass-through
  // claim in the explorer. That claim resolves to the original path: it shows
  // the synchronous claim contract without moving or deleting the attachment.
  remote.events.on("upload.completed", (upload) => {
    observedUploads.count += 1;
    observedUploads.latest = upload;
    claimUploadIfArmed(observedUploads, upload);
    remote.log("upload.completed", {
      chatId: upload.chatId,
      projectId: upload.projectId,
      path: upload.path,
      size: upload.size,
    });
  });
}
