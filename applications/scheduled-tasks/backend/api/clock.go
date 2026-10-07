package api

import (
	"fmt"
	"maps"
	"os"
	"time"
)

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
		if err := a.commit(updated); err != nil {
			return nil, err
		}
		for _, t := range due {
			a.retry[t.ID] = now.Add(retryInterval)
		}
	}
	return due, nil
}
