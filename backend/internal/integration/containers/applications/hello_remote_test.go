package applications

import (
	"slices"
	"strings"
	"testing"

	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

// Hello Remote is intentionally the catalog's kitchen-sink application. This
// test makes that promise concrete so a later cleanup cannot quietly turn it
// back into a partial example.
func TestHelloRemoteDemonstratesEveryApplicationCapability(t *testing.T) {
	registry, err := NewRegistry(EmbeddedCatalog(), nil)
	if err != nil {
		t.Fatal(err)
	}
	application, ok := registry.Get("hello-remote")
	if !ok {
		t.Fatal("hello-remote is missing from the built-in catalog")
	}

	if application.ID == "" || application.Name == "" || application.Description == "" ||
		application.Category == "" || application.Version == "" || application.Icon == "" ||
		application.Base == "" || application.Source != svc.SourceBuiltin {
		t.Fatalf("identity and presentation fields are incomplete: %+v", application)
	}
	if !application.SupportsScope(svc.ScopeGlobal) || !application.SupportsScope(svc.ScopeProject) {
		t.Fatalf("scopes = %v, want global and project", application.Scopes)
	}
	if !application.NeedsContainer() || !application.NeedsPort() || application.Service == nil ||
		application.Healthcheck.Command == "" {
		t.Fatalf("infrastructure fields are incomplete: %+v", application)
	}
	if application.Install != "infra/install.sh" || len(application.Service.Command) == 0 ||
		application.Service.User != "hello-remote" || application.Service.Group != "hello-remote" ||
		len(application.Service.Environment) != len(application.Env) ||
		!application.Service.Hardening.NoNewPrivileges || !application.Service.Hardening.PrivateTmp ||
		!application.Service.Hardening.ProtectHome || application.Service.Hardening.ProtectSystem != "strict" {
		t.Fatalf("service declaration must be fully manifest-owned: %+v", application.Service)
	}
	if application.Port.Internal == 0 || application.Port.DefaultExternal == 0 ||
		application.Port.Protocol == "" || application.Port.BindAddress == "" {
		t.Fatalf("port fields are incomplete: %+v", application.Port)
	}
	if application.Connection.User == "" || application.Connection.UserEnv == "" ||
		application.Connection.PasswordEnv == "" || application.Connection.DatabaseEnv == "" {
		t.Fatalf("connection fields are incomplete: %+v", application.Connection)
	}

	var hasDefault, hasRequired, hasSecret, hasGenerator bool
	for _, variable := range application.Env {
		hasDefault = hasDefault || variable.Default != ""
		hasRequired = hasRequired || variable.Required
		hasSecret = hasSecret || variable.Secret
		hasGenerator = hasGenerator || variable.Generate != ""
	}
	if !hasDefault || !hasRequired || !hasSecret || !hasGenerator {
		t.Fatalf("env fields are not all demonstrated: %+v", application.Env)
	}
	if len(application.HostTools) == 0 || len(application.HostTools[0].Downloads) < 2 ||
		len(application.HostTools[0].VersionArgs) == 0 {
		t.Fatalf("host tool fields are incomplete: %+v", application.HostTools)
	}
	for architecture, download := range application.HostTools[0].Downloads {
		if download.URL == "" || download.SHA256 == "" || download.Compression == "" {
			t.Fatalf("host tool download %s is incomplete: %+v", architecture, download)
		}
	}
	if application.UI == nil || application.UI.Entry == "" || len(application.UI.Styles) == 0 ||
		len(application.UI.Views) == 0 || application.Backend == nil {
		t.Fatalf("UI/backend fields are incomplete: ui=%+v backend=%+v", application.UI, application.Backend)
	}
	if application.Container == nil ||
		!slices.Contains(application.Container.Commands, "hello-remote-info") ||
		!slices.Contains(application.Container.Commands, "hello-remote-service") {
		t.Fatalf("container commands = %+v", application.Container)
	}
	if !slices.Contains(application.Skills, "hello-remote-inspector") {
		t.Fatalf("skills = %v, want hello-remote-inspector", application.Skills)
	}
	if script, ok := registry.Script(application.ID); !ok || !strings.Contains(string(script), "APP_BUILD_VERSION=") {
		t.Fatal("hello-remote generated container build is not available")
	}
}
