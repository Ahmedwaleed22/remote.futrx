// Package scheduledmessages bridges the installed scheduler application to
// authenticated project chat turns. Scheduling and persistence belong to the app.
package scheduledmessages

import (
	"context"
	"errors"
	"log"
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
	return &Service{
		Registry: schedulecapability.New(baseURL),
		apps:     apps, store: store, chats: chats, projects: projects,
		identities: identities, prompts: prompts,
		active: map[string]bool{}, queue: make(chan applications.Event, 100),
		ctx: ctx, done: make(chan struct{}), cancel: cancel,
	}
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
func (s *Service) Close() { s.cancel(); s.start.Do(func() { close(s.done) }); <-s.done }
