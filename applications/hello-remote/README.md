# Hello Remote

The catalog's worked example. It combines three application capabilities:

- **`infra/`** — bundled container-side Go source, packaged and built using the
  same payload pattern as s3disk.
- **`backend/`** — Go source the server compiles and runs as a child process,
  reachable at `/api/applications/<instance>/backend/<path>`.
- **`ui/`** — assets the SPA loads for users who installed the application, which
  call that plugin through `remote.backend.call(...)`.

Its infrastructure installs only `hello-remote-info`; it starts no service and
opens no port. A project installation uses the project's existing LXD container.
A global installation demonstrates the other generic path by using a dedicated
application container. Both are ordinary sibling containers on the host—there
is no LXD inside LXD. The host backend invokes the installed command with
`lxc exec`.
Raw LXD configuration and environment variables are deliberately not returned
because they can contain secrets.

The backend runs on the Remote host, not inside LXD. The generic infrastructure
capability supplies `ContainerName`, without any Remote-specific code changes.

## Installing it

| Scope | Where |
|---|---|
| Global | **Settings → Applications** |
| Project | **Project → Applications** |

The install dialog shows one field, `Greeting`, because `application.json` declares
it in `env[]`. Whatever is typed there reaches the plugin as
`Instance.Env["HELLO_GREETING"]` — the same path a database application's password
takes.

Install it at both scopes to compare a dedicated global application container
with an existing project container. Each installation has a separate backend
process, `DataDir`, and counter.

**A server that runs an application backend needs a Go toolchain**, because plugin
source is compiled on the host. Without one, the install reports that on the
instance instead of failing the server. See
[14 — Troubleshooting](../../docs/dev/installable-applications/14-troubleshooting.md).

## What it does

Two contributions, both calling the plugin:

| Where | What |
|---|---|
| **Say hello** on this application's card | Opens a popup with the plugin's reply |
| A panel below the applications list | Shows the greeting, counter, and live container facts |

The greeting comes back as `"<greeting>, <your email>."`. The email is proof
of something worth seeing: the browser never sent it. The server stamps the
signed-in caller onto every forwarded request and withholds the cookies that
authenticated it, so a plugin can tell who is asking and cannot act as them.

The counter is proof of the other half. The plugin process is killed on stop,
on uninstall, and on server restart, and is started again lazily by the next
call — so a count that survives is a count that reached `DataDir`. Restart the
server, open the panel, and the number is still there.

The container section reports its LXD name, hostname, operating system, kernel,
architecture, CPU count, total memory, and uptime. **Refresh** runs the inspection
again.

## Reading it

| File | Shows |
|---|---|
| `application.json` | The manifest: scopes, `env[]`, and backend options. The `ui` block is omitted, so the layout convention finds the entry, styles and views. |
| `infra/install.sh` | The idempotent container provisioner that builds the bundled inspector. |
| `infra/source/` | The independent container-side Go module, command, and tests. It is nested one level down so the catalog can embed the outer infrastructure files. |
| `infra/package.sh`, `infra/payload.tar.gz` | The reproducible payload builder and generated source archive. |
| `backend/main.go` | `Describe` / `Init` / `Handle`, a `Mux`, per-instance storage, and bounded container calls. |
| `backend/main_test.go` | A plugin is ordinary Go in the catalog module, so `go test ./...` from the repository root covers it with no server involved. |
| `ui/scripts/main.js` | The entry module: one card button, one panel, and a render function that cleans up after itself. |
| `ui/views/panel.html`, `ui/style/hello.css` | The two conventions — views loaded by name, CSS written against the platform's theme tokens. |

Full documentation is in [`docs/dev/installable-applications/`](../../docs/dev/installable-applications/); the tutorial that builds an
application from nothing is
[07 — Tutorial](../../docs/dev/installable-applications/07-tutorial-build-a-plugin.md).

## Editing it

The `ui/`, `backend/`, and generated infrastructure payload are embedded in the
binary, so changes need a backend rebuild — `npm run dev` will not pick them up.
A `backend/` edit is recompiled by the server on the next start because the
build fingerprint changed. Run `./infra/package.sh` after changing container-side Go source and
bump the application version when installed copies must be reprovisioned.
