#!/usr/bin/env bash
set -euo pipefail
# Code Server is an optional project application. Remote owns its systemd units.
CODE_SERVER_VERSION=4.121.0
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in amd64|arm64) ;; *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; esac
if ! command -v code-server >/dev/null 2>&1 \
   || [ "$(code-server --version 2>/dev/null | head -1 | awk '{print $1}')" != "$CODE_SERVER_VERSION" ]; then
    deb="$(mktemp --suffix=.deb)"
    trap 'rm -f "$deb"' EXIT
    curl -fsSL --retry 3 -o "$deb" \
        "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${ARCH}.deb"
    apt-get -o DPkg::Lock::Timeout=300 install -y -qq "$deb"
fi

# An older project image may still have the legacy socket enabled.
systemctl disable --now code-server.socket 2>/dev/null || true
systemctl stop code-server-proxy.service code-server.service 2>/dev/null || true

install -d -m 0700 /root/.config/code-server
cat > /root/.config/code-server/config.yaml <<'YAML'
bind-addr: 127.0.0.1:8081
auth: none
cert: false
app-name: Futrx IDE
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
install -d -m 0755 /root/.local/share/code-server/User
cat > /root/.local/share/code-server/User/settings.json <<'JSON'
{
  "window.title": "${rootPath}",
  "workbench.iconTheme": "material-icon-theme",
  "chat.disableAIFeatures": true,
  "chat.commandCenter.enabled": false,
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/node_modules/**": true,
    "**/dist/**": true,
    "**/build/**": true,
    "**/.next/**": true,
    "**/.nuxt/**": true,
    "**/.cache/**": true,
    "**/.turbo/**": true,
    "**/vendor/**": true,
    "**/.venv/**": true,
    "**/__pycache__/**": true,
    "**/target/**": true
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/.git": true,
    "**/.DS_Store": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/build": true,
    "**/.next": true,
    "**/vendor": true,
    "**/.cache": true,
    "**/.turbo": true,
    "**/package-lock.json": true,
    "**/yarn.lock": true,
    "**/pnpm-lock.yaml": true
  },
  "typescript.tsserver.maxTsServerMemory": 3072,
  "typescript.disableAutomaticTypeAcquisition": true,
  "editor.smoothScrolling": false,
  "editor.cursorSmoothCaretAnimation": "off",
  "editor.cursorBlinking": "solid",
  "workbench.list.smoothScrolling": false,
  "workbench.reduceMotion": "on",
  "terminal.integrated.smoothScrolling": false,
  "editor.minimap.enabled": false,
  "editor.renderWhitespace": "none",
  "editor.guides.indentation": false,
  "editor.guides.bracketPairs": false,
  "editor.bracketPairColorization.enabled": true,
  "editor.occurrencesHighlight": "off",
  "editor.selectionHighlight": false,
  "editor.codeLens": false,
  "breadcrumbs.enabled": false,
  "editor.linkedEditing": false,
  "editor.stickyScroll.enabled": false,
  "editor.experimentalGpuAcceleration": "off",
  "editor.fontLigatures": false,
  "terminal.integrated.gpuAcceleration": "auto",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "workbench.enableExperiments": false,
  "workbench.settings.enableNaturalLanguageSearch": false,
  "git.autorefresh": true,
  "git.decorations.enabled": true,
  "scm.diffDecorations": "gutter",
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1500,
  "workbench.editor.enablePreview": false,
  "workbench.editor.limit.enabled": true,
  "workbench.editor.limit.value": 10,
  "workbench.colorTheme": "JetBrains Darcula Theme",
  "mermaidLivePreview.previewAppearance": "light",
  "mermaidLivePreview.useVSCodeTheme": false,
  "mermaidLivePreview.theme": "default",
  "git.openRepositoryInParentFolders": "always",
  "security.workspace.trust.enabled": false
}
JSON

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

# Use the container hostname (the project slug) as the window title so each
# PWA or dock window is identifiable.
export CODE_SERVER_WS_NAME="${CODE_SERVER_WS_NAME:-$(hostname)}"
node -e 'const fs=require("fs");const p="/root/.local/share/code-server/User/settings.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));s["window.title"]=process.env.CODE_SERVER_WS_NAME;fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")' 2>/dev/null || true
