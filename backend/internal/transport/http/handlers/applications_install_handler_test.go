package httphandlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apps "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

type installTestRegistry struct{}

func (installTestRegistry) List() []apps.Application { return nil }
func (installTestRegistry) Get(id string) (apps.Application, bool) {
	return apps.Application{ID: id, Name: "Test UI", Version: "1", Scopes: []apps.Scope{apps.ScopeGlobal},
		UI: &apps.ApplicationUI{}}, true
}
func (installTestRegistry) UIAsset(string, string) ([]byte, bool) { return nil, false }

type installTestStore struct{ instance apps.Instance }

func (s *installTestStore) ListGlobal(ctx context.Context) ([]apps.Instance, error) {
	return nil, ctx.Err()
}
func (s *installTestStore) ListProject(ctx context.Context, _ string) ([]apps.Instance, error) {
	return nil, ctx.Err()
}
func (s *installTestStore) ListAll(ctx context.Context) ([]apps.Instance, error) {
	return nil, ctx.Err()
}
func (s *installTestStore) Get(ctx context.Context, _ string) (apps.Instance, bool, error) {
	return s.instance, s.instance.ID != "", ctx.Err()
}
func (s *installTestStore) Put(ctx context.Context, instance apps.Instance) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.instance = instance
	return nil
}
func (s *installTestStore) Delete(ctx context.Context, _ string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.instance = apps.Instance{}
	return nil
}

func TestInstallFinishesAfterBrowserRequestIsCanceled(t *testing.T) {
	store := &installTestStore{}
	handler := &ApplicationsHandler{apps: apps.New(installTestRegistry{}, store, nil, nil, nil)}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/api/applications",
		strings.NewReader(`{"applicationId":"test-ui"}`)).WithContext(ctx)
	cancel()
	recorder := httptest.NewRecorder()

	handler.install(recorder, request, apps.ScopeGlobal, "")
	if recorder.Code != http.StatusCreated || store.instance.Status != apps.StatusRunning {
		t.Fatalf("canceled request: status=%d instance=%+v body=%s",
			recorder.Code, store.instance, recorder.Body.String())
	}
}

func TestUninstallFinishesAfterBrowserRequestIsCanceled(t *testing.T) {
	store := &installTestStore{instance: apps.Instance{
		ID: "installed", ApplicationID: "test-ui", Scope: apps.ScopeGlobal, Status: apps.StatusRunning,
	}}
	handler := &ApplicationsHandler{apps: apps.New(installTestRegistry{}, store, nil, nil, nil)}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodDelete, "/api/applications/installed", nil).WithContext(ctx)
	cancel()
	recorder := httptest.NewRecorder()

	handler.instanceAction(recorder, request, "installed", "")
	if recorder.Code != http.StatusOK || store.instance.ID != "" {
		t.Fatalf("canceled uninstall: status=%d instance=%+v body=%s",
			recorder.Code, store.instance, recorder.Body.String())
	}
}
