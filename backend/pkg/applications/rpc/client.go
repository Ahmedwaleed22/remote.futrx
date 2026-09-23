package rpc

import (
	"fmt"
	"net/rpc"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

// Client is the host's handle on a running backend process. It satisfies
// applications.Backend, so the host calls a backend exactly as a backend author
// implements one.
type Client struct {
	client *rpc.Client
	broker interface {
		NextId() uint32
		AcceptAndServe(uint32, any)
	}
}

var _ applications.Backend = (*Client)(nil)
var _ applications.PublisherBackend = (*Client)(nil)
var _ applications.EventSubscriber = (*Client)(nil)

func (c *Client) Describe() (applications.Descriptor, error) {
	var reply DescribeReply
	if err := c.client.Call("Plugin.Describe", DescribeArgs{}, &reply); err != nil {
		return applications.Descriptor{}, fmt.Errorf("describe: %w", err)
	}
	if reply.Error != "" {
		return applications.Descriptor{}, fmt.Errorf("describe: %s", reply.Error)
	}
	return reply.Descriptor, nil
}

func (c *Client) Init(instance applications.Instance) error {
	var reply InitReply
	if err := c.client.Call("Plugin.Init", InitArgs{Instance: instance}, &reply); err != nil {
		return fmt.Errorf("init: %w", err)
	}
	if reply.Error != "" {
		return fmt.Errorf("init: %s", reply.Error)
	}
	return nil
}

func (c *Client) Handle(request applications.Request) (applications.Response, error) {
	var reply HandleReply
	if err := c.client.Call("Plugin.Handle", HandleArgs{Request: request}, &reply); err != nil {
		return applications.Response{}, fmt.Errorf("handle: %w", err)
	}
	if reply.Error != "" {
		return applications.Response{}, fmt.Errorf("handle: %s", reply.Error)
	}
	return reply.Response, nil
}

// InitPublisher opens a brokered callback connection that lets the backend
// publish into the host without reversing the primary Backend RPC interface.
func (c *Client) InitPublisher(publisher applications.EventPublisher) error {
	if publisher == nil {
		return fmt.Errorf("init publisher: publisher is nil")
	}
	if c.broker == nil {
		return fmt.Errorf("init publisher: callback broker is unavailable")
	}
	id := c.broker.NextId()
	go c.broker.AcceptAndServe(id, &eventPublisherServer{impl: publisher})

	var reply InitPublisherReply
	if err := c.client.Call("Plugin.InitPublisher", InitPublisherArgs{BrokerID: id}, &reply); err != nil {
		return fmt.Errorf("init publisher: %w", err)
	}
	if reply.Error != "" {
		return fmt.Errorf("init publisher: %s", reply.Error)
	}
	return nil
}

// OnEvent delivers one event over the backend's primary RPC connection.
func (c *Client) OnEvent(event applications.Event) error {
	var reply OnEventReply
	if err := c.client.Call("Plugin.OnEvent", OnEventArgs{Event: event}, &reply); err != nil {
		return fmt.Errorf("on event: %w", err)
	}
	if reply.Error != "" {
		return fmt.Errorf("on event: %s", reply.Error)
	}
	return nil
}

// eventPublisherClient is the backend side of the callback connection.
type eventPublisherClient struct {
	client *rpc.Client
}

var _ applications.EventPublisher = (*eventPublisherClient)(nil)

func (c *eventPublisherClient) Publish(publication applications.Publication) error {
	if len(publication.Payload) > applications.MaxEventPayloadBytes {
		return fmt.Errorf(
			"publish event: payload exceeds %d bytes",
			applications.MaxEventPayloadBytes,
		)
	}
	var reply PublishReply
	if err := c.client.Call("Plugin.Publish", PublishArgs{Publication: publication}, &reply); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	if reply.Error != "" {
		return fmt.Errorf("publish event: %s", reply.Error)
	}
	return nil
}
