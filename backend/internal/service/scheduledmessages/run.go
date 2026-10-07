package scheduledmessages

import (
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/service/prompt"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

// acceptedRun retains its admission slot until completion is acknowledged or
// the service stops. The application remains the owner of the durable claim.
type acceptedRun struct {
	service    *Service
	instanceID string
	taskID     string
	runID      string
	key        string
}

func (s *Service) acceptRun(instanceID, taskID, runID string) *acceptedRun {
	key := instanceID + ":" + runID
	s.mu.Lock()
	if s.active[key] || len(s.active) >= maxConcurrentRuns {
		s.mu.Unlock()
		return nil
	}
	s.active[key] = true
	s.mu.Unlock()
	return &acceptedRun{service: s, instanceID: instanceID, taskID: taskID, runID: runID, key: key}
}

func (r *acceptedRun) release() {
	r.service.mu.Lock()
	delete(r.service.active, r.key)
	r.service.mu.Unlock()
}

func (r *acceptedRun) finish(runErr error, complete, retry bool) bool {
	message := ""
	if runErr != nil {
		message = runErr.Error()
	}
	body, _ := json.Marshal(map[string]any{"runId": r.runID, "error": message, "complete": complete, "retry": retry})
	response, err := r.service.apps.CallBackend(r.service.ctx, r.instanceID, applications.Request{Method: "POST", Path: "tasks/" + r.taskID + "/finish", Body: body}, applications.Caller{IsAdmin: true})
	if err == nil && (response.Status == 404 || response.Status == 409) {
		return true
	}
	if err != nil || response.Status >= 300 {
		log.Printf("scheduled messages: finish %s: status %d, error %v", r.taskID, response.Status, err)
		return false
	}
	return true
}

func (r *acceptedRun) await(run prompt.RunHandle) {
	defer r.release()
	select {
	case <-r.service.ctx.Done():
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
		for !r.finish(result.Err, complete, false) {
			select {
			case <-r.service.ctx.Done():
				return
			case <-time.After(finishRetryDelay):
			}
		}
	}
}
