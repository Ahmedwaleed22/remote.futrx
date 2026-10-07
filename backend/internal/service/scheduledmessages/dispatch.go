package scheduledmessages

import (
	"encoding/json"
	"errors"
	"fmt"

	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

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
	accepted := s.acceptRun(i.ID, claim.TaskID, claim.RunID)
	if accepted == nil {
		return
	}

	if err = s.authorize(s.ctx, e.Source.ProjectID, task.ChatID, task.OwnerEmail); err != nil {
		revoked := errors.Is(err, errAccessRevoked)
		accepted.finish(err, revoked, !revoked)
		accepted.release()
		return
	}
	run, err := s.prompts.Start(prompt.StartInput{ChatID: servicechat.ID(task.ChatID), Prompt: fmt.Sprintf("[Scheduled task: %s]\n\n%s", task.Name, task.Prompt), Actor: prompt.Actor{Email: task.OwnerEmail}, ScheduledTaskID: claim.TaskID, ScheduledRunID: claim.RunID, ParentContext: s.ctx}, nil)
	if err != nil {
		accepted.finish(err, false, true)
		accepted.release()
		return
	}
	go accepted.await(run)
}
