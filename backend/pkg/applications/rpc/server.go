package rpc

import (
	"fmt"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

type server struct {
	impl applications.Backend
}

func (s *server) Describe(_ DescribeArgs, reply *DescribeReply) error {
	descriptor, err := recovered(func() (applications.Descriptor, error) {
		return s.impl.Describe()
	})
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
