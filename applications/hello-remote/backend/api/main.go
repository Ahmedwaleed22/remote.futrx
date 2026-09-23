// Hello Remote is the catalog's worked example. Required host backend surface:
// package main, main calling rpc.Serve, and the Describe, Init, and Handle
// methods. Router, persistence, and the example routes are optional conveniences.
package main

import (
	"sync"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
	"github.com/futrx-com/remote.futrx.com/pkg/applications/rpc"
)

type api struct {
	router           *applications.Router
	inspectContainer func(string) (containerFacts, error)
	inspectService   func(int) (serviceHealth, error)

	mu        sync.Mutex
	instance  applications.Instance
	visits    int
	publisher applications.EventPublisher
	events    int
	lastEvent *applications.Event
}

// REQUIRED — main must serve a value implementing applications.Backend.
func main() {
	rpc.Serve(handler())
}

// REQUIRED — Describe runs once when the host connects. APIVersion must use
// applications.APIVersion or the host refuses the process. Routes() reports what
// handler registered, so the route table the SPA discovers through
// remote.backend.describe() cannot drift from the one actually served.
func (b *api) Describe() (applications.Descriptor, error) {
	return applications.Descriptor{
		APIVersion: applications.APIVersion,
		Routes:     b.router.Routes(),
	}, nil
}

// REQUIRED — Init runs once before the first request, and is where the process learns
// which installed copy it belongs to. A global install and two project
// installs are three processes, each with its own Instance and its own
// DataDir.
func (b *api) Init(instance applications.Instance) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.instance = instance
	b.visits = readVisits(instance.DataDir)
	return nil
}

// REQUIRED — Handle may be called concurrently.
func (b *api) Handle(request applications.Request) (applications.Response, error) {
	return b.router.Serve(request), nil
}

// OPTIONAL — InitPublisher is called only because this backend implements
// applications.PublisherBackend. The host validates every Publication against
// application.json and stamps the installed instance onto the delivered Event.
func (b *api) InitPublisher(publisher applications.EventPublisher) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.publisher = publisher
	return nil
}

// OPTIONAL — OnEvent is called only because this backend implements
// applications.EventSubscriber. It may run concurrently with Handle and with
// other event deliveries, so the example records a private value copy.
func (b *api) OnEvent(event applications.Event) error {
	event.Payload = append([]byte(nil), event.Payload...)
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events++
	b.lastEvent = &event
	return nil
}

// handler is the composition root for the example backend. It owns concrete
// integrations and route registration so production and tests use one route
// table rather than assembling subtly different backends.
func handler() *api {
	h := &api{
		router:           applications.NewRouter(),
		inspectContainer: readContainerFacts,
		inspectService:   readServiceHealth,
	}

	h.router.GET("hello", "Greet the calling user", h.hello)
	h.router.POST("echo", "Echo JSON, query, and headers from the frontend API explorer", h.echo)
	h.router.GET("container", "Report safe facts about this install's LXD container", h.container)
	h.router.GET("service", "Report the supervised container service and its safe configuration", h.service)
	h.router.GET("visits", "Report how many greetings this install has served", h.readVisits)
	h.router.POST("visits", "Count one greeting", h.countVisit)
	h.router.GET("events", "Report this backend's publication and subscription activity", h.eventActivity)

	return h
}
