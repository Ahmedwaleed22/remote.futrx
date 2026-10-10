package applications

import (
	"context"
	"testing"
)

type bulkProjects struct{ staticProjects }

func (*bulkProjects) ListProjectIDs(context.Context) ([]string, error) {
	return []string{"p1", "p2"}, nil
}

func TestGlobalInstallPlacement(t *testing.T) {
	for _, inside := range []bool{true, false} {
		app := serviceApplicationAt("1")
		app.GloballyInstalledInsideContainers = inside
		store := &fakeStore{}
		s := New(&singleApplicationRegistry{application: app}, store, &recordingInstaller{}, &bulkProjects{}, &countingAllocator{})
		if _, err := s.Install(context.Background(), InstallRequest{ApplicationID: app.ID, Scope: ScopeGlobal}); err != nil {
			t.Fatal(err)
		}
		inProjects := len(store.byProject["p1"]) == 1 && len(store.byProject["p2"]) == 1 && len(store.global) == 0
		dedicated := len(store.byProject) == 0 && len(store.global) == 1
		if inside && !inProjects || !inside && !dedicated {
			t.Fatalf("inside=%v: global=%d projects=%v", inside, len(store.global), store.byProject)
		}
	}
}
