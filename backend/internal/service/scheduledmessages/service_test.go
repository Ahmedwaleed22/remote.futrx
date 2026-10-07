package scheduledmessages

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"futrx.local/catalog"
	integrationapps "github.com/futrx-com/remote.futrx.com/internal/integration/applications"
	containerapps "github.com/futrx-com/remote.futrx.com/internal/integration/containers/applications"
	"github.com/futrx-com/remote.futrx.com/internal/lifecycle"
	serviceapps "github.com/futrx-com/remote.futrx.com/internal/service/applications"
	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/internal/service/schedulecapability"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

type instanceStore struct{ instance serviceapps.Instance }

func (s *instanceStore) ListGlobal(context.Context) ([]serviceapps.Instance, error) { return nil, nil }
func (s *instanceStore) ListProject(_ context.Context, id string) ([]serviceapps.Instance, error) {
	if id == s.instance.ProjectID {
		return []serviceapps.Instance{s.instance}, nil
	}
	return nil, nil
}
func (s *instanceStore) ListAll(context.Context) ([]serviceapps.Instance, error) {
	return []serviceapps.Instance{s.instance}, nil
}
func (s *instanceStore) Get(_ context.Context, id string) (serviceapps.Instance, bool, error) {
	return s.instance, id == s.instance.ID, nil
}
func (s *instanceStore) Put(_ context.Context, i serviceapps.Instance) error {
	s.instance = i
	return nil
}
func (s *instanceStore) Delete(context.Context, string) error { return nil }

type chatLookup struct{ project string }

func (c chatLookup) Get(_ context.Context, id servicechat.ID) (servicechat.Meta, error) {
	return servicechat.Meta{ID: id, ProjectID: servicechat.ProjectID(c.project)}, nil
}

type projectAccess struct{ allowed bool }

func (p projectAccess) HasAccess(context.Context, serviceproject.ID, string) (bool, error) {
	return p.allowed, nil
}

type identity struct{ registered bool }

func (i identity) IsRegistered(context.Context, string) (bool, error) { return i.registered, nil }
func (i identity) IsAdmin(context.Context, string) (bool, error)      { return false, nil }

type promptStarter struct {
	inputs chan prompt.StartInput
	done   chan prompt.RunResult
	err    error
}

func (p *promptStarter) Start(in prompt.StartInput, _ func(servicechat.Event)) (prompt.RunHandle, error) {
	if p.err != nil {
		return prompt.RunHandle{}, p.err
	}
	p.inputs <- in
	return prompt.RunHandle{ID: 1, Done: p.done}, nil
}
func TestInstalledApplicationCreateRestartWakeAndFinish(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	bus := lifecycle.NewEventBus(ctx)
	defer bus.Close()
	registry, err := containerapps.NewRegistry(catalog.FS, nil)
	if err != nil {
		t.Fatal(err)
	}
	host := integrationapps.New(t.TempDir(), registry, integrationapps.Options{Events: bus})
	defer host.Shutdown()
	store := &instanceStore{instance: serviceapps.Instance{ID: "instance", ApplicationID: ApplicationID, Scope: serviceapps.ScopeProject, ProjectID: "project", Status: serviceapps.StatusRunning}}
	apps := serviceapps.New(registry, store, nil, nil, nil, serviceapps.WithBackendHost(host))
	defer apps.Close()
	prompts := &promptStarter{inputs: make(chan prompt.StartInput, 4), done: make(chan prompt.RunResult, 1)}
	s := New(ctx, "https://remote.example.com", apps, store, chatLookup{"project"}, projectAccess{true}, identity{true}, prompts)
	s.Start(bus)
	defer s.Close()
	// DescribeBackend compiles via Remote's generated module, not the catalog module.
	if err := apps.RestoreBackend(ctx, "instance"); err != nil {
		t.Fatal(err)
	}
	access, err := s.IssueScheduleTool(ctx, prompt.ScheduleToolRequest{Actor: prompt.Actor{Email: "owner@example.com"}, ChatID: "aabbcc11", ProjectID: "project"})
	if err != nil {
		t.Fatal(err)
	}
	defer access.Revoke()
	grant, err := s.Resolve(access.Token)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"name": "remember", "prompt": "Remind me to review build_123", "chatId": "forged-chat", "kind": "once", "at": time.Now().Add(3 * time.Second).UTC().Format(time.RFC3339Nano)})
	response, err := s.CallAgent(ctx, grant, applications.Request{Method: "POST", Body: body})
	if err != nil || response.Status != 201 {
		t.Fatalf("create: %d %s %v", response.Status, response.Body, err)
	}
	var task struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
		ChatID  string `json:"chatId"`
	}
	if err = json.Unmarshal(response.Body, &task); err != nil {
		t.Fatal(err)
	}
	if !task.Enabled || task.ChatID != "aabbcc11" {
		t.Fatalf("task parked or chat forged: %+v", task)
	}
	completionGrant := grant
	completionGrant.Scope = schedulecapability.ScopeCompleteSelf
	completionGrant.ScheduledTaskID = task.ID
	completionGrant.ScheduledRunID = "not-current"
	if reply, err := s.CallAgent(ctx, completionGrant, applications.Request{Method: "POST"}); err != nil || reply.Status != 403 {
		t.Fatalf("scheduled turn could create tasks: %d %v", reply.Status, err)
	}
	// Stop only the child to simulate a crash. Running metadata remains intact.
	if err = host.Stop(ctx, "instance"); err != nil {
		t.Fatal(err)
	}
	s.restore()
	var input prompt.StartInput
	select {
	case input = <-prompts.inputs:
	case <-time.After(15 * time.Second):
		t.Fatal("durable task did not wake agent after restart")
	}
	if input.ChatID != "aabbcc11" || input.Actor.Email != "owner@example.com" || input.ScheduledTaskID != task.ID || input.ScheduledRunID == "" {
		t.Fatalf("wake: %+v", input)
	}
	prompts.done <- prompt.RunResult{Output: "reminder delivered"}
	deadline := time.Now().Add(5 * time.Second)
	for {
		reply, err := apps.CallBackend(ctx, "instance", applications.Request{Method: "GET", Path: "tasks/" + task.ID}, applications.Caller{Email: "owner@example.com"})
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Enabled  bool `json:"enabled"`
			RunCount int  `json:"runCount"`
		}
		_ = json.Unmarshal(reply.Body, &result)
		if !result.Enabled && result.RunCount == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("task not finished: %s", reply.Body)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// A repeated delivery of a finished claim must not start another turn.
	payload, _ := json.Marshal(map[string]string{"taskId": task.ID, "runId": input.ScheduledRunID})
	s.dispatch(applications.Event{Source: applications.EventSource{InstanceID: "instance", ProjectID: "project"}, Payload: payload})
	select {
	case extra := <-prompts.inputs:
		t.Fatalf("duplicate wake: %+v", extra)
	default:
	}
}
func TestUnavailableAppAndRevokedMembershipRefuseCapabilityUse(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := New(ctx, "https://remote.example.com", nil, nil, chatLookup{"project"}, projectAccess{true}, identity{true}, &promptStarter{})
	defer s.Close()
	if s.Available(ctx, "project") {
		t.Fatal("uninstalled app advertised")
	}
	if _, err := s.IssueScheduleTool(ctx, prompt.ScheduleToolRequest{Actor: prompt.Actor{Email: "owner@example.com"}, ChatID: "chat", ProjectID: "project"}); err == nil {
		t.Fatal("issued uninstalled app capability")
	}
	s.identities = identity{false}
	if err := s.authorize(ctx, "project", "chat", "owner@example.com"); err == nil {
		t.Fatal("revoked owner accepted")
	}
	s.identities = identity{true}
	s.projects = projectAccess{false}
	if err := s.authorize(ctx, "project", "chat", "owner@example.com"); err == nil {
		t.Fatal("revoked project membership accepted")
	}
	if err := s.authorize(ctx, "other-project", "chat", "owner@example.com"); err == nil {
		t.Fatal("cross-project wake accepted")
	}
}
