import { openSettingsForm } from "./settingsForm.js";

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>';

// Chat cwd is the host path to the bind-mounted project workspace.
const WORKSPACE = /^\/var\/lib\/remote\/projects\/([a-z0-9][a-z0-9-]*)\/workspace(?:\/(.*))?$/;

export function workspaceIdeUrl(cwd, installed, subdomain, origin = window.location.origin) {
  const match = WORKSPACE.exec(cwd || "");
  if (!match || !installed || match[1].length > 63 || match[1].endsWith("-") || ["dev", "code", "apps"].includes(match[1])) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain || "")) return null;
  const base = new URL(origin);
  base.hostname = `${subdomain}.${match[1]}.${base.hostname}`;
  base.pathname = "/";
  base.searchParams.set("folder", match[2] ? `/workspace/${match[2]}` : "/workspace");
  return base.toString();
}

export function fileIdeUrl({ cwd, path, line, column }, installed, subdomain, origin = window.location.origin) {
  const url = workspaceIdeUrl(cwd, installed, subdomain, origin);
  if (!url || (path !== "/workspace" && !path.startsWith("/workspace/"))) return null;
  if (path === "/workspace") return url;
  const result = new URL(url);
  // The application page builds the editor payload on its own origin.
  result.pathname += "_static/remote-open.html";
  result.searchParams.set("file", path);
  if (line && line > 0) {
    result.searchParams.set("line", String(line));
    if (column && column > 0) result.searchParams.set("column", String(column));
  }
  return result.toString();
}

export default function activate(remote) {
  // Read current availability; the project slug keeps the address stable on reinstall.
  const isInstalled = (projectId) => remote.backend.instances.some(
    (instance) => instance.scope === "project" && instance.projectId === projectId,
  );
  remote.files.registerOpener((request) => fileIdeUrl(request, isInstalled(request.projectId), remote.application.web?.subdomain));
  remote.ui.addIconButton(remote.slots.chatHeaderActions, {
    icon: ICON,
    label: "Workspace IDE",
    title: "Open workspace in IDE",
    when: (context) => Boolean(context.projectId && workspaceIdeUrl(context.cwd, isInstalled(context.projectId), remote.application.web?.subdomain)),
    onClick: (context) => {
      const url = workspaceIdeUrl(context.cwd, isInstalled(context.projectId), remote.application.web?.subdomain);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    },
  });

  remote.ui.addButton(remote.slots.applicationCardActions, {
    label: "Settings",
    title: "Edit Code Server settings",
    when: (context) => context.instance?.applicationId === remote.application.id &&
      context.instance?.status === "running",
    onClick: (context) => openSettingsForm(remote, context.instance.id),
  });
}
