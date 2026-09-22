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
