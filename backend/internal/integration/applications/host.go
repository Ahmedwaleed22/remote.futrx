package applications

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"

	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

// Catalog supplies the Go source of an application's backend. It is the registry,
// narrowed to the one thing the host needs from it.
type Catalog interface {
	BackendSource(applicationID string) (fs.FS, bool)
}

// Host runs one backend process per installed instance.
//
// The unit is the instance, not the application: an application installed globally and in
// two projects is three processes, because each serves a different install
// with its own environment, its own data directory, and its own crash
// behaviour. They share one compiled binary.
type Host struct {
	root    string
	catalog Catalog
	builder *Builder
	logger  hclog.Logger

	launches keyedLocks

	mu      sync.Mutex
	running map[string]*backendProcess
}

// Options supplies process-host settings owned by the application edge.
type Options struct {
	GoTool string
}

// New builds a backend host that keeps compiled binaries, generated modules,
// and per-instance data under root.
func New(root string, catalog Catalog, options Options) *Host {
	return &Host{
		root:    root,
		catalog: catalog,
		builder: NewBuilder(root, options.GoTool),
		logger: hclog.New(&hclog.LoggerOptions{
			Name:   "app-backend",
			Level:  hclog.Info,
			Output: os.Stderr,
		}),
		launches: newKeyedLocks(),
		running:  map[string]*backendProcess{},
	}
}

var _ svc.BackendHost = (*Host)(nil)

// handshakeTimeout bounds a backend's startup. A backend that has not completed
// go-plugin's handshake by then is not going to.
const handshakeTimeout = 30 * time.Second

// Ensure compiles the application's backend if needed, starts a process for the
// instance, and returns its manifest-enriched descriptor.
func (h *Host) Ensure(ctx context.Context, instance applications.Instance) (applications.Descriptor, error) {
	current, err := h.ensure(ctx, instance)
	if err != nil {
		return applications.Descriptor{}, err
	}
	return current.descriptor, nil
}

// Call forwards one request, starting the backend first if it is not running.
func (h *Host) Call(
	ctx context.Context,
	instance applications.Instance,
	request applications.Request,
) (applications.Response, error) {
	current, err := h.ensure(ctx, instance)
	if err != nil {
		return applications.Response{}, err
	}
	return current.call(ctx, request)
}

// Stop terminates an instance's backend, keeping its data directory so a later
// start resumes with it.
func (h *Host) Stop(_ context.Context, instanceID string) error {
	unlock := h.launches.lock(instanceID)
	defer unlock()
	h.kill(instanceID)
	return nil
}

// Remove terminates an instance's backend and discards its data. Uninstalling
// is the only thing that deletes backend state, which is what makes stop and
// start safe to use freely.
//
// Killing and deleting happen under one hold of the launch lock. Taking it
// twice would leave a window between them in which a request already inside
// ensure could launch a replacement process against the instance being removed:
// the uninstall would then delete the data directory of a live backend and
// return, leaving that backend running with nothing left to address it by.
func (h *Host) Remove(_ context.Context, instanceID string) error {
	unlock := h.launches.lock(instanceID)
	defer unlock()
	h.kill(instanceID)
	if err := os.RemoveAll(h.dataDir(instanceID)); err != nil {
		return fmt.Errorf("remove backend data for %s: %w", instanceID, err)
	}
	return nil
}

// Shutdown stops every running backend. The server calls it on the way out so
// backend processes do not outlive it.
func (h *Host) Shutdown() {
	h.mu.Lock()
	ids := make([]string, 0, len(h.running))
	for id := range h.running {
		ids = append(ids, id)
	}
	h.mu.Unlock()

	for _, id := range ids {
		_ = h.Stop(context.Background(), id)
	}
}

// ---- launching --------------------------------------------------------------

// ensure returns a live process for the instance, launching one if there is
// none or if the previous one exited.
func (h *Host) ensure(ctx context.Context, instance applications.Instance) (*backendProcess, error) {
	instanceID := instance.ID
	applicationID := instance.ApplicationID

	// A live process needs nothing else, and this is the path every request
	// takes. An application's source changes only when an administrator uploads a
	// new version of its package, and the applications service stops this
	// instance's process when that happens — so a running process is by
	// construction current, and re-reading and re-hashing the whole backend on
	// every request would discover nothing while funnelling concurrent calls
	// through the builder's per-application lock.
	if current := h.lookup(instanceID); current != nil && current.running() {
		return current, nil
	}

	source, ok := h.catalog.BackendSource(applicationID)
	if !ok {
		return nil, fmt.Errorf("%w: %s ships no backend source", svc.ErrNoBackend, applicationID)
	}
	// Building stays outside the launch lock so two instances of the same
	// application share one build instead of queueing behind each other's launches.
	binary, err := h.builder.Build(ctx, applicationID, source)
	if err != nil {
		return nil, err
	}

	unlock := h.launches.lock(instanceID)
	defer unlock()

	// Re-check under the lock: another caller may have launched it while this
	// one was building.
	if current := h.lookup(instanceID); current != nil {
		if current.binary == binary && current.running() {
			return current, nil
		}
		// An exited client means the backend crashed, which is answered by
		// replacing the process — that is why a crashed backend recovers on the
		// next call.
		h.kill(instanceID)
	}
	return h.launch(ctx, instance, binary)
}

func (h *Host) launch(ctx context.Context, instance applications.Instance, binary string) (*backendProcess, error) {
	instanceID := instance.ID
	applicationID := instance.ApplicationID
	dataDir := h.dataDir(instanceID)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create backend data directory: %w", err)
	}

	client := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: backendHandshake,
		Plugins:         goplugin.PluginSet{backendName: &backendAdapter{}},
		Cmd:             exec.Command(binary),
		Logger:          h.logger.Named(applicationID),
		StartTimeout:    handshakeTimeout,
	})

	started, err := h.connect(client, instance, dataDir)
	if err != nil {
		client.Kill()
		return nil, err
	}
	started.binary = binary

	h.mu.Lock()
	h.running[instanceID] = started
	h.mu.Unlock()
	return started, nil
}

// connect completes the handshake, checks the contract version, and hands the
// instance over. Every failure here kills the process rather than leaving a
// half-initialized backend reachable.
func (h *Host) connect(client *goplugin.Client, instance applications.Instance, dataDir string) (*backendProcess, error) {
	applicationID := instance.ApplicationID
	protocol, err := client.Client()
	if err != nil {
		return nil, fmt.Errorf("start backend %s: %w", applicationID, err)
	}
	raw, err := protocol.Dispense(backendName)
	if err != nil {
		return nil, fmt.Errorf("connect to backend %s: %w", applicationID, err)
	}
	backend, ok := raw.(applications.Backend)
	if !ok {
		return nil, fmt.Errorf("backend %s served an unexpected type %T", applicationID, raw)
	}
	descriptor, err := backend.Describe()
	if err != nil {
		return nil, fmt.Errorf("describe backend %s: %w", applicationID, err)
	}
	if descriptor.APIVersion != applications.APIVersion {
		return nil, fmt.Errorf(
			"backend %s reports contract version %d, this server speaks %d",
			applicationID, descriptor.APIVersion, applications.APIVersion)
	}
	// application.json is the metadata source of truth for the package. A
	// backend is one capability of that package, so making every backend repeat
	// the same name and version in Describe only creates values that can drift.
	descriptor.Name = instance.ApplicationName
	descriptor.Version = instance.ApplicationVersion
	if err := backend.Init(instanceWithDataDir(instance, dataDir)); err != nil {
		return nil, fmt.Errorf("initialize backend %s: %w", applicationID, err)
	}
	return &backendProcess{client: client, backend: backend, descriptor: descriptor}, nil
}

// instanceWithDataDir adds the host-owned directory to the instance before it
// crosses the backend boundary. It carries the resolved environment, secrets
// included: an application's backend needs the password its own install script
// generated.
func instanceWithDataDir(instance applications.Instance, dataDir string) applications.Instance {
	instance.DataDir = dataDir
	return instance
}

func (h *Host) lookup(instanceID string) *backendProcess {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.running[instanceID]
}

// kill terminates an instance's process. The caller holds its launch lock.
func (h *Host) kill(instanceID string) {
	h.mu.Lock()
	current := h.running[instanceID]
	delete(h.running, instanceID)
	h.mu.Unlock()

	if current != nil {
		current.stop()
	}
}

func (h *Host) dataDir(instanceID string) string {
	return filepath.Join(h.root, "data", instanceID)
}
