package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
)

// visitsFile is where the greeting counter lives inside the instance's
// DataDir. That directory is the only storage a plugin can rely on: the
// process is killed on stop, uninstall, and server restart, and restarted
// lazily by the next call, so anything kept in memory is gone by then. The
// counter surviving a restart is the whole point of the example.
const visitsFile = "visits.json"

func (b *backend) readVisits(appplugin.Request) appplugin.Response {
	b.mu.Lock()
	defer b.mu.Unlock()
	return appplugin.JSON(http.StatusOK, map[string]int{"visits": b.visits})
}

func (b *backend) countVisit(appplugin.Request) appplugin.Response {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.visits++
	if err := writeVisits(b.instance.DataDir, b.visits); err != nil {
		// The count is still correct in memory, so the call succeeds and the
		// browser sees it; only its survival across a restart is lost. A
		// plugin's errors are its own to grade — the host only forwards them.
		return appplugin.JSON(http.StatusOK, map[string]any{
			"visits":  b.visits,
			"warning": fmt.Sprintf("not persisted: %v", err),
		})
	}
	return appplugin.JSON(http.StatusOK, map[string]int{"visits": b.visits})
}

// readVisits tolerates every kind of missing: no DataDir, no file, or a file
// this version cannot read. A fresh install and an unreadable one both start
// at zero rather than failing Init, which would fail the app's start.
func readVisits(dataDir string) int {
	if dataDir == "" {
		return 0
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, visitsFile))
	if err != nil {
		return 0
	}
	var state struct {
		Visits int `json:"visits"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return 0
	}
	return state.Visits
}

func writeVisits(dataDir string, visits int) error {
	if dataDir == "" {
		return fmt.Errorf("no data directory")
	}
	raw, err := json.Marshal(map[string]int{"visits": visits})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dataDir, visitsFile), raw, 0o600)
}
