import assert from "node:assert/strict";
import test from "node:test";
import activate, { fileIdeUrl, workspaceIdeUrl } from "./main.js";

test("Code Server URL uses the installation subdomain and selected chat directory", () => {
  assert.equal(
    workspaceIdeUrl("/var/lib/remote/projects/example/workspace/src", "abcdef123456", "code", "https://remote.example.test"),
    "https://code.abcdef123456.apps.remote.example.test/?folder=%2Fworkspace%2Fsrc",
  );
  assert.equal(workspaceIdeUrl("/opt/remote.futrx", "abcdef123456", "code", "https://remote.example.test"), null);
});

test("editor icon is contributed only for a project workspace", () => {
  let button;
  activate({
    application: { id: "code-server", web: { subdomain: "code" } },
    backend: { instances: [{ instanceId: "abcdef123456", scope: "project", projectId: "p1" }] },
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
    button.onClick({ projectId: "p1", cwd: "/var/lib/remote/projects/example/workspace" });
    assert.equal(globalThis.opened[0], "https://code.abcdef123456.apps.remote.example.test/?folder=%2Fworkspace");
  } finally {
    delete globalThis.window;
    delete globalThis.opened;
  }
});

test("settings action belongs only to a running Code Server installation", () => {
  let action;
  activate({
    application: { id: "code-server", web: { subdomain: "code" } },
    backend: { instances: [{ instanceId: "abcdef123456", scope: "project", projectId: "p1" }] },
    slots: { chatHeaderActions: "chat.header.actions", applicationCardActions: "applications.card.actions" },
    files: { registerOpener: () => {} },
    ui: { addIconButton: () => {}, addButton: (_slot, contribution) => { action = contribution; } },
  });
  assert.equal(action.when({ instance: { applicationId: "code-server", status: "running" } }), true);
  assert.equal(action.when({ instance: { applicationId: "code-server", status: "stopped" } }), false);
  assert.equal(action.when({ instance: { applicationId: "other", status: "running" } }), false);
});

test("file links go directly to the installation subdomain", () => {
  const raw = fileIdeUrl({ cwd: "/var/lib/remote/projects/example/workspace/src", path: "/workspace/a b/file.md", line: 12, column: 3 }, "abcdef123456", "code", "https://remote.example.test");
  const url = new URL(raw);
  assert.equal(url.origin, "https://code.abcdef123456.apps.remote.example.test");
  assert.equal(url.pathname, "/_static/remote-open.html");
  assert.equal(url.searchParams.get("folder"), "/workspace/src");
  assert.equal(url.searchParams.get("file"), "/workspace/a b/file.md");
  assert.equal(url.searchParams.get("line"), "12");
  assert.equal(url.searchParams.get("column"), "3");
  assert.equal(url.searchParams.has("payload"), false);
  assert.equal(fileIdeUrl({ cwd: "/var/lib/remote/projects/example/workspace", path: "/etc/passwd" }, "abcdef123456", "code", "https://remote.example.test"), null);
});

test("links select the current project and refresh after an installation is replaced", () => {
  let opener, button;
  const backend = { instances: [
    { instanceId: "abcdef123456", scope: "project", projectId: "p1" },
    { instanceId: "123456abcdef", scope: "project", projectId: "p2" },
  ] };
  activate({
    application: { id: "code-server", web: { subdomain: "code" } }, backend,
    slots: { chatHeaderActions: "header", applicationCardActions: "card" },
    files: { registerOpener: (callback) => { opener = callback; } },
    ui: { addIconButton: (_slot, contribution) => { button = contribution; }, addButton: () => {} },
  });
  globalThis.window = { location: { origin: "https://remote.example.test:8443" } };
  try {
    const request = { projectId: "p1", cwd: "/var/lib/remote/projects/example/workspace", path: "/workspace/README.md" };
    assert.equal(new URL(opener(request)).host, "code.abcdef123456.apps.remote.example.test:8443");
    assert.equal(new URL(opener({ ...request, projectId: "p2" })).hostname, "code.123456abcdef.apps.remote.example.test");
    assert.equal(opener({ ...request, projectId: "missing" }), null);
    backend.instances[0] = { ...backend.instances[0], instanceId: "654321fedcba" };
    assert.equal(new URL(opener(request)).hostname, "code.654321fedcba.apps.remote.example.test");
    backend.instances = [];
    assert.equal(opener(request), null);
    assert.equal(button.when(request), false);
  } finally { delete globalThis.window; }
});

test("the manifest label and installation ID independently determine the app hostname", () => {
  for (const label of ["code", "vscode", "editor-2"]) {
    for (const id of ["abcdef123456", "123456abcdef"]) {
      const url = new URL(workspaceIdeUrl("/var/lib/remote/projects/example/workspace", id, label, "https://qa.remote.example.test:8443"));
      assert.equal(url.host, `${label}.${id}.apps.qa.remote.example.test:8443`);
      assert.equal(url.searchParams.get("folder"), "/workspace");
    }
  }
  for (const label of [undefined, "", "bad.name", "Bad", "bad-", "-bad"]) {
    assert.equal(workspaceIdeUrl("/var/lib/remote/projects/example/workspace", "abcdef123456", label, "https://remote.test"), null);
  }
});
