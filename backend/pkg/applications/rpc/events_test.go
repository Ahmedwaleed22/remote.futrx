package rpc

import (
	"errors"
	"net"
	"net/rpc"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

type requiredBackend struct {
	descriptor applications.Descriptor
	instance   applications.Instance
}

func (b *requiredBackend) Describe() (applications.Descriptor, error) {
	return b.descriptor, nil
}

func (b *requiredBackend) Init(instance applications.Instance) error {
	b.instance = instance
	return nil
}

func (*requiredBackend) Handle(applications.Request) (applications.Response, error) {
	return applications.Response{}, nil
}

type eventBackend struct {
	requiredBackend
	publisher applications.EventPublisher
	events    []applications.Event
	err       error
	panic     bool
}

func (b *eventBackend) InitPublisher(publisher applications.EventPublisher) error {
	b.publisher = publisher
	return b.err
}

func (b *eventBackend) OnEvent(event applications.Event) error {
	if b.panic {
		panic("event failure")
	}
	b.events = append(b.events, event)
	return b.err
}

func TestDescribeDerivesEventCapabilities(t *testing.T) {
	for _, test := range []struct {
		name             string
		backend          applications.Backend
		publishesEvents  bool
		subscribesEvents bool
	}{
		{
			name: "required backend cannot claim optional capabilities",
			backend: &requiredBackend{descriptor: applications.Descriptor{
				PublishesEvents: true, SubscribesEvents: true,
			}},
		},
		{
			name:             "optional interfaces are discovered",
			backend:          &eventBackend{},
			publishesEvents:  true,
			subscribesEvents: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var reply DescribeReply
			if err := (&server{impl: test.backend}).Describe(DescribeArgs{}, &reply); err != nil {
				t.Fatalf("Describe() transport error: %v", err)
			}
			if reply.Error != "" {
				t.Fatalf("Describe() backend error: %s", reply.Error)
			}
			if reply.Descriptor.PublishesEvents != test.publishesEvents ||
				reply.Descriptor.SubscribesEvents != test.subscribesEvents {
				t.Fatalf(
					"capabilities = publish %t, subscribe %t; want %t, %t",
					reply.Descriptor.PublishesEvents,
					reply.Descriptor.SubscribesEvents,
					test.publishesEvents,
					test.subscribesEvents,
				)
			}
		})
	}
}

func TestEventSubscriberCrossesPrimaryRPCConnection(t *testing.T) {
	backend := &eventBackend{}
	client, closeClient := rpcClientFor(t, &server{impl: backend})
	defer closeClient()

	event := applications.Event{
		Source: applications.EventSource{
			ApplicationID: "remote",
			Publisher:     "remote.applications",
		},
		Name:    "installed",
		Version: 1,
		Payload: []byte(`{"applicationId":"hello-remote"}`),
	}
	if err := (&Client{client: client}).OnEvent(event); err != nil {
		t.Fatalf("OnEvent() error: %v", err)
	}
	if !reflect.DeepEqual(backend.events, []applications.Event{event}) {
		t.Fatalf("delivered events = %#v, want %#v", backend.events, []applications.Event{event})
	}
}

func TestInitCarriesEventDeclarationsAcrossPrimaryRPCConnection(t *testing.T) {
	backend := &requiredBackend{}
	client, closeClient := rpcClientFor(t, &server{impl: backend})
	defer closeClient()

	instance := applications.Instance{
		ID:            "instance-1",
		ApplicationID: "hello-remote",
		Publishers: []applications.PublisherDeclaration{{
			Name: "greetings",
			Events: []applications.EventDeclaration{{
				Name: "greeted", Version: 1, Description: "A greeting was recorded.",
			}},
		}},
		Subscriptions: []applications.Subscription{{
			Publisher: "remote.applications",
			Events:    []string{"installed", "stopped"},
		}},
	}
	if err := (&Client{client: client}).Init(instance); err != nil {
		t.Fatalf("Init() error: %v", err)
	}
	if !reflect.DeepEqual(backend.instance, instance) {
		t.Fatalf("initialized instance = %#v, want %#v", backend.instance, instance)
	}
}

func TestEventSubscriberErrorsAndPanicsStayRPCFailures(t *testing.T) {
	for _, test := range []struct {
		name    string
		backend *eventBackend
		want    string
	}{
		{name: "error", backend: &eventBackend{err: errors.New("rejected")}, want: "rejected"},
		{name: "panic", backend: &eventBackend{panic: true}, want: "backend panicked: event failure"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, closeClient := rpcClientFor(t, &server{impl: test.backend})
			defer closeClient()
			err := (&Client{client: client}).OnEvent(applications.Event{Name: "test", Version: 1})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("OnEvent() error = %v, want containing %q", err, test.want)
			}
		})
	}
}

type recordingPublisher struct {
	publications []applications.Publication
	err          error
}

func (p *recordingPublisher) Publish(publication applications.Publication) error {
	p.publications = append(p.publications, publication)
	return p.err
}

func TestEventPublisherCrossesCallbackRPCConnection(t *testing.T) {
	publisher := &recordingPublisher{}
	client, closeClient := rpcClientFor(t, &eventPublisherServer{impl: publisher})
	defer closeClient()

	publication := applications.Publication{
		Publisher: "greetings",
		Event:     "greeted",
		Version:   1,
		Payload:   []byte(`{"count":2}`),
	}
	if err := (&eventPublisherClient{client: client}).Publish(publication); err != nil {
		t.Fatalf("Publish() error: %v", err)
	}
	if !reflect.DeepEqual(publisher.publications, []applications.Publication{publication}) {
		t.Fatalf("publications = %#v, want %#v", publisher.publications, []applications.Publication{publication})
	}
}

func TestEventPublisherRejectsOversizedPayloadBeforeCallbackRPC(t *testing.T) {
	publisher := &recordingPublisher{}
	client, closeClient := rpcClientFor(t, &eventPublisherServer{impl: publisher})
	defer closeClient()

	err := (&eventPublisherClient{client: client}).Publish(applications.Publication{
		Publisher: "greetings",
		Event:     "greeted",
		Version:   1,
		Payload:   make([]byte, applications.MaxEventPayloadBytes+1),
	})
	if err == nil || !strings.Contains(err.Error(), "payload exceeds 65536 bytes") {
		t.Fatalf("Publish() error = %v, want payload size rejection", err)
	}
	if len(publisher.publications) != 0 {
		t.Fatalf("callback received %d publications, want none", len(publisher.publications))
	}
}

type recordingBroker struct {
	served chan brokeredServer
}

type brokeredServer struct {
	id     uint32
	server any
}

func (*recordingBroker) NextId() uint32 { return 41 }

func (b *recordingBroker) AcceptAndServe(id uint32, server any) {
	b.served <- brokeredServer{id: id, server: server}
}

type initPublisherRPC struct {
	mu   sync.Mutex
	args []InitPublisherArgs
}

func (s *initPublisherRPC) InitPublisher(args InitPublisherArgs, _ *InitPublisherReply) error {
	s.mu.Lock()
	s.args = append(s.args, args)
	s.mu.Unlock()
	return nil
}

func TestInitPublisherOffersHostCallbackThroughBroker(t *testing.T) {
	remote := &initPublisherRPC{}
	client, closeClient := rpcClientFor(t, remote)
	defer closeClient()
	broker := &recordingBroker{served: make(chan brokeredServer, 1)}

	if err := (&Client{client: client, broker: broker}).InitPublisher(&recordingPublisher{}); err != nil {
		t.Fatalf("InitPublisher() error: %v", err)
	}
	remote.mu.Lock()
	args := append([]InitPublisherArgs(nil), remote.args...)
	remote.mu.Unlock()
	if !reflect.DeepEqual(args, []InitPublisherArgs{{BrokerID: 41}}) {
		t.Fatalf("InitPublisher args = %#v", args)
	}
	select {
	case offered := <-broker.served:
		if offered.id != 41 {
			t.Fatalf("broker id = %d, want 41", offered.id)
		}
		if _, ok := offered.server.(*eventPublisherServer); !ok {
			t.Fatalf("broker server = %T, want *eventPublisherServer", offered.server)
		}
	case <-time.After(time.Second):
		t.Fatal("publisher callback was not offered through the broker")
	}
}

func rpcClientFor(t *testing.T, service any) (*rpc.Client, func()) {
	t.Helper()
	serverConnection, clientConnection := net.Pipe()
	server := rpc.NewServer()
	if err := server.RegisterName("Plugin", service); err != nil {
		t.Fatalf("register RPC service: %v", err)
	}
	go server.ServeConn(serverConnection)
	client := rpc.NewClient(clientConnection)
	return client, func() {
		_ = client.Close()
		_ = serverConnection.Close()
	}
}
