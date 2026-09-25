# Code Server

Optional browser editor for a project workspace. Install it from that project's
Applications page. Its icon appears in the chat header only while the project
installation is running. The existing `code.<host>/<slug>/` route and PWA
launcher continue to open the same workspace.

Before selecting **Install**, edit the complete **VS Code settings.json** field.
It starts with the current Remote defaults from `infra/settings.json` and accepts
any valid JSON object of VS Code settings. The selected document is validated,
stored with the project application, and written to Code Server's user settings
on install or container restoration. The selected value is treated as a secret
because extension settings may contain credentials. A custom `window.title`
is retained; the default placeholder becomes the project slug. Code Server's
bind address, authentication, and socket ports remain owned by Remote so its
IDE route continues to work.

The install downloads Code Server 4.121.0 for amd64 or arm64, applies the
current workspace settings and extensions, and creates a socket-activated
service. The listening socket uses little memory; the editor process starts
when someone opens it and stops after the proxy has been idle for ten minutes.
Stop or uninstall disables the socket and stops both processes. Uninstall leaves
the package, settings, and extensions in the project container; it can be
installed again without redownloading the matching package. Deleting or
recycling the project container removes those files; the saved install settings
are reapplied when a running installation is restored.

The Files drawer downloads source files when Code Server is not running. A
direct IDE link still requires the app and returns 404 while it is stopped or
uninstalled. A workspace upgrade re-installs running project applications in
the replacement container; stopped installations stay stopped. Normal project
startup also restores running applications after a missing container is
recreated. Starting a stopped installation after container replacement
reinstalls its missing service and package.

Verification in a running project container: `systemctl is-active
code-server.socket` reports `active`, while `code-server.service` may be
inactive until the first visit. Open the project IDE URL through Remote's
authenticated Caddy route, then check `code-server.service` and
`code-server-proxy.service`. Stop the application and confirm the icon is gone
and the socket is inactive. The project port 8842 is reached directly from
Caddy on the LXD bridge; no public host port is allocated.

This application is project scoped because the current IDE runs in the project
container and edits `/workspace`. Global installation would run in a separate
container without that workspace. On older project containers, Code Server may
already be installed by the old base image; the application takes over its
systemd units when installed.
