package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"futrx.local/catalog/applications/scheduled-tasks/backend/lifecycle"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

const (
	maxTasks       = 100
	maxPromptBytes = 32 << 10
	retryInterval  = 15 * time.Second
)

var (
	ErrInvalidCron     = errors.New("invalid five-field cron expression")
	ErrInvalidTimezone = errors.New("invalid IANA timezone")
)

type Task struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Prompt      string `json:"prompt"`
	ChatID      string `json:"chatId"`
	OwnerEmail  string `json:"ownerEmail"`
	Kind        string `json:"kind"`
	At          string `json:"at,omitempty"`
	Cron        string `json:"cron,omitempty"`
	Timezone    string `json:"timezone"`
	Enabled     bool   `json:"enabled"`
	Archived    bool   `json:"archived"`
	NextRunAt   int64  `json:"nextRunAt,omitempty"`
	RunCount    int    `json:"runCount"`
	MaxRuns     int    `json:"maxRuns,omitempty"`
	ActiveRunID string `json:"activeRunId,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	LastRunAt   int64  `json:"lastRunAt,omitempty"`
}

type API struct {
	mu       sync.Mutex
	instance applications.Instance
	tasks    map[string]Task
	events   lifecycle.TaskEvents
	now      func() time.Time
	router   *applications.Router
	// retry deadlines are volatile; claims themselves are durable.
	retry map[string]time.Time
}

func New(events lifecycle.TaskEvents) *API {
	a := &API{events: events, now: time.Now, tasks: map[string]Task{}, retry: map[string]time.Time{}, router: applications.NewRouter()}
	a.router.GET("health", "Scheduler health", a.health)
	a.router.GET("tasks", "List tasks owned by the caller", a.list)
	a.router.POST("tasks", "Create an active schedule", a.create)
	a.router.Handle("*", "tasks/*", "Read, pause, resume, delete or run a task", a.task)
	return a
}
func (a *API) Describe() (applications.Descriptor, error) {
	return applications.Descriptor{APIVersion: applications.APIVersion, Routes: a.router.Routes()}, nil
}
func (a *API) Init(instance applications.Instance) error {
	if instance.Scope != "project" || instance.ProjectID == "" || instance.DataDir == "" {
		return errors.New("scheduled tasks require a project instance and data directory")
	}
	if err := os.MkdirAll(instance.DataDir, 0700); err != nil {
		return err
	}
	a.instance = instance
	data, err := os.ReadFile(a.filename())
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		if err = json.Unmarshal(data, &a.tasks); err != nil {
			return fmt.Errorf("read scheduled tasks: %w", err)
		}
		if a.tasks == nil {
			a.tasks = map[string]Task{}
		}
	}
	go a.loop()
	return nil
}
func (a *API) Handle(r applications.Request) (applications.Response, error) {
	return a.router.Serve(r), nil
}
func (a *API) health(applications.Request) applications.Response {
	return applications.JSON(200, map[string]bool{"ok": true})
}
func (a *API) list(r applications.Request) applications.Response {
	a.mu.Lock()
	defer a.mu.Unlock()
	tasks := []Task{}
	for _, t := range a.tasks {
		if authorized(t, r.Caller) && (r.QueryValue("chatId") == "" || r.QueryValue("chatId") == t.ChatID) {
			tasks = append(tasks, t)
		}
	}
	return applications.JSON(200, tasks)
}
func authorized(t Task, c applications.Caller) bool {
	return c.IsAdmin || (c.Email != "" && strings.EqualFold(t.OwnerEmail, c.Email))
}
func (a *API) create(r applications.Request) applications.Response {
	if strings.TrimSpace(r.Caller.Email) == "" {
		return applications.Errorf(403, "authenticated task owner required")
	}
	var t Task
	if err := json.Unmarshal(r.Body, &t); err != nil {
		return applications.Errorf(400, "invalid JSON")
	}
	t.Name = strings.TrimSpace(t.Name)
	t.Prompt = strings.TrimSpace(t.Prompt)
	if t.Name == "" || t.Prompt == "" || len(t.Prompt) > maxPromptBytes || t.ChatID == "" || t.MaxRuns < 0 {
		return applications.Errorf(400, "name, chatId and prompt are required; prompt must be at most 32 KiB and maxRuns nonnegative")
	}
	if t.Timezone == "" {
		t.Timezone = "UTC"
	}
	t.OwnerEmail = strings.ToLower(strings.TrimSpace(r.Caller.Email))
	t.Enabled = true
	t.Archived = false
	t.RunCount = 0
	t.ActiveRunID = ""
	t.LastError = ""
	t.LastRunAt = 0
	next, err := nextOccurrence(t, a.now())
	if err != nil {
		return applications.Errorf(400, "%s", err)
	}
	t.NextRunAt = next.UnixMilli()
	t.ID, err = newID()
	if err != nil {
		return applications.Errorf(500, "%s", err)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.tasks) >= maxTasks {
		return applications.Errorf(409, "project task limit reached (100)")
	}
	updated := maps.Clone(a.tasks)
	updated[t.ID] = t
	if err = a.save(updated); err != nil {
		return applications.Errorf(500, "%s", err)
	}
	a.tasks = updated
	return applications.JSON(201, t)
}
func nextOccurrence(t Task, after time.Time) (time.Time, error) {
	loc, err := time.LoadLocation(t.Timezone)
	if err != nil {
		return time.Time{}, ErrInvalidTimezone
	}
	switch t.Kind {
	case "once":
		at, err := time.Parse(time.RFC3339Nano, t.At)
		if err != nil || !at.After(after) {
			return time.Time{}, errors.New("at must be a future RFC3339 time with offset")
		}
		if t.Cron != "" {
			return time.Time{}, errors.New("choose at or cron")
		}
		return at, nil
	case "cron":
		if t.At != "" {
			return time.Time{}, errors.New("choose at or cron")
		}
		return nextCron(t.Cron, after, loc)
	default:
		return time.Time{}, errors.New("kind must be once or cron")
	}
}
func (a *API) task(r applications.Request) applications.Response {
	parts := strings.Split(strings.TrimPrefix(r.Path, "tasks/"), "/")
	id := parts[0]
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	if len(parts) > 2 {
		return applications.Errorf(404, "not found")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.tasks[id]
	if !ok || !authorized(t, r.Caller) {
		return applications.Errorf(404, "task not found")
	}
	if r.Method == "GET" && action == "" {
		return applications.JSON(200, t)
	}
	updated := maps.Clone(a.tasks)
	switch {
	case r.Method == "DELETE" && action == "":
		delete(updated, id)
	case r.Method == "PATCH" && action == "":
		var in struct {
			Enabled  *bool `json:"enabled"`
			Archived *bool `json:"archived"`
		}
		if json.Unmarshal(r.Body, &in) != nil || (in.Enabled == nil && in.Archived == nil) {
			return applications.Errorf(400, "enabled or archived is required")
		}
		if in.Archived != nil {
			t.Archived = *in.Archived
			if t.Archived {
				t.Enabled = false
				t.NextRunAt = 0
			}
		}
		if in.Enabled != nil {
			t.Enabled = *in.Enabled
		}
		if t.Archived && t.Enabled {
			return applications.Errorf(409, "restore this archived task before resuming it")
		}
		if t.Enabled {
			if t.MaxRuns > 0 && t.RunCount >= t.MaxRuns {
				return applications.Errorf(409, "task has reached maxRuns")
			}
			if t.ActiveRunID == "" {
				next, err := nextOccurrence(t, a.now())
				if err != nil {
					return applications.Errorf(400, "%s", err)
				}
				t.NextRunAt = next.UnixMilli()
			}
		}
		updated[id] = t
	case r.Method == "POST" && action == "run":
		if t.Archived {
			return applications.Errorf(409, "restore this archived task before running it")
		}
		if t.ActiveRunID != "" {
			return applications.Errorf(409, "task already has a pending run")
		}
		runID, err := newID()
		if err != nil {
			return applications.Errorf(500, "%s", err)
		}
		t.ActiveRunID = runID
		updated[id] = t
	case r.Method == "POST" && action == "complete":
		var in struct {
			RunID string `json:"runId"`
		}
		if json.Unmarshal(r.Body, &in) != nil || in.RunID == "" || in.RunID != t.ActiveRunID {
			return applications.Errorf(403, "active run required")
		}
		t.Enabled = false
		t.Archived = true
		t.NextRunAt = 0
		updated[id] = t
	case r.Method == "POST" && action == "finish":
		// Only the core dispatcher supplies an administrative, ownerless caller.
		if !r.Caller.IsAdmin || r.Caller.Email != "" {
			return applications.Errorf(403, "core dispatcher required")
		}
		var in struct {
			RunID    string `json:"runId"`
			Error    string `json:"error"`
			Complete bool   `json:"complete"`
			Retry    bool   `json:"retry"`
		}
		if json.Unmarshal(r.Body, &in) != nil || in.RunID == "" || in.RunID != t.ActiveRunID {
			return applications.Errorf(409, "run claim changed")
		}
		t.LastError = in.Error
		if in.Retry {
			a.retry[id] = a.now().Add(retryInterval)
		} else {
			t.ActiveRunID = ""
			t.RunCount++
			t.LastRunAt = a.now().UnixMilli()
			if t.Kind == "once" || in.Complete || (t.MaxRuns > 0 && t.RunCount >= t.MaxRuns) {
				t.Enabled = false
				t.Archived = true
				t.NextRunAt = 0
			} else if t.Enabled {
				next, err := nextOccurrence(t, a.now())
				if err != nil {
					t.Enabled = false
					t.LastError = err.Error()
				} else {
					t.NextRunAt = next.UnixMilli()
				}
			}
		}
		updated[id] = t
	default:
		return applications.Errorf(405, "method not allowed")
	}
	if err := a.save(updated); err != nil {
		return applications.Errorf(500, "%s", err)
	}
	a.tasks = updated
	if r.Method == "DELETE" {
		return applications.JSON(200, map[string]bool{"ok": true})
	}
	return applications.JSON(200, t)
}
func (a *API) filename() string { return filepath.Join(a.instance.DataDir, "tasks.json") }
func (a *API) save(tasks map[string]Task) error {
	data, err := json.Marshal(tasks)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(a.instance.DataDir, "tasks-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), a.filename()); err != nil {
		return err
	}
	dir, err := os.Open(a.instance.DataDir)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func newID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func (a *API) loop() {
	for range time.Tick(time.Second) {
		if err := a.tick(); err != nil {
			fmt.Fprintf(os.Stderr, "scheduled tasks: %v\n", err)
		}
	}
}
func (a *API) tick() error {
	due, err := a.claimDue()
	if err != nil {
		return err
	}
	for _, t := range due {
		if err := a.events.Due(t.ID, t.ActiveRunID); err != nil {
			return err
		}
	}
	return nil
}

// claimDue durably claims every due task before its event is published.
func (a *API) claimDue() ([]Task, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	updated := maps.Clone(a.tasks)
	due := []Task{}
	for id, t := range updated {
		if !t.Enabled && t.ActiveRunID == "" {
			continue
		}
		if t.ActiveRunID == "" {
			if t.NextRunAt <= 0 || t.NextRunAt > now.UnixMilli() {
				continue
			}
			runID, err := newID()
			if err != nil {
				return nil, err
			}
			t.ActiveRunID = runID
			updated[id] = t
		}
		if !a.retry[id].After(now) {
			due = append(due, t)
		}
	}
	if len(due) > 0 {
		if err := a.save(updated); err != nil {
			return nil, err
		}
		a.tasks = updated
		for _, t := range due {
			a.retry[t.ID] = now.Add(retryInterval)
		}
	}
	return due, nil
}
