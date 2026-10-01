#!/usr/bin/env bash
set -euo pipefail
# Code Server is an optional project application. Remote owns its systemd service.
CODE_SERVER_VERSION=4.121.0
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in amd64|arm64) ;; *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; esac
# An older project image may still have the legacy socket enabled.
systemctl disable --now code-server.socket 2>/dev/null || true
systemctl disable --now code-server-proxy.service 2>/dev/null || true
systemctl stop code-server.service 2>/dev/null || true
rm -f /etc/systemd/system/code-server.socket /etc/systemd/system/code-server-proxy.service

if ! command -v code-server >/dev/null 2>&1 \
   || [ "$(code-server --version 2>/dev/null | head -1 | awk '{print $1}')" != "$CODE_SERVER_VERSION" ]; then
    deb="$(mktemp --suffix=.deb)"
    trap 'rm -f "$deb"' EXIT
    curl -fsSL --retry 3 -o "$deb" \
        "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${ARCH}.deb"
    apt-get -o DPkg::Lock::Timeout=300 install -y -qq "$deb"
fi

# The stable launch route redirects to an installation-specific origin. Resolve
# file links there so VS Code's remote URI uses that origin, including after a
# reinstall. Code Server serves this page through its existing static route.
cat > /usr/lib/code-server/remote-open.html <<'REMOTE_OPEN_HTML'
<!doctype html>
<meta charset="utf-8">
<title>Opening workspace file</title>
<p>Opening workspace file…</p>
<script>
(() => {
  const query = new URL(location.href).searchParams;
  const file = query.get("file");
  const folder = query.get("folder") || "/workspace";
  const inWorkspace = (path) => path === "/workspace" || path?.startsWith("/workspace/");
  if (!inWorkspace(file) || !inWorkspace(folder)) {
    document.querySelector("p").textContent = "Invalid workspace file.";
    return;
  }
  const target = new URL("/", location.origin);
  target.searchParams.set("folder", folder);
  let uri = `vscode-remote://${location.host}${file.split("/").map(encodeURIComponent).join("/")}`;
  const payload = [];
  const line = Number(query.get("line"));
  const column = Number(query.get("column"));
  if (Number.isInteger(line) && line > 0) {
    uri += `:${line}`;
    if (Number.isInteger(column) && column > 0) uri += `:${column}`;
    payload.push(["openFile", uri], ["gotoLineMode", "true"]);
  } else {
    payload.push(["openFile", uri]);
  }
  target.searchParams.set("payload", JSON.stringify(payload));
  location.replace(target.toString());
})();
</script>
REMOTE_OPEN_HTML
chmod 0644 /usr/lib/code-server/remote-open.html

install -d -m 0700 /root/.config/code-server
cat > /root/.config/code-server/config.yaml <<YAML
bind-addr: 0.0.0.0:8842
auth: none
cert: false
app-name: Futrx IDE - $(hostname)
YAML
chmod 0600 /root/.config/code-server/config.yaml

# Managed user settings for this container's code-server. Runtime keys an
# extension may add later (e.g. dbcode.connections) are workspace-specific and
# intentionally omitted here.
#
# Note: editor.experimentalGpuAcceleration stays "off" (upstream default). Its
# WebGPU renderer observes the editor canvas with
# ResizeObserver.observe(el, { box: ['device-pixel-content-box'] }), which
# WebKit does not implement -- observe() throws, VS Code rethrows it as
# "Could not observe device pixel dimensions", and the editor never mounts. On
# iOS/iPadOS every browser is WebKit, so turning this on breaks opening ANY
# file from a phone ("Unable to open '<file>'") while the explorer still
# renders. Settings here are server-side and shared by every client of this
# container, so there is no per-client opt-out -- desktop Chrome would have to
# cost mobile the editor entirely. Keep it off.
# Link the whole User directory: VS Code saves files with atomic rename, which
# would replace a settings.json symlink. All user settings now live durably.
export CODE_SERVER_WS_NAME="${CODE_SERVER_WS_NAME:-$(hostname)}"
node <<'NODE'
const fs = require("fs");
const path = require("path");
const root = "/workspace/.remote/code-server";
const durable = path.join(root, "User");
const active = "/root/.local/share/code-server/User";
const legacy = path.join(root, "settings.json");
fs.mkdirSync(durable, { recursive: true, mode: 0o700 });
fs.chmodSync(root, 0o700);
fs.chmodSync(durable, 0o700);
fs.mkdirSync(path.dirname(active), { recursive: true });
const current = fs.lstatSync(active, { throwIfNoEntry: false });
const linked = current?.isSymbolicLink() && fs.realpathSync(active) === fs.realpathSync(durable);
if (current && !linked) {
  // Existing editor changes win over the old saved copy. Copy bytes unchanged,
  // including JSON with comments, keybindings, profiles and extension state.
  fs.cpSync(fs.realpathSync(active), durable, { recursive: true, force: true });
}
const settingsFile = path.join(durable, "settings.json");
if (!fs.existsSync(settingsFile)) {
  if (fs.existsSync(legacy)) {
    fs.copyFileSync(legacy, settingsFile);
  } else {
    const settings = JSON.parse(process.env.CODE_SERVER_SETTINGS_JSON || "null");
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("Code Server settings must be a JSON object");
    }
    if (settings["window.title"] === "${rootPath}") {
      settings["window.title"] = process.env.CODE_SERVER_WS_NAME;
    }
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  }
}
fs.chmodSync(settingsFile, 0o600);
if (!linked) {
  // Keep the original until the link is installed successfully.
  const backup = fs.mkdtempSync(path.join(path.dirname(active), ".User-migration-"));
  const saved = path.join(backup, "User");
  if (current) fs.renameSync(active, saved);
  try {
    fs.symlinkSync(durable, active, "dir");
  } catch (error) {
    if (current) fs.renameSync(saved, active);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}
// The old independent copy is no longer authoritative.
fs.rmSync(legacy, { force: true });
NODE

# Pinned extensions, best-effort: a flaky Open VSX must never fail the build.
for ext in \
    anan.jetbrains-darcula-theme \
    anwar.papyrus-pdf \
    chuckjonas.duckdb \
    dbcode.dbcode \
    golang.go \
    onlyutkarsh.mermaid-diagram-lens \
    pkief.material-icon-theme \
    repreng.csv \
    ; do
    code-server --install-extension "$ext" >/dev/null 2>&1 || true
done
