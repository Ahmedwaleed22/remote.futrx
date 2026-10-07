// Package scheduledmessages bridges the installed scheduler application to
// authenticated project chat turns. Scheduling and persistence belong to the app.
package scheduledmessages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	serviceapplications "github.com/futrx-com/remote.futrx.com/internal/service/applications"
	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/internal/service/schedulecapability"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

const (
	ApplicationID     = "scheduled-tasks"
	duePublisher      = "applications.scheduled-tasks.tasks"
	maxConcurrentRuns = 2
	restoreInterval   = 15 * time.Second
	finishRetryDelay  = 15 * time.Second
)

var errAccessRevoked = errors.New("scheduled message access revoked")

type ApplicationService interface {
	CallBackend(context.Context, string, applications.Request, applications.Caller) (applications.Response, error)
	RestoreBackend(context.Context, string) error
}
type Chats interface {
	Get(context.Context, servicechat.ID) (servicechat.Meta, error)
}
type Projects interface {
	HasAccess(context.Context, serviceproject.ID, string) (bool, error)
}
type Identities interface {
	IsRegistered(context.Context, string) (bool, error)
	IsAdmin(context.Context, string) (bool, error)
}
type Prompts interface {
	Start(prompt.StartInput, func(servicechat.Event)) (prompt.RunHandle, error)
}
type Service struct {
	*schedulecapability.Registry
	apps       ApplicationService
	store      serviceapplications.Store
	chats      Chats
	projects   Projects
	identities Identities
	prompts    Prompts
	mu         sync.Mutex
	active     map[string]bool
	queue      chan applications.Event
	ctx        context.Context
	done       chan struct{}
	cancel     context.CancelFunc
	start      sync.Once
}

func New(ctx context.Context, baseURL string, apps ApplicationService, store serviceapplications.Store, chats Chats, projects Projects, identities Identities, prompts Prompts) *Service {
	ctx, cancel := context.WithCancel(ctx)
	return &Service{Registry: schedulecapability.New(baseURL), apps: apps, store: store, chats: chats, projects: projects, identities: identities, prompts: prompts, active: map[string]bool{}, queue: make(chan applications.Event, 100), ctx: ctx, done: make(chan struct{}), cancel: cancel}
}
func (s *Service) Start(events serviceapplications.EventSource) {
	s.start.Do(func() {
		var unsubscribe func()
		if events != nil {
			unsubscribe = events.Subscribe(s.enqueue)
		}
		go s.run(unsubscribe)
	})
}

func (s *Service) Available(ctx context.Context, projectID serviceproject.ID) bool {
	_, err := s.instance(ctx, string(projectID))
	return err == nil
}
func (s *Service) instance(ctx context.Context, projectID string) (serviceapplications.Instance, error) {
	if s.apps == nil || s.store == nil {
		return serviceapplications.Instance{}, errors.New("install Scheduled Tasks in this project's Applications page")
	}
	instances, err := s.store.ListProject(ctx, projectID)
	if err != nil {
		return serviceapplications.Instance{}, err
	}
	for _, i := range instances {
		if i.ApplicationID == ApplicationID && i.Status == serviceapplications.StatusRunning {
			return i, nil
		}
	}
	return serviceapplications.Instance{}, errors.New("install and start Scheduled Tasks in this project's Applications page")
}
func (s *Service) IssueScheduleTool(ctx context.Context, r prompt.ScheduleToolRequest) (prompt.ScheduleToolAccess, error) {
	if _, err := s.instance(ctx, string(r.ProjectID)); err != nil {
		return prompt.ScheduleToolAccess{}, err
	}
	return s.Registry.IssueScheduleTool(ctx, r)
}

// CallAgent stamps chat and caller from a per-turn grant, never from the CLI body.
func (s *Service) CallAgent(ctx context.Context, g schedulecapability.Grant, r applications.Request) (applications.Response, error) {
	i, err := s.instance(ctx, string(g.ProjectID))
	if err != nil {
		return applications.Response{}, err
	}
	if err = s.authorize(ctx, string(g.ProjectID), string(g.ChatID), g.OwnerEmail); err != nil {
		return applications.Response{}, err
	}
	path := strings.Trim(r.Path, "/")
	switch {
	case g.Scope == schedulecapability.ScopeCompleteSelf:
		if r.Method != "POST" || path != "current/complete" {
			return applications.Errorf(403, "scheduled turns can only complete their current task"), nil
		}
		r.Path = "tasks/" + g.ScheduledTaskID + "/complete"
		r.Body, _ = json.Marshal(map[string]string{"runId": g.ScheduledRunID})
	case path == "":
		r.Path = "tasks"
		r.Query = map[string][]string{"chatId": {string(g.ChatID)}}
		if r.Method == "POST" {
			var body map[string]json.RawMessage
			if json.Unmarshal(r.Body, &body) != nil || body == nil {
				return applications.Errorf(400, "invalid JSON"), nil
			}
			body["chatId"], _ = json.Marshal(g.ChatID)
			r.Body, _ = json.Marshal(body)
		}
	default:
		parts := strings.Split(path, "/")
		if len(parts) > 2 || (len(parts) == 2 && parts[1] != "run") {
			return applications.Errorf(404, "not found"), nil
		}
		found, err := s.apps.CallBackend(ctx, i.ID, applications.Request{Method: "GET", Path: "tasks/" + parts[0]}, applications.Caller{Email: g.OwnerEmail})
		if err != nil {
			return applications.Response{}, err
		}
		var task struct {
			ChatID string `json:"chatId"`
		}
		if found.Status != 200 || json.Unmarshal(found.Body, &task) != nil || task.ChatID != string(g.ChatID) {
			return applications.Errorf(404, "task not found in this chat"), nil
		}
		r.Path = "tasks/" + path
	}
	// A grant cannot elevate task ownership even if its user is an administrator.
	return s.apps.CallBackend(ctx, i.ID, r, applications.Caller{Email: g.OwnerEmail})
}
func (s *Service) authorize(ctx context.Context, projectID, chatID, email string) error {
	meta, err := s.chats.Get(ctx, servicechat.ID(chatID))
	if err != nil {
		return err
	}
	if string(meta.ProjectID) != projectID {
		return fmt.Errorf("%w: scheduled message chat does not belong to this project", errAccessRevoked)
	}
	if s.identities == nil {
		return fmt.Errorf("%w: authenticated scheduled message owner required", errAccessRevoked)
	}
	registered, err := s.identities.IsRegistered(ctx, email)
	if err != nil {
		return err
	}
	if !registered {
		return fmt.Errorf("%w: task owner is no longer registered", errAccessRevoked)
	}
	admin, err := s.identities.IsAdmin(ctx, email)
	if err != nil {
		return err
	}
	if admin {
		return nil
	}
	allowed, err := s.projects.HasAccess(ctx, serviceproject.ID(projectID), email)
	if err != nil {
		return err
	}
	if !allowed {
		return fmt.Errorf("%w: task owner no longer has project access", errAccessRevoked)
	}
	return nil
}
func (s *Service) enqueue(_ context.Context, e applications.Event) {
	if e.Source.ApplicationID != ApplicationID || e.Source.Publisher != duePublisher || e.Source.Scope != "project" || e.Name != "due" || e.Version != 1 {
		return
	}
	e.Payload = append([]byte(nil), e.Payload...)
	select {
	case <-s.ctx.Done():
	case s.queue <- e:
	default:
	}
}
func (s *Service) run(unsubscribe func()) {
	defer close(s.done)
	if unsubscribe != nil {
		defer unsubscribe()
	}
	ticker := time.NewTicker(restoreInterval)
	defer ticker.Stop()
	s.restore()
	for {
		select {
		case <-s.ctx.Done():
			return
		case e := <-s.queue:
			s.dispatch(e)
		case <-ticker.C:
			s.restore()
		}
	}
}

// Restore live scheduler backends after host restart or backend crash. It does
// not read tasks or calculate their deadlines; the application owns its clock.
func (s *Service) restore() {
	if s.apps == nil || s.store == nil {
		return
	}
	instances, err := s.store.ListAll(s.ctx)
	if err != nil {
		log.Printf("scheduled messages: restore: %v", err)
		return
	}
	for _, i := range instances {
		if i.ApplicationID == ApplicationID && i.Scope == serviceapplications.ScopeProject && i.Status == serviceapplications.StatusRunning {
			if err := s.apps.RestoreBackend(s.ctx, i.ID); err != nil {
				log.Printf("scheduled messages: restore %s: %v", i.ID, err)
			}
		}
	}
}
func (s *Service) dispatch(e applications.Event) {
	var claim struct {
		TaskID string `json:"taskId"`
		RunID  string `json:"runId"`
	}
	if json.Unmarshal(e.Payload, &claim) != nil || claim.TaskID == "" || claim.RunID == "" {
		return
	}
	i, err := s.instance(s.ctx, e.Source.ProjectID)
	if err != nil || i.ID != e.Source.InstanceID {
		return
	}
	response, err := s.apps.CallBackend(s.ctx, i.ID, applications.Request{Method: "GET", Path: "tasks/" + claim.TaskID}, applications.Caller{IsAdmin: true})
	if err != nil || response.Status != 200 {
		return
	}
	var task struct {
		ChatID      string `json:"chatId"`
		OwnerEmail  string `json:"ownerEmail"`
		Prompt      string `json:"prompt"`
		Name        string `json:"name"`
		ActiveRunID string `json:"activeRunId"`
	}
	if json.Unmarshal(response.Body, &task) != nil || task.ActiveRunID != claim.RunID {
		return
	}
	key := i.ID + ":" + claim.RunID
	s.mu.Lock()
	if s.active[key] || len(s.active) >= maxConcurrentRuns {
		s.mu.Unlock()
		return
	}
	s.active[key] = true
	s.mu.Unlock()
	release := func() { s.mu.Lock(); delete(s.active, key); s.mu.Unlock() }
	finish := func(runErr error, complete, retry bool) bool {
		message := ""
		if runErr != nil {
			message = runErr.Error()
		}
		body, _ := json.Marshal(map[string]any{"runId": claim.RunID, "error": message, "complete": complete, "retry": retry})
		response, err := s.apps.CallBackend(s.ctx, i.ID, applications.Request{Method: "POST", Path: "tasks/" + claim.TaskID + "/finish", Body: body}, applications.Caller{IsAdmin: true})
		if err == nil && (response.Status == 404 || response.Status == 409) {
			return true
		}
		if err != nil || response.Status >= 300 {
			log.Printf("scheduled messages: finish %s: status %d, error %v", claim.TaskID, response.Status, err)
			return false
		}
		return true
	}
	if err = s.authorize(s.ctx, e.Source.ProjectID, task.ChatID, task.OwnerEmail); err != nil {
		revoked := errors.Is(err, errAccessRevoked)
		finish(err, revoked, !revoked)
		release()
		return
	}
	run, err := s.prompts.Start(prompt.StartInput{ChatID: servicechat.ID(task.ChatID), Prompt: fmt.Sprintf("[Scheduled task: %s]\n\n%s", task.Name, task.Prompt), Actor: prompt.Actor{Email: task.OwnerEmail}, ScheduledTaskID: claim.TaskID, ScheduledRunID: claim.RunID, ParentContext: s.ctx}, nil)
	if err != nil {
		finish(err, false, true)
		release()
		return
	}
	go func() {
		defer release()
		select {
		case <-s.ctx.Done():
			return
		case result, ok := <-run.Done:
			if !ok {
				result.Err = errors.New("agent run ended without a result")
			}
			lines := strings.Split(strings.TrimSpace(result.Output), "\n")
			last := strings.TrimSpace(lines[len(lines)-1])
			complete := last == "SCHEDULE_STATUS=COMPLETE" || last == "TASK_COMPLETE"
			// Retain the accepted-run deduplication slot until the app has
			// durably acknowledged completion. A dropped reply must not rerun it.
			for !finish(result.Err, complete, false) {
				select {
				case <-s.ctx.Done():
					return
				case <-time.After(finishRetryDelay):
				}
			}
		}
	}()
}
func (s *Service) Close() { s.cancel(); s.start.Do(func() { close(s.done) }); <-s.done }
