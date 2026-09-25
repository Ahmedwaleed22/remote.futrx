package applications

import (
	"strings"
	"testing"

	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

func TestCodeServerIsAnOptionalProjectApplication(t *testing.T) {
	registry, err := NewRegistry(EmbeddedCatalog(), nil)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := registry.Get("code-server")
	if !ok {
		t.Fatal("Code Server is missing from the built-in catalog")
	}
	if !app.SupportsScope(svc.ScopeProject) || app.SupportsScope(svc.ScopeGlobal) ||
		!app.NeedsContainer() || app.NeedsPort() || app.Service == nil ||
		app.Service.SocketProxy == nil || app.UI == nil {
		t.Fatalf("Code Server contract is not project-scoped and on-demand: %+v", app)
	}
	socket := app.Service.SocketProxy
	if socket.ListenPort != 8842 || socket.TargetPort != 8081 || socket.IdleSeconds != 600 || socket.ReadyPath != "/healthz" {
		t.Fatalf("socket contract = %+v", socket)
	}
	script, ok := registry.Script(app.ID)
	if !ok || !strings.Contains(string(script), "CODE_SERVER_VERSION=4.121.0") {
		t.Fatal("Code Server install script is missing its version pin")
	}
}
