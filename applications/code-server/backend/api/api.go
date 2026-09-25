package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

const maxSettingsBytes = 128 << 10

// API owns post-install settings. The install script only seeds and restores
// the files; browser edits always pass through this backend.
type API struct {
	router   *applications.Router
	instance applications.Instance
	mu       sync.Mutex
	read     func(string) ([]byte, error)
	write    func(string, []byte) error
}

var _ applications.Backend = (*API)(nil)

func New() *API {
	b := &API{router: applications.NewRouter(), read: readSettings, write: writeSettings}
	b.router.GET("settings", "Read the active Code Server settings", b.getSettings)
	b.router.POST("settings", "Save Code Server settings", b.saveSettings)
	return b
}

func (b *API) Describe() (applications.Descriptor, error) {
	return applications.Descriptor{APIVersion: applications.APIVersion, Routes: b.router.Routes()}, nil
}

func (b *API) Init(instance applications.Instance) error {
	if instance.Scope != "project" || instance.ContainerName == "" || instance.DataDir == "" {
		return fmt.Errorf("Code Server requires a project container and backend data directory")
	}
	b.instance = instance
	marker := filepath.Join(instance.DataDir, "settings-initialized")
	if _, err := os.Stat(marker); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect Code Server settings state: %w", err)
	}
	// A new install gets a new DataDir. Its saved install form must replace any
	// settings left in the durable workspace by a previous uninstalled copy.
	initial, err := validateSettings([]byte(instance.Env["CODE_SERVER_SETTINGS_JSON"]))
	if err != nil {
		return fmt.Errorf("initial Code Server settings: %w", err)
	}
	if err := b.write(instance.ContainerName, initial); err != nil {
		return fmt.Errorf("initialize Code Server settings: %w", err)
	}
	if err := os.WriteFile(marker, []byte("1\n"), 0o600); err != nil {
		return fmt.Errorf("record Code Server settings initialization: %w", err)
	}
	return nil
}

func (b *API) Handle(request applications.Request) (applications.Response, error) {
	return b.router.Serve(request), nil
}

func (b *API) getSettings(_ applications.Request) applications.Response {
	b.mu.Lock()
	defer b.mu.Unlock()
	settings, err := b.read(b.instance.ContainerName)
	if err != nil {
		return applications.JSON(http.StatusBadGateway, map[string]string{"error": "Could not read Code Server settings: " + err.Error()})
	}
	if _, err := validateSettings(settings); err != nil {
		return applications.JSON(http.StatusBadGateway, map[string]string{"error": "Code Server settings on disk are invalid: " + err.Error()})
	}
	return applications.JSON(http.StatusOK, map[string]string{"settings": string(settings)})
}

func (b *API) saveSettings(request applications.Request) applications.Response {
	b.mu.Lock()
	defer b.mu.Unlock()
	var input struct {
		Settings string `json:"settings"`
	}
	if len(request.Body) > maxSettingsBytes+1024 || json.Unmarshal(request.Body, &input) != nil {
		return applications.JSON(http.StatusBadRequest, map[string]string{"error": "Send a settings JSON document."})
	}
	settings, err := validateSettings([]byte(input.Settings))
	if err != nil {
		return applications.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := b.write(b.instance.ContainerName, settings); err != nil {
		return applications.JSON(http.StatusBadGateway, map[string]string{"error": "Could not save Code Server settings: " + err.Error()})
	}
	return applications.JSON(http.StatusOK, map[string]string{"settings": string(settings)})
}

func validateSettings(content []byte) ([]byte, error) {
	if len(content) > maxSettingsBytes {
		return nil, fmt.Errorf("settings exceed 128 KiB")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(content, &object); err != nil || object == nil {
		return nil, fmt.Errorf("settings must be a JSON object")
	}
	var formatted bytes.Buffer
	if err := json.Indent(&formatted, content, "", "  "); err != nil {
		return nil, fmt.Errorf("format settings: %w", err)
	}
	formatted.WriteByte('\n')
	return formatted.Bytes(), nil
}
