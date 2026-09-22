package main

import (
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
	config.ProvisionedVersion = "9"

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
		body.ProvisionedVersion != "9" || body.User != "demo-user" ||
		body.Database != "demo-db" || !body.PasswordConfigured {
		t.Fatalf("health response = %+v", body)
	}
}
