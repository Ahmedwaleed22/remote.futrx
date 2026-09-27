package applications

import (
	"context"
	"errors"
	"testing"
	"time"
)

type gatedInstallProjects struct {
	gate *operationGate
	err  error
}

func (*gatedInstallProjects) ContainerName(context.Context, string) (string, error) {
	return "project-container", nil
}
func (p *gatedInstallProjects) EnsureRunning(ctx context.Context, projectID string) error {
	if projectID != "proj-1" {
		return nil
	}
	if err := p.gate.wait(ctx); err != nil {
		return err
	}
	return p.err
}

// Reopening the dialog can send another request while container startup is
// still running, before the database contains any installing record.
func TestInstallReservesScopeBeforePersistingAttempt(t *testing.T) {
	for _, fails := range []bool{false, true} {
		name := "success"
		if fails {
			name = "failure"
		}
		t.Run(name, func(t *testing.T) {
			service, installer, _, store := portlessInfrastructureService(portlessInfrastructureApplication())
			gate := newOperationGate()
			projects := &gatedInstallProjects{gate: gate}
			if fails {
				projects.err = errors.New("container startup failed")
			}
			service.projects = projects
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req := InstallRequest{ApplicationID: "mount-tool", Scope: ScopeProject, ProjectID: "proj-1"}
			done := make(chan error, 1)
			go func() { _, err := service.Install(ctx, req); done <- err }()
			select {
			case <-gate.entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			instances, _ := store.ListProject(ctx, req.ProjectID)
			if len(instances) != 0 {
				t.Fatal("attempt must still be before persistence")
			}
			if _, err := service.Install(ctx, req); !errors.Is(err, ErrAlreadyInstalled) {
				t.Fatalf("overlapping install = %v, want ErrAlreadyInstalled", err)
			}
			// A reservation must not block the same application in another project.
			other := req
			other.ProjectID = "proj-2"
			if _, err := service.Install(ctx, other); err != nil {
				t.Fatalf("other project: %v", err)
			}
			close(gate.release)
			err := <-done
			if !errors.Is(err, projects.err) {
				t.Fatalf("first install = %v, want %v", err, projects.err)
			}
			if fails {
				projects.err = nil
				if _, err := service.Install(ctx, req); err != nil {
					t.Fatalf("retry after failure: %v", err)
				}
			}
			if _, err := service.Install(ctx, req); !errors.Is(err, ErrAlreadyInstalled) {
				t.Fatalf("completed duplicate = %v, want ErrAlreadyInstalled", err)
			}
			instances, _ = store.ListProject(ctx, req.ProjectID)
			if len(instances) != 1 {
				t.Fatalf("instances = %d, want 1", len(instances))
			}
			if len(installer.installed) != 2 {
				t.Fatalf("installer calls = %d, want one per project", len(installer.installed))
			}
		})
	}
}

func TestInstallRefusesPersistedInstallingAttempt(t *testing.T) {
	service, installer, _, store := portlessInfrastructureService(portlessInfrastructureApplication())
	ctx := context.Background()
	if err := store.Put(ctx, Instance{ID: "in-progress", ApplicationID: "mount-tool", Scope: ScopeProject, ProjectID: "proj-1", Status: StatusInstalling}); err != nil {
		t.Fatal(err)
	}
	_, err := service.Install(ctx, InstallRequest{ApplicationID: "mount-tool", Scope: ScopeProject, ProjectID: "proj-1"})
	if !errors.Is(err, ErrAlreadyInstalled) {
		t.Fatalf("install = %v, want ErrAlreadyInstalled", err)
	}
	if len(installer.installed) != 0 {
		t.Fatal("duplicate installer was invoked")
	}
}
