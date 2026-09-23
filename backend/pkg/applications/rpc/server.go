package rpc

import (
	"fmt"
	"net/rpc"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
	goplugin "github.com/hashicorp/go-plugin"
)

type server struct {
	impl   applications.Backend
	broker *goplugin.MuxBroker
}

func (s *server) Describe(_ DescribeArgs, reply *DescribeReply) error {
	descriptor, err := recovered(func() (applications.Descriptor, error) {
		return s.impl.Describe()
	})
	// Capability discovery reflects the implementation, never mutable values a
	// backend happened to return from Describe.
	_, descriptor.PublishesEvents = s.impl.(applications.PublisherBackend)
	_, descriptor.SubscribesEvents = s.impl.(applications.EventSubscriber)
	reply.Descriptor = descriptor
	reply.Error = errorText(err)
	return nil
}

func (s *server) Init(args InitArgs, reply *InitReply) error {
	_, err := recovered(func() (struct{}, error) {
		return struct{}{}, s.impl.Init(args.Instance)
	})
	reply.Error = errorText(err)
	return nil
}

func (s *server) Handle(args HandleArgs, reply *HandleReply) error {
	response, err := recovered(func() (applications.Response, error) {
		return s.impl.Handle(args.Request)
	})
	reply.Response = response
	reply.Error = errorText(err)
	return nil
}

func (s *server) InitPublisher(args InitPublisherArgs, reply *InitPublisherReply) error {
	backend, ok := s.impl.(applications.PublisherBackend)
	if !ok {
		reply.Error = "backend does not implement applications.PublisherBackend"
		return nil
	}
	if s.broker == nil {
		reply.Error = "publisher callback broker is unavailable"
		return nil
	}
	connection, err := s.broker.Dial(args.BrokerID)
	if err != nil {
		reply.Error = fmt.Sprintf("connect publisher callback: %v", err)
		return nil
	}
	publisher := &eventPublisherClient{client: rpc.NewClient(connection)}
	_, err = recovered(func() (struct{}, error) {
		return struct{}{}, backend.InitPublisher(publisher)
	})
	if err != nil {
		_ = publisher.client.Close()
	}
	reply.Error = errorText(err)
	return nil
}

func (s *server) OnEvent(args OnEventArgs, reply *OnEventReply) error {
	backend, ok := s.impl.(applications.EventSubscriber)
	if !ok {
		reply.Error = "backend does not implement applications.EventSubscriber"
		return nil
	}
	_, err := recovered(func() (struct{}, error) {
		return struct{}{}, backend.OnEvent(args.Event)
	})
	reply.Error = errorText(err)
	return nil
}

// eventPublisherServer exposes the host-owned publisher on the callback
// connection initiated during InitPublisher.
type eventPublisherServer struct {
	impl applications.EventPublisher
}

func (s *eventPublisherServer) Publish(args PublishArgs, reply *PublishReply) error {
	_, err := recovered(func() (struct{}, error) {
		return struct{}{}, s.impl.Publish(args.Publication)
	})
	reply.Error = errorText(err)
	return nil
}

// recovered turns a panicking backend method into an ordinary error. A backend
// that panics costs its caller one failed request, not the process and every
// other request in flight on it.
func recovered[T any](call func() (T, error)) (result T, err error) {
	defer func() {
		if recovery := recover(); recovery != nil {
			var zero T
			result = zero
			err = fmt.Errorf("backend panicked: %v", recovery)
		}
	}()
	return call()
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
