// Package rpc carries an applications.Backend across the process boundary.
//
// It is the only part of the backend SDK that depends on hashicorp/go-plugin,
// which is why it is separate from applications itself: the server's service
// layer speaks about backends using applications's types alone, while this
// package is imported by the two ends that actually own a socket — a backend's
// main() and the host that launches it.
//
// The transport is go-plugin's net/rpc mode rather than gRPC. Backends are Go
// programs compiled from the application catalog, so there is nothing for a
// language-neutral protocol to buy, and net/rpc keeps a backend's dependencies
// to this SDK and the standard library. Moving to gRPC later is a change to
// this package and a recompile of the catalog, not a change to applications.
package rpc

import (
	"net/rpc"

	goplugin "github.com/hashicorp/go-plugin"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

// BackendName is the key both ends use to look the backend up in go-plugin's
// transport registry.
const BackendName = "backend"

// Handshake is the mutual check that stops a backend binary from being run as a
// normal program and stops the host from talking to an unrelated one. Its
// ProtocolVersion moves only when the wire shape below changes; the contract
// version a backend was compiled against is reported separately in its
// Descriptor.
var Handshake = goplugin.HandshakeConfig{
	ProtocolVersion:  2,
	MagicCookieKey:   "REMOTE_FUTRX_APPLICATION_BACKEND",
	MagicCookieValue: "b0f2b4b6-remote-futrx-application-backend",
}

// Serve runs a backend as a backend process. It is the whole of a backend's
// main():
//
//	func main() { rpc.Serve(&myBackend{}) }
//
// It blocks until the host closes the connection.
func Serve(backend applications.Backend) {
	goplugin.Serve(&goplugin.ServeConfig{
		HandshakeConfig: Handshake,
		Plugins: goplugin.PluginSet{
			BackendName: &Adapter{Impl: backend},
		},
	})
}

// Adapter adapts applications.Backend to go-plugin. The host constructs it with a
// nil Impl (it only ever asks for a client); the backend process constructs it
// with its implementation.
type Adapter struct {
	Impl applications.Backend
}

var _ goplugin.Plugin = (*Adapter)(nil)

func (p *Adapter) Server(broker *goplugin.MuxBroker) (any, error) {
	return &server{impl: p.Impl, broker: broker}, nil
}

func (p *Adapter) Client(broker *goplugin.MuxBroker, client *rpc.Client) (any, error) {
	return &Client{client: client, broker: broker}, nil
}
