# 15 — Backend plugins

An application can ship a `backend/api/` directory of Go source. The server compiles it,
runs it as a separate process, and forwards HTTP calls to it — so an application can
add a **server-side feature**, and its `ui/` can call that feature, without any
change to the Remote codebase.

```
applications/my-backend/
  application.json
  backend/
    api/              ← Go source, compiled and run on the host
      main.go
  ui/                ← runs in the browser, calls the plugin
    scripts/main.js
```

`ui/` is what an application can add to the interface. `backend/api/` is what it can add
to the server. Together they are the whole shape of a feature that could
otherwise only be added by editing this repository.

## The shortest complete plugin

```go
package main

import (
	"net/http"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
	"github.com/futrx-com/remote.futrx.com/pkg/appplugin/pluginrpc"
)

type backend struct {
	// OPTIONAL — Mux is a routing convenience, not part of Backend.
	mux      *appplugin.Mux
	instance appplugin.Instance
}

// REQUIRED — serve a value implementing appplugin.Backend.
func main() {
	b := &backend{mux: appplugin.NewMux()}
	b.mux.GET("hello", "Say hello", func(request appplugin.Request) appplugin.Response {
		return appplugin.JSON(http.StatusOK, map[string]string{
			"hello": request.Caller.Email,
		})
	})
	pluginrpc.Serve(b)
}

// REQUIRED — APIVersion must be the SDK constant.
func (b *backend) Describe() (appplugin.Descriptor, error) {
	return appplugin.Descriptor{
		Name:       "My Plugin",
		APIVersion: appplugin.APIVersion,
		Routes:     b.mux.Routes(),
	}, nil
}

// REQUIRED — called once before the first request.
func (b *backend) Init(instance appplugin.Instance) error {
	b.instance = instance
	return nil
}

// REQUIRED — may be called concurrently.
func (b *backend) Handle(request appplugin.Request) (appplugin.Response, error) {
	return b.mux.Serve(request), nil
}
```

and in `application.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "scopes": ["global", "project"]
}
```

From the browser:

```js
const greeting = await remote.backend.call("hello");
```

That is the entire round trip.

## Required surface

The host side is a Go program rooted at `backend/api/`. These are the parts a
plugin must have; `Mux`, `appplugin.JSON`, route registration, persistence, and
the route table are conveniences rather than contract requirements.

| Requirement | Enforced by | Failure if omitted |
|---|---|---|
| `package main` and at least one non-test Go file in `backend/api/` | catalog validator | application is refused at load |
| no `go.mod` or `go.sum` in `backend/api/` | catalog validator; Remote generates the module | application is refused at load |
| `func main()` calling `pluginrpc.Serve` | compiler and plugin handshake | build failure, or a process that cannot connect |
| `Describe() (appplugin.Descriptor, error)` | `appplugin.Backend` interface | build failure |
| `Init(appplugin.Instance) error` | `appplugin.Backend` interface | build failure |
| `Handle(appplugin.Request) (appplugin.Response, error)` | `appplugin.Backend` interface | build failure |
| `Descriptor.APIVersion: appplugin.APIVersion` | runtime handshake | host refuses the plugin |

Do not repeat the package version in `Describe`. Remote fills
`Descriptor.Version` from `application.json` after the handshake, making the
manifest the single version source for the UI, upgrade policy, and backend
descriptor.

`backend/container/` is a separate, optional execution context. Programs under
`backend/container/cmd/<binary>/` are copied into and built inside LXD. Their
only required Go surface is `package main` and `func main()`; Remote owns their
module fallback, packaging, toolchain, installation, and build marker.

## The contract

The Go types are in
[`pkg/appplugin/contract.go`](../../../backend/pkg/appplugin/contract.go). A
plugin implements three methods.

| Method | When | Notes |
|---|---|---|
| `Describe()` | once, on connect | Name and route table. Must report `appplugin.APIVersion`; Remote supplies the version from `application.json`. |
| `Init(Instance)` | once, before the first request | The install this process serves. Returning an error fails the app's install or start. |
| `Handle(Request)` | per request | May be called concurrently. |

### `Instance`

What `Init` receives, fixed for the process's lifetime:

| Field | Notes |
|---|---|
| `ID`, `ApplicationID` | the installed copy, and the application it came from |
| `Scope`, `ProjectID` | `"global"`, or `"project"` with the project |
| `ContainerName`, `InternalPort`, `ExternalPort` | the container half, when the application has one |
| `Env` | the install's resolved inputs, **including generated secrets** |
| `DataDir` | a directory on the host this instance owns and may write to |

`Env` carries real passwords: a database application's plugin needs the one its own
`install.sh` generated. That is deliberate, and it is why what a plugin does
with them is a review question — see [13 — Security model](13-security-model.md).

`DataDir` survives stop and start, and is deleted on uninstall. It is the only
storage the platform gives a plugin.

### `Request`

| Field | Notes |
|---|---|
| `Method`, `Path`, `Query`, `Headers`, `Body` | the browser's call. `Path` is relative to the instance's `/backend/` prefix and has no leading slash. |
| `Caller` | `{ Email, IsAdmin }`, resolved by the server |

**`Caller` is stamped by the server, not read from the request.** A browser
cannot forge it, which is what makes it usable for authorization. The transport
withholds the caller's `Cookie` and `Authorization` headers, so a plugin is told
who is asking without being handed the means to act as them.

Bodies are capped at 1 MiB.

### `Response`

`{ Status, Headers, Body }`. A zero `Status` is sent as `200`. `Set-Cookie` and
hop-by-hop headers are dropped, and every response is served `nosniff`.

Build one with the helpers rather than by hand:

```go
appplugin.JSON(http.StatusOK, value)
appplugin.Text(http.StatusOK, "plain")
appplugin.Errorf(http.StatusForbidden, "%s may not do that", request.Caller.Email)
```

`Errorf` produces `{"error": "…"}`, which is the shape `remote.backend.call`
turns back into a thrown `Error` with your message intact.

### `Mux`

Optional, but it keeps a plugin's advertised routes and its real routes the
same thing, because `Describe` renders `mux.Routes()`.

```go
mux.GET("health", "Process identity", handler)
mux.POST("kv/*", "Write a key", handler)      // prefix route
mux.Handle("*", "echo", "Any method", handler)
```

Patterns are exact or a `/*` prefix. An exact route beats a prefix; a longer
prefix beats a shorter one. Unmatched paths get `404`, and a matched path with
the wrong method gets `405`. Inside a prefix handler, `request.Tail("kv/")`
gives you the rest.

## Reaching a plugin from the browser

`remote.backend` is described in
[06 — Extension API](06-extension-api.md#remotebackend). The short version:

```js
remote.backend.available            // false when nothing is running
remote.backend.instances            // [{ instanceId, scope, projectId }]
remote.backend.call(path, options)  // → parsed JSON, throws on failure
remote.backend.fetch(path, options) // → the raw Response
remote.backend.describe(target)     // → the plugin's route table
remote.backend.url(path, target)    // → the URL a call would use
```

An application installed globally *and* in two projects runs **three processes**, so
a call has to resolve to one. Pass the surface's project and it does the
obvious thing:

```js
remote.ui.register(remote.slots.applicationsPanel, async (host, context) => {
  const health = await remote.backend.call("health", {
    projectId: context.projectId,   // that project's plugin, else the global one
  });
});
```

## Reaching a plugin over HTTP

See [12 — HTTP API](12-http-api.md#backend-plugin-routes). Both scopes:

```
GET    /api/applications/{instanceID}/backend                describe
ANY    /api/applications/{instanceID}/backend/{path...}      call
GET    /api/projects/{projectID}/applications/{instanceID}/backend
ANY    /api/projects/{projectID}/applications/{instanceID}/backend/{path...}
```

Calling a plugin is the one action on a **global** instance that is not
admin-only: the plugin is the server side of an extension that renders for
every signed-in user, so managing the app stays admin-only while calling it
does not. An application can narrow that itself:

```json
"backend": { "access": "admin" }
```

## What the server does with your source

Nothing is compiled until an application with a `backend/api/` directory is installed.
Then, on install — and on start, and on the first call after a restart:

```
1. fingerprint   sha256(plugin source + SDK source + generated go.mod + Go version)
2. cache hit?    <dataDir>/plugins/bin/<application>-<fingerprint>   → skip to 5
3. materialize   <dataDir>/plugins/build/<application>-<fingerprint>/
                   src/   your backend/ + a generated go.mod
                   sdk/   pkg/appplugin, as a module named after this repo
4. compile       go build -trimpath, offline first, network only as a fallback
5. launch        one process per instance, over hashicorp/go-plugin
6. Describe      version check
7. Init          the instance
```

Steps 3–4 happen once per source change; every later start is a `stat` and a
handshake. The build directory is removed on success and **kept on failure**,
so you can look at exactly what did not compile.

### Why source and not binaries

The catalog is embedded in the server binary with `//go:embed`, and a server
runs on whatever architecture it runs on. Shipping source keeps one catalog
portable across all of them, and keeps a plugin reviewable as a diff rather
than as a blob. The cost is a Go toolchain on the server, which the installer
already provides.

### Dependencies

A plugin may import the **standard library** and **this SDK**. The generated
`go.mod` pins every module to the version the server itself was built with,
which is what lets a plugin compile with no network at all.

A `go.mod` inside `backend/api/` is rejected at catalog load: the server writes that
file. If you need a third-party module, the honest answer today is to vendor
the code you need into `backend/api/` or add the dependency to the server.

### Where things live

```
<dataDir>/plugins/
  bin/<application>-<fingerprint>     compiled plugin, shared by every instance
  build/<application>-<fingerprint>/  generated module, kept only after a failure
  build-cache/                  GOCACHE for plugin builds
  home/                         fallback HOME, and therefore module cache,
                                when the service runs without one
  data/<instanceID>/            one instance's DataDir
```

`home/` appears only when the server process has no `HOME` — a systemd unit
without one, typically. It matters because it is then also the module cache, so
the first plugin build on that server downloads its dependencies instead of
finding them in the cache the server's own build left behind. Give the service a
`HOME` and the offline path works from the first install.

### No toolchain, no plugin

A server with no Go toolchain installs and runs everything else normally; an
application with a `backend/api/` reports the missing toolchain on its installed row. Set
`REMOTE_PLUGIN_GO` to point at a specific `go` binary if it is somewhere
unusual.

## Lifecycle

| Action | The plugin process | Its `DataDir` |
|---|---|---|
| Install | compiled and started | created |
| Stop | killed | kept |
| Start | started again | kept |
| Uninstall | killed | **deleted** |
| Server restart | started again on the next call | kept |
| Crash | replaced on the next call | kept |

Stop is the useful one: it is how a user turns a backend off without losing
what it stored.

Because a plugin restarts lazily, in-memory state is not durable and is not
meant to be. Anything that must survive belongs in `DataDir`.

## Failure isolation

| What happens | What the caller sees | What happens to the process |
|---|---|---|
| A route panics | the call fails, with the panic message | it keeps running |
| A route never returns | the call fails on the application's `timeoutMs` | it keeps running |
| The process dies | the call fails | it is replaced on the next call |
| The source does not compile | install or start fails, with the compiler's output | there is no process |
| The contract version mismatches | start fails, saying both versions | the process is killed |

`timeoutMs` defaults to 15000 and is per call. A timed-out call is abandoned
rather than interrupted — net/rpc has no cancellation — so the plugin finishes
its work unobserved and answers the next request normally.

## Combining capabilities

`backend/api/` and `ui/` install nothing in a container and work on a host with no
container runtime. Add `backend/container/` for Go commands built in LXD, and
`infra/install.sh` only for additional custom provisioning; the host backend can
coordinate that software and its UI can expose it to the user.
to.

## Why net/rpc rather than gRPC

hashicorp/go-plugin offers both. Plugins here are Go programs compiled from a
catalog embedded in this server, so there is no second language for a neutral
protocol to serve, and net/rpc keeps a plugin's dependencies to this SDK and
the standard library — no protobuf, no code generation, no checked-in
`.pb.go`.

The whole transport is
[`pkg/appplugin/pluginrpc`](../../../backend/pkg/appplugin/pluginrpc/pluginrpc.go).
Moving to gRPC would be a change to that package and a recompile of the
catalog; `appplugin` — the types a plugin author writes against — would not
move.

## Try it

`backend-playground` is the worked example: every mechanism above, exercised
once, with a UI that calls each route and a self-test that asserts the
contract. See [10 — Fixtures](10-fixtures.md).

## Related

- [02 — application.json reference](02-application-json.md#backend) — the `backend` block.
- [03 — Application capabilities](03-application-capabilities.md) — how `backend/api/` composes with the others.
- [06 — Extension API](06-extension-api.md#remotebackend) — `remote.backend` in full.
- [12 — HTTP API](12-http-api.md#backend-plugin-routes) — the routes and their authorization.
- [13 — Security model](13-security-model.md#backend-plugins) — what a plugin can do, and what stops it.
