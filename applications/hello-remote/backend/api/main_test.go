package main

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
)

// A plugin is ordinary Go in the repository's module, so it is tested like
// ordinary Go: build the backend, hand it an Instance the way the host would,
// and call Handle. Nothing here needs a server, a container, or the plugin
// host.
func newTestBackend(t *testing.T, dataDir string, env map[string]string) *backend {
	t.Helper()
	b := newBackend()
	if err := b.Init(appplugin.Instance{
		ID: "test", ApplicationID: "hello-remote", Scope: "global",
		DataDir: dataDir, Env: env,
	}); err != nil {
		t.Fatalf("init: %v", err)
	}
	return b
}

func TestContainerReportsTheInstalledContainer(t *testing.T) {
	b := newTestBackend(t, t.TempDir(), nil)
	b.instance.ContainerName = "futrx-app-test"
	b.inspectContainer = func(name string) (containerInfo, error) {
		if name != "futrx-app-test" {
			t.Fatalf("container name = %q, want futrx-app-test", name)
		}
		return containerInfo{Hostname: "hello", OperatingSystem: "Ubuntu 24.04 LTS", CPUCount: 4}, nil
	}

	body := call(t, b, "GET", "container")
	if got := body["name"]; got != "futrx-app-test" {
		t.Errorf("name = %v, want futrx-app-test", got)
	}
	if got := body["operatingSystem"]; got != "Ubuntu 24.04 LTS" {
		t.Errorf("operatingSystem = %v, want Ubuntu 24.04 LTS", got)
	}
	if got := body["cpuCount"]; got != float64(4) {
		t.Errorf("cpuCount = %v, want 4", got)
	}
}

func TestServiceReportsTheSupervisedContainerService(t *testing.T) {
	b := newTestBackend(t, t.TempDir(), nil)
	b.instance.Service = "hello-remote"
	b.instance.InternalPort = 4780
	b.instance.ExternalPort = 4781
	b.inspectService = func(port int) (serviceInfo, error) {
		if port != 4781 {
			t.Fatalf("service port = %d, want 4781", port)
		}
		return serviceInfo{
			Status:             "ok",
			Message:            "Hello from the container service.",
			Version:            "build-id",
			User:               "remote",
			Database:           "hello",
			PasswordConfigured: true,
		}, nil
	}

	body := call(t, b, "GET", "service")
	if got := body["service"]; got != "hello-remote" {
		t.Errorf("service = %v, want hello-remote", got)
	}
	if got := body["internalPort"]; got != float64(4780) {
		t.Errorf("internal port = %v, want 4780", got)
	}
	if got := body["externalPort"]; got != float64(4781) {
		t.Errorf("external port = %v, want 4781", got)
	}
	if got := body["passwordConfigured"]; got != true {
		t.Errorf("passwordConfigured = %v, want true", got)
	}
}

func call(t *testing.T, b *backend, method, path string) map[string]any {
	t.Helper()
	response, err := b.Handle(appplugin.Request{
		Method: method,
		Path:   path,
		Caller: appplugin.Caller{Email: "user@example.com"},
	})
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	if response.Status != http.StatusOK {
		t.Fatalf("%s %s status = %d, want 200: %s", method, path, response.Status, response.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatalf("decode %s %s: %v", method, path, err)
	}
	return body
}

func TestHelloUsesInstallGreetingAndCaller(t *testing.T) {
	b := newTestBackend(t, t.TempDir(), map[string]string{"HELLO_GREETING": "Good morning"})

	if got, want := call(t, b, "GET", "hello")["message"], "Good morning, user@example.com."; got != want {
		t.Errorf("message = %v, want %v", got, want)
	}
}

func TestEchoShowsFrontendRequestOptions(t *testing.T) {
	b := newTestBackend(t, t.TempDir(), nil)
	response, err := b.Handle(appplugin.Request{
		Method:  http.MethodPost,
		Path:    "echo",
		Query:   map[string][]string{"source": {"frontend-showcase"}},
		Headers: map[string][]string{"X-Hello-Remote": {"frontend-showcase"}},
		Body:    []byte(`{"message":"hello"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Method  string              `json:"method"`
		Query   map[string][]string `json:"query"`
		Headers map[string][]string `json:"headers"`
		Body    map[string]string   `json:"body"`
	}
	if err := json.Unmarshal(response.Body, &body); err != nil {
		t.Fatal(err)
	}
	if body.Method != http.MethodPost || body.Query["source"][0] != "frontend-showcase" ||
		body.Headers["X-Hello-Remote"][0] != "frontend-showcase" || body.Body["message"] != "hello" {
		t.Fatalf("echo response = %+v", body)
	}
}

// The counter is what shows DataDir doing its job: the process a user's first
// call started is not the process their next one reaches, because a stop, a
// crash, or a server restart is repaired lazily. Only what reached the
// directory survives that.
func TestVisitsSurviveANewProcess(t *testing.T) {
	dataDir := t.TempDir()
	first := newTestBackend(t, dataDir, nil)
	call(t, first, "POST", "visits")
	call(t, first, "POST", "visits")

	restarted := newTestBackend(t, dataDir, nil)
	if got := call(t, restarted, "GET", "visits")["visits"]; got != float64(2) {
		t.Errorf("visits after restart = %v, want 2", got)
	}
}

func TestVisitsWithoutADataDirStillAnswer(t *testing.T) {
	b := newTestBackend(t, "", nil)

	body := call(t, b, "POST", "visits")
	if got := body["visits"]; got != float64(1) {
		t.Errorf("visits = %v, want 1", got)
	}
	if body["warning"] == nil {
		t.Error("expected a warning explaining the count was not persisted")
	}
}
