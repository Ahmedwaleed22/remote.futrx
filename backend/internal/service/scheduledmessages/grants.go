package scheduledmessages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	serviceapplications "github.com/futrx-com/remote.futrx.com/internal/service/applications"
	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/internal/service/schedulecapability"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

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
