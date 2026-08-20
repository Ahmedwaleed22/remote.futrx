set -e
# Managed by containers/code_server.go. Installs an on-demand, idle-stopped
# code-server inside a project container. Reached from the host edge at
# <slug>.code.<host> -> <slug>.lxd:8842.
#
# Lifecycle (systemd socket activation -> full scale-to-zero):
#   code-server.socket         listens on 0.0.0.0:8842 (cheap; always armed)
#   code-server-proxy.service  systemd-socket-proxyd --exit-idle-time=10min,
#                              forwards to 127.0.0.1:8081, Requires= the real
#                              service so a first connection pulls it up
#   code-server.service        code-server itself, StopWhenUnneeded=yes so it
#                              stops once the proxy idle-exits. Opens /workspace
#                              by default (the bind-mounted project root), so a
#                              bare URL lands in the workspace like code.<host>
#                              does via ?folder=.
# Substituted from versions.env by containers/codeserver/provisioner.go.
CODE_SERVER_VERSION=__CODE_SERVER_VERSION__

if ! command -v code-server >/dev/null 2>&1 \
   || [ "$(code-server --version 2>/dev/null | head -1 | awk '{print $1}')" != "$CODE_SERVER_VERSION" ]; then
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL --retry 3 -o /tmp/code-server.deb \
        "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${ARCH}.deb"
    apt-get install -y -qq /tmp/code-server.deb
    rm -f /tmp/code-server.deb
fi

install -d -m 0700 /root/.config/code-server
cat > /root/.config/code-server/config.yaml <<'YAML'
# code-server listens on loopback only; the socket-activation proxy on :8842
# is the sole reachable port and Caddy's forward_auth gates it, so auth=none
# is safe here (same rationale as the host config).
bind-addr: 127.0.0.1:8081
auth: none
cert: false
app-name: Futrx IDE
YAML
chmod 0600 /root/.config/code-server/config.yaml

cat > /etc/systemd/system/code-server.service <<'UNIT'
[Unit]
Description=code-server (VS Code in the browser) - on-demand
StopWhenUnneeded=yes

[Service]
Type=exec
Environment=VSCODE_RECONNECTION_GRACE_TIME=60000
ExecStart=/usr/bin/code-server /workspace
ExecStartPost=/usr/bin/bash -c 'for i in $(seq 1 50); do curl -fsS -o /dev/null http://127.0.0.1:8081/healthz && exit 0; sleep 0.2; done; exit 0'
UNIT

cat > /etc/systemd/system/code-server-proxy.service <<'UNIT'
[Unit]
Description=code-server on-demand proxy (idle-exits and releases the IDE)
Requires=code-server.service
After=code-server.service

[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=10min 127.0.0.1:8081
UNIT

cat > /etc/systemd/system/code-server.socket <<'UNIT'
[Unit]
Description=code-server socket (on-demand activation)

[Socket]
ListenStream=0.0.0.0:8842
Service=code-server-proxy.service

[Install]
WantedBy=sockets.target
UNIT

# Managed user settings for this container's code-server. Runtime keys an
# extension may add later (e.g. dbcode.connections) are workspace-specific and
# intentionally omitted here.
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
  "editor.experimentalGpuAcceleration": "on",
  "editor.fontLigatures": false,
  "terminal.integrated.gpuAcceleration": "auto",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "workbench.enableExperiments": false,
  "workbench.settings.enableNaturalLanguageSearch": false,
  "git.autorefresh": false,
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

# Per-workspace window title so each PWA/dock window is identifiable. The
# backend passes CODE_SERVER_WS_NAME=<project name>; fall back to the slug.
export CODE_SERVER_WS_NAME="${CODE_SERVER_WS_NAME:-$(hostname)}"
node -e 'const fs=require("fs");const p="/root/.local/share/code-server/User/settings.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));s["window.title"]=process.env.CODE_SERVER_WS_NAME;fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")' 2>/dev/null || true

# --- Brand the IDE to match the code.<host> launcher ------------------------
# code-server ships its own favicon and PWA icons; replace them with the Futrx
# launcher mark so a project's browser tab and any per-project installed PWA use
# the same icon as code.<host> (otherwise an installed per-project IDE shows
# code-server's default logo). Best-effort: media paths can shift between
# releases, so a miss must never fail provisioning.
FUTRX_MEDIA=""
for d in /usr/lib/code-server/src/browser/media /usr/lib/code-server/out/browser/media; do
    [ -d "$d" ] && FUTRX_MEDIA="$d" && break
done
if [ -n "$FUTRX_MEDIA" ]; then
    cat > "$FUTRX_MEDIA/favicon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#0f1014"/>
  <rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="#24252b" stroke-width="6"/>
  <g transform="translate(256 256) scale(0.66) translate(-256 -256)"
     fill="none" stroke="#8ab4ff" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
    <path d="M196 196 L132 256 L196 316"/>
    <path d="M316 196 L380 256 L316 316"/>
    <path d="M232 348 L280 164" stroke="#b8a8ff"/>
  </g>
</svg>
SVG
    cp -f "$FUTRX_MEDIA/favicon.svg" "$FUTRX_MEDIA/favicon-dark-support.svg" 2>/dev/null || true
    # Raster icon for the manifest/PWA install + dock. One 512 master, copied
    # over every size code-server references (browsers scale as needed).
    if base64 -d > /tmp/futrx-icon.png <<'B64' 2>/dev/null
__FUTRX_ICON_PNG_B64__
B64
    then
        for f in "$FUTRX_MEDIA"/pwa-icon*.png "$FUTRX_MEDIA"/code-server.png "$FUTRX_MEDIA"/favicon.png; do
            [ -e "$f" ] && cp -f /tmp/futrx-icon.png "$f" 2>/dev/null || true
        done
        rm -f /tmp/futrx-icon.png
    fi
fi

systemctl daemon-reload 2>/dev/null || true
systemctl enable code-server.socket >/dev/null 2>&1 || true
