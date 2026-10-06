package selfupdate

import (
	"context"
	"time"
)

const releaseNotesCacheTTL = 5 * time.Minute

// ReleaseNotes does not change LastCheck or run state. A notes outage must not
// hide an available update or prevent an administrator from installing it.
func (s *Service) ReleaseNotes(ctx context.Context, tag string) (ReleaseNotes, error) {
	if _, ok := parseReleaseTag(tag); !ok {
		return ReleaseNotes{}, ErrInvalidReleaseTag
	}
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	if s.cachedNotes.Tag == tag && time.Since(s.notesCheckedAt) < releaseNotesCacheTTL {
		return s.cachedNotes, nil
	}
	notes, err := s.releaseNotes.ReadReleaseNotes(ctx, s.installDir, tag)
	if err != nil {
		return ReleaseNotes{}, err
	}
	// Keep only one successful release, and retry unpublished/empty notes on
	// the next request: a release can be published shortly after its tag.
	if notes.Body != "" {
		s.cachedNotes = notes
		s.notesCheckedAt = time.Now()
	}
	return notes, nil
}
