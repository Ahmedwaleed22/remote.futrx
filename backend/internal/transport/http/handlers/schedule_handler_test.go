package httphandlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/internal/service/schedulecapability"
	"github.com/futrx-com/remote.futrx.com/internal/service/scheduledmessages"
)

func TestScheduleBridgeRequiresLivePerTurnCapability(t *testing.T) {
	registry := schedulecapability.New("http://remote.test")
	messages := &scheduledmessages.Service{Registry: registry}
	mux := http.NewServeMux()
	NewScheduleHandler(messages).RegisterRoutes(mux)
	access, err := registry.IssueScheduleTool(context.Background(), prompt.ScheduleToolRequest{Actor: prompt.Actor{Email: "owner@example.com"}, ChatID: "aabbcc11", ProjectID: "project"})
	if err != nil {
		t.Fatal(err)
	}
	defer access.Revoke()
	for _, authorization := range []string{"", "Bearer invalid", "Basic ignored"} {
		request := httptest.NewRequest(http.MethodGet, "/agent-api/schedules", nil)
		request.Header.Set("Authorization", authorization)
		request.AddCookie(&http.Cookie{Name: "session", Value: "browser-session"})
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("authorization %q: %d", authorization, response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/agent-api/schedules", strings.NewReader(strings.Repeat("x", (64<<10)+1)))
	request.Header.Set("Authorization", "Bearer "+access.Token)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("oversize body: %d", response.Code)
	}
	access.Revoke()
	request = httptest.NewRequest(http.MethodGet, "/agent-api/schedules", nil)
	request.Header.Set("Authorization", "Bearer "+access.Token)
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("revoked capability: %d", response.Code)
	}
	for _, path := range []string{"/api/schedules/task", "/api/chats/aabbcc11/schedules"} {
		response = httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("retired route %s: %d", path, response.Code)
		}
	}
}
