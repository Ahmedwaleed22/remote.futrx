# Composer drafts across navigation

Unsent text already uses the per-tab composer session store on QA. Attachments now have the same chat-session ownership: leaving a chat or opening settings neither clears attachments nor aborts an upload. Returning to a chat restores its own attachment list and pending state. Overlapping upload batches stay pending until all complete.

Completed upload metadata (name, size, server path and image flag) is saved to sessionStorage. A reload restores completed attachment chips and server-backed previews; file bytes and temporary blob URLs are not serialized. In-flight uploads survive SPA navigation but a full browser reload still interrupts them. Once an upload completes, its temporary blob URL is released. Sending or removing an attachment clears its draft entry; chat deletion and explicit sign-out release resources and clear saved drafts.

Validation: frontend production build; unit tests for persisted attachments, chat isolation, overlapping uploads, removal, storage failure and sign-out. The performance branch's Chromium harness also verifies unsent text and image preservation across project/settings navigation and reload, with one upload and zero navigation-triggered aborts:

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
  node /workspace/remote-futrx-loading-perf/scripts/performance/browser.mjs \
  /workspace/remote-futrx-chat-drafts --drafts
```
