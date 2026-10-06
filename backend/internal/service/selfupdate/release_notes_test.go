package selfupdate

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeReleaseNotes struct {
	body  string
	err   error
	calls int
	tag   string
	dir   string
}

func (f *fakeReleaseNotes) ReadReleaseNotes(_ context.Context, dir, tag string) (ReleaseNotes, error) {
	f.calls++
	f.dir, f.tag = dir, tag
	return ReleaseNotes{Tag: tag, Body: f.body}, f.err
}

func TestReleaseNotesCachesOnlyTheRequestedRelease(t *testing.T) {
	reader := &fakeReleaseNotes{body: "## Fixes\n- Preserve project files"}
	svc := New("0.25.0", "/opt/remote", t.TempDir(), &fakeHost{}, reader, noopUpdateLifecyclePublisher{})
	var calls sync.WaitGroup
	for range 10 {
		calls.Go(func() {
			notes, err := svc.ReleaseNotes(context.Background(), "0.25.1")
			if err != nil || notes.Tag != "0.25.1" || notes.Body != reader.body {
				t.Errorf("notes = %+v, error = %v", notes, err)
			}
		})
	}
	calls.Wait()
	if reader.calls != 1 || reader.dir != "/opt/remote" || reader.tag != "0.25.1" {
		t.Fatalf("reader = %+v", reader)
	}
	notes, err := svc.ReleaseNotes(context.Background(), "0.26.0")
	if err != nil || notes.Tag != "0.26.0" || reader.calls != 2 {
		t.Fatalf("new tag notes = %+v, error = %v, calls = %d", notes, err, reader.calls)
	}
	svc.notesCheckedAt = time.Now().Add(-releaseNotesCacheTTL)
	if _, err := svc.ReleaseNotes(context.Background(), "0.26.0"); err != nil || reader.calls != 3 {
		t.Fatalf("expired cache: error = %v, calls = %d", err, reader.calls)
	}
}

func TestReleaseNotesFailureDoesNotChangeUpdateAvailability(t *testing.T) {
	reader := &fakeReleaseNotes{err: errors.New("GitHub unavailable")}
	svc := New("0.25.0", "/opt/remote", t.TempDir(), &fakeHost{tags: []string{"0.25.1"}}, reader, noopUpdateLifecyclePublisher{})
	before := svc.Check(context.Background())
	if _, err := svc.ReleaseNotes(context.Background(), "0.25.1"); err == nil {
		t.Fatal("expected release notes failure")
	}
	after := svc.Status(context.Background())
	if after.LastCheck != before.LastCheck || !after.LastCheck.UpdateAvailable {
		t.Fatal("notes failure changed the available update")
	}
	reader.err = nil
	if _, err := svc.ReleaseNotes(context.Background(), "0.25.1"); err != nil {
		t.Fatal(err)
	}
	reader.body = "Published after the tag"
	notes, err := svc.ReleaseNotes(context.Background(), "0.25.1")
	if err != nil || notes.Body != reader.body || reader.calls != 3 {
		t.Fatalf("errors and empty notes must be retried: notes = %+v, error = %v, calls = %d", notes, err, reader.calls)
	}
}

func TestReleaseNotesRejectsInvalidTagsBeforeReading(t *testing.T) {
	reader := &fakeReleaseNotes{}
	svc := New("0.25.0", "/opt/remote", t.TempDir(), &fakeHost{}, reader, noopUpdateLifecyclePublisher{})
	for _, tag := range []string{"", "main", "../main", "--help", "v0.25.1/other"} {
		if _, err := svc.ReleaseNotes(context.Background(), tag); !errors.Is(err, ErrInvalidReleaseTag) {
			t.Errorf("tag %q: error = %v", tag, err)
		}
	}
	if reader.calls != 0 {
		t.Fatalf("reader called %d times for invalid tags", reader.calls)
	}
}
