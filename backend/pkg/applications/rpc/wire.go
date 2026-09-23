package rpc

import "github.com/futrx-com/remote.futrx.com/pkg/applications"

// net/rpc requires exported argument and reply types, and carries an error
// only as a string. Each reply therefore has its own Error field, which keeps
// "the backend returned an error" distinct from "the call did not arrive".

type DescribeArgs struct{}

type DescribeReply struct {
	Descriptor applications.Descriptor
	Error      string
}

type InitArgs struct {
	Instance applications.Instance
}

type InitReply struct {
	Error string
}

type HandleArgs struct {
	Request applications.Request
}

type HandleReply struct {
	Response applications.Response
	Error    string
}

// InitPublisherArgs carries the broker stream on which the backend can call
// the host's EventPublisher. The publisher itself cannot be encoded by
// net/rpc, so go-plugin's MuxBroker supplies a second RPC connection.
type InitPublisherArgs struct {
	BrokerID uint32
}

type InitPublisherReply struct {
	Error string
}

type PublishArgs struct {
	Publication applications.Publication
}

type PublishReply struct {
	Error string
}

type OnEventArgs struct {
	Event applications.Event
}

type OnEventReply struct {
	Error string
}
