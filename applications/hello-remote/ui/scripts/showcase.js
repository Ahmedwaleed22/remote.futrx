// Frontend extension API showcase for the Hello Remote template.
//
// Every compact action slot receives the same discoverable icon. The larger
// project settings surface receives a small explanatory panel. Both open one
// explorer so plugin authors can inspect the slot context and try the API from
// the exact surface where their contribution is running.

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
  const uploads = { count: 0, latest: null };

  for (const [slotName, surface] of ACTION_SLOTS) {
    remote.ui.addIconButton(remote.slots[slotName], {
      icon: SPARK_ICON,
      label: `Explore Hello Remote from ${surface}`,
      title: `Frontend API · ${surface}`,
      onClick: (context) => openFrontendExplorer(remote, context, uploads),
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
    onClick: (context) => openFrontendExplorer(remote, context, uploads),
  });

  remote.ui.register(
    remote.slots.projectSettingsPanel,
    (host, context) => mountSettingsShowcase(host, remote, context, uploads),
    { order: -100 }
  );

  // Watching is intentionally passive. Calling event.claim(...) would take
  // ownership of a user's attachment, which belongs in a real upload plugin,
  // not in a template whose purpose is to be safe to install and explore.
  remote.events.on("upload.completed", (upload) => {
    uploads.count += 1;
    uploads.latest = upload;
    remote.log("upload.completed", {
      chatId: upload.chatId,
      projectId: upload.projectId,
      path: upload.path,
      size: upload.size,
    });
  });
}

function mountSettingsShowcase(host, remote, context, uploads) {
  const panel = document.createElement("section");
  panel.className = "hello-remote hello-remote__showcase-card";

  const copy = document.createElement("div");
  const title = document.createElement("h4");
  title.className = "hello-remote__title";
  title.textContent = "Hello Remote frontend API";
  const note = document.createElement("p");
  note.className = "hello-remote__note";
  note.textContent = "This panel was mounted through ui.register in the project settings slot.";
  copy.append(title, note);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "hello-remote__button";
  button.textContent = "Explore API";
  const open = () => openFrontendExplorer(remote, context, uploads);
  button.addEventListener("click", open);

  panel.append(copy, button);
  host.appendChild(panel);
  return () => button.removeEventListener("click", open);
}

function openFrontendExplorer(remote, context, uploads) {
  let popup;
  popup = remote.ui.openPopup({
    title: "Hello Remote · Frontend API",
    width: 720,
    html: explorerMarkup(),
    mount: (body) => {
      const output = body.querySelector("[data-showcase-output]");
      const controls = new AbortController();
      const target = { projectId: context.projectId };

      setText(body, "api-version", String(remote.apiVersion));
      setText(body, "application", `${remote.application.name} ${remote.application.version ?? ""}`.trim());
      setText(body, "application-id", remote.application.id);
      setText(body, "install", installSummary(remote.install));
      setText(body, "slot", context.slot);
      setText(body, "context", contextSummary(context));
      setText(body, "backend", backendSummary(remote.backend));
      setText(body, "uploads", uploadSummary(uploads));

      const logo = body.querySelector("[data-showcase-logo]");
      logo.src = remote.assets.url("assets/logo.svg");

      const run = async (button, work) => {
        button.disabled = true;
        output.textContent = "Working…";
        try {
          const result = await work();
          output.textContent = typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2);
        } catch (error) {
          output.textContent = `Error: ${error.message}`;
        } finally {
          button.disabled = false;
        }
      };

      for (const button of body.querySelectorAll("[data-showcase-action]")) {
        button.addEventListener("click", () => {
          switch (button.dataset.showcaseAction) {
            case "call":
              void run(button, () => remote.backend.call("echo", {
                ...target,
                method: "POST",
                body: { message: "Hello from the frontend API" },
                query: { source: "frontend-showcase" },
                headers: { "X-Hello-Remote": "frontend-showcase" },
                signal: controls.signal,
              }));
              break;
            case "fetch":
              void run(button, async () => {
                const response = await remote.backend.fetch("hello", {
                  ...target,
                  headers: { "X-Hello-Remote": "frontend-showcase" },
                  signal: controls.signal,
                });
                return {
                  status: response.status,
                  contentType: response.headers.get("Content-Type"),
                  body: await response.json(),
                };
              });
              break;
            case "describe":
              void run(button, () => remote.backend.describe(target));
              break;
            case "url":
              void run(button, () => ({
                backend: remote.backend.url("hello", target),
                view: remote.views.url("panel"),
                asset: remote.assets.url("assets/logo.svg"),
              }));
              break;
            case "view":
              void run(button, async () => {
                const html = await remote.views.load("panel");
                return { name: "panel", characters: html.length, preview: html.slice(0, 180) };
              });
              break;
            case "log":
              remote.log("frontend API explorer", { context, install: remote.install });
              output.textContent = "Context written through remote.log. Open the browser console to inspect it.";
              break;
            case "close":
              popup.close();
              break;
          }
        }, { signal: controls.signal });
      }

      return () => controls.abort();
    },
  });
  // The returned handle exposes the live body as well as close(). Marking it
  // here makes that half of the popup API visible in browser inspection.
  popup.body.dataset.helloRemoteExplorer = "true";
}

function explorerMarkup() {
  return `
    <div class="hello-remote__explorer">
      <div class="hello-remote__explorer-heading">
        <img data-showcase-logo alt="" />
        <div>
          <h3>Extension capability explorer</h3>
          <p>Opened by a contribution in <code data-showcase-slot></code>.</p>
        </div>
      </div>
      <dl class="hello-remote__api-facts">
        <div><dt>API version</dt><dd data-showcase-api-version></dd></div>
        <div><dt>Application</dt><dd data-showcase-application></dd></div>
        <div><dt>Application ID</dt><dd data-showcase-application-id></dd></div>
        <div><dt>Installed in</dt><dd data-showcase-install></dd></div>
        <div><dt>Slot context</dt><dd data-showcase-context></dd></div>
        <div><dt>Backend</dt><dd data-showcase-backend></dd></div>
        <div><dt>Upload events seen</dt><dd data-showcase-uploads></dd></div>
      </dl>
      <div class="hello-remote__api-actions">
        <button class="hello-remote__button" type="button" data-showcase-action="call">backend.call</button>
        <button class="hello-remote__button" type="button" data-showcase-action="fetch">backend.fetch</button>
        <button class="hello-remote__button" type="button" data-showcase-action="describe">backend.describe</button>
        <button class="hello-remote__button" type="button" data-showcase-action="url">URL helpers</button>
        <button class="hello-remote__button" type="button" data-showcase-action="view">views.load</button>
        <button class="hello-remote__button" type="button" data-showcase-action="log">remote.log</button>
        <button class="hello-remote__button" type="button" data-showcase-action="close">popup.close</button>
      </div>
      <pre class="hello-remote__api-output" data-showcase-output>Select an ability to see its result.</pre>
    </div>`;
}

function setText(root, name, value) {
  root.querySelector(`[data-showcase-${name}]`).textContent = value;
}

export function installSummary(install) {
  const locations = [];
  if (install.global) locations.push("global");
  locations.push(...install.projectIds.map((id) => `project ${id}`));
  return locations.join(", ") || "nowhere";
}

export function contextSummary(context) {
  const values = [
    ["scope", context.scope],
    ["project", context.projectName ?? context.projectId],
    ["chat", context.chatId],
    ["cwd", context.cwd],
    ["instance", context.instance?.id],
  ].filter(([, value]) => value);
  return values.length ? values.map(([name, value]) => `${name}: ${value}`).join(" · ") : "no optional fields";
}

export function backendSummary(backend) {
  return backend.available
    ? `${backend.instances.length} running instance${backend.instances.length === 1 ? "" : "s"}`
    : "unavailable";
}

export function uploadSummary(uploads) {
  if (!uploads.latest) return `${uploads.count} · upload.completed is being observed`;
  return `${uploads.count} · latest: ${uploads.latest.fileName} (${uploads.latest.size} bytes)`;
}
