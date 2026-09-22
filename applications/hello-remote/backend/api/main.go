// Hello Remote is the catalog's worked example. Required host plugin surface:
// package main, main calling pluginrpc.Serve, and the Describe, Init, and Handle
// methods. Router, persistence, and the example routes are optional conveniences.
package main

import (
	"sync"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
	"github.com/futrx-com/remote.futrx.com/pkg/appplugin/pluginrpc"
)

type backend struct {
	router           *appplugin.Router
	inspectContainer func(string) (containerFacts, error)
	inspectService   func(int) (serviceHealth, error)

	mu       sync.Mutex
	instance appplugin.Instance
	visits   int
}

// REQUIRED — main must serve a value implementing appplugin.Backend.
func main() {
	pluginrpc.Serve(newBackend())
}

// newBackend is the composition root for the example plugin. It owns concrete
// integrations and route registration so production and tests use one route
// table rather than assembling subtly different backends.
func newBackend() *backend {
	b := &backend{
		router:           appplugin.NewRouter(),
		inspectContainer: readContainerFacts,
		inspectService:   readServiceHealth,
	}

	b.router.GET("hello", "Greet the calling user", b.hello)
	b.router.POST("echo", "Echo JSON, query, and headers from the frontend API explorer", b.echo)
	b.router.GET("container", "Report safe facts about this install's LXD container", b.container)
	b.router.GET("service", "Report the supervised container service and its safe configuration", b.service)
	b.router.GET("visits", "Report how many greetings this install has served", b.readVisits)
	b.router.POST("visits", "Count one greeting", b.countVisit)

	return b
}

// REQUIRED — Describe runs once when the host connects. APIVersion must use
// appplugin.APIVersion or the host refuses the process. Routes() reports what
// was registered above, so the route table the SPA discovers through
// remote.backend.describe() cannot drift from the one actually served.
func (b *backend) Describe() (appplugin.Descriptor, error) {
	return appplugin.Descriptor{
		APIVersion: appplugin.APIVersion,
		Routes:     b.router.Routes(),
	}, nil
}

// REQUIRED — Init runs once before the first request, and is where the process learns
// which installed copy it belongs to. A global install and two project
// installs are three processes, each with its own Instance and its own
// DataDir.
func (b *backend) Init(instance appplugin.Instance) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.instance = instance
	b.visits = readVisits(instance.DataDir)
	return nil
}

// REQUIRED — Handle may be called concurrently.
func (b *backend) Handle(request appplugin.Request) (appplugin.Response, error) {
	return b.router.Serve(request), nil
}
