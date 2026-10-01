import assert from "node:assert/strict";
import test from "node:test";
import activate, { fileIdeUrl, workspaceIdeUrl } from "./main.js";

test("Code Server URL uses the project route and selected chat directory", () => {
  assert.equal(
    workspaceIdeUrl("/var/lib/remote/projects/example/workspace/src", "https://remote.example.test"),
    "https://remote.example.test/apps/example/code-server/?folder=%2Fworkspace%2Fsrc",
  );
  assert.equal(workspaceIdeUrl("/opt/remote.futrx", "https://remote.example.test"), null);
});

test("editor icon is contributed only for a project workspace", () => {
  let button;
  activate({
    application: { id: "code-server" },
    slots: { chatHeaderActions: "chat.header.actions", applicationCardActions: "applications.card.actions" },
    files: { registerOpener: () => {} },
    ui: {
      addIconButton: (_slot, contribution) => { button = contribution; },
      addButton: () => {},
    },
  });
  globalThis.window = { location: { origin: "https://remote.example.test" }, open: (...args) => { globalThis.opened = args; } };
  try {
    assert.equal(button.when({ projectId: "p1", cwd: "/var/lib/remote/projects/example/workspace" }), true);
    assert.equal(button.when({ projectId: "p1", cwd: "/opt/remote.futrx" }), false);
    assert.equal(button.when({ cwd: "/var/lib/remote/projects/example/workspace" }), false);
    button.onClick({ cwd: "/var/lib/remote/projects/example/workspace" });
    assert.equal(globalThis.opened[0], "https://remote.example.test/apps/example/code-server/?folder=%2Fworkspace");
  } finally {
    delete globalThis.window;
    delete globalThis.opened;
  }
});

test("settings action belongs only to a running Code Server installation", () => {
  let action;
  activate({
    application: { id: "code-server" },
    slots: { chatHeaderActions: "chat.header.actions", applicationCardActions: "applications.card.actions" },
    files: { registerOpener: () => {} },
    ui: { addIconButton: () => {}, addButton: (_slot, contribution) => { action = contribution; } },
  });
  assert.equal(action.when({ instance: { applicationId: "code-server", status: "running" } }), true);
  assert.equal(action.when({ instance: { applicationId: "code-server", status: "stopped" } }), false);
  assert.equal(action.when({ instance: { applicationId: "other", status: "running" } }), false);
});

test("file links resolve the editor authority after the application launch redirect", () => {
  const raw = fileIdeUrl({ cwd: "/var/lib/remote/projects/example/workspace/src", path: "/workspace/a b/file.md", line: 12, column: 3 }, "https://remote.example.test");
  const url = new URL(raw);
  assert.equal(url.origin, "https://remote.example.test");
  assert.equal(url.pathname, "/apps/example/code-server/_static/remote-open.html");
  assert.equal(url.searchParams.get("folder"), "/workspace/src");
  assert.equal(url.searchParams.get("file"), "/workspace/a b/file.md");
  assert.equal(url.searchParams.get("line"), "12");
  assert.equal(url.searchParams.get("column"), "3");
  assert.equal(url.searchParams.has("payload"), false);
  assert.equal(fileIdeUrl({ cwd: "/var/lib/remote/projects/example/workspace", path: "/etc/passwd" }, url.origin), null);
});
