package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func encoded(value string) string {
	return base64.StdEncoding.EncodeToString([]byte(value))
}

func TestConfigurationAndHealthResponse(t *testing.T) {
	values := map[string]string{
		"HELLO_GREETING_B64": encoded("Welcome"),
		"HELLO_USER_B64":     encoded("demo-user"),
		"HELLO_PASSWORD_B64": encoded("do-not-return-this"),
		"HELLO_DATABASE_B64": encoded("demo-db"),
	}
	config, err := configurationFromEnv(func(name string) string { return values[name] })
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	serviceHandler(config).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if strings.Contains(response.Body.String(), "do-not-return-this") {
		t.Fatal("health response exposed the configured password")
	}
	var body healthResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Message != "Welcome from the container service." ||
		body.User != "demo-user" || body.Database != "demo-db" || !body.PasswordConfigured {
		t.Fatalf("health response = %+v", body)
	}
}

func TestProbeAcceptsOnlySuccessfulResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	if err := probe(context.Background(), server.URL); err != nil {
		t.Fatalf("probe successful service: %v", err)
	}

	failing := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "not ready", http.StatusServiceUnavailable)
	}))
	defer failing.Close()
	if err := probe(context.Background(), failing.URL); err == nil {
		t.Fatal("probe accepted a failing service")
	}
}

func TestConfigurationRequiresEveryDeclaredValue(t *testing.T) {
	_, err := configurationFromEnv(func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "HELLO_GREETING_B64") {
		t.Fatalf("error = %v, want missing greeting", err)
	}
}
