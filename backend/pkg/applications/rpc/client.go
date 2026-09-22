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
}

var _ applications.Backend = (*Client)(nil)

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
