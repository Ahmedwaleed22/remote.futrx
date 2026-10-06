package filechat

import (
	"bytes"
	"errors"
	"io"
	"os"

	configconstants "github.com/futrx-com/remote.futrx.com/internal/config/constants"
	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
)

func lastStoredEventSeq(eventsPath string, fileSize int64) (int64, error) {
	if fileSize <= 0 {
		return 0, nil
	}
	file, err := os.Open(eventsPath)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	// Most records fit in one small read. Expand only for a genuinely large
	// final record; never decode a partial record at the start of a window.
	for window := int64(configconstants.ChatTailInitialReadBytes); ; window *= 2 {
		if window > int64(maxEventRecordBytes+2) {
			window = int64(maxEventRecordBytes + 2)
		}
		if window > fileSize {
			window = fileSize
		}
		raw := make([]byte, int(window))
		if _, err := file.ReadAt(raw, fileSize-window); err != nil && !errors.Is(err, io.EOF) {
			return 0, err
		}
		lines := bytes.Split(raw, []byte{'\n'})
		first := 0
		if window < fileSize {
			first = 1
		}
		for i := len(lines) - 1; i >= first; i-- {
			line := bytes.TrimSuffix(lines[i], []byte{'\r'})
			if len(line) == 0 {
				continue
			}
			event, err := decodeStoredEvent(line, 0)
			if err == nil && event.Seq > 0 {
				return event.Seq, nil
			}
		}
		if window == fileSize || window == int64(maxEventRecordBytes+2) {
			break
		}
	}
	return 0, errors.New("last stored event has no sequence")
}

// A bounded metadata cache avoids repeating the tail read on indexing polls.
// Size and nanosecond mtime invalidate it on append, truncate or rewrite.
type chatTailSequence struct {
	size, mtime, seq int64
	err              error
}

func (s *Store) cachedTailSequence(id servicechat.ID, size, mtime int64) (int64, error) {
	s.tailMu.Lock()
	entry, found := s.tails[id]
	s.tailMu.Unlock()
	if found && entry.size == size && entry.mtime == mtime {
		return entry.seq, entry.err
	}
	seq, err := lastStoredEventSeq(s.eventsPath(id), size)
	s.tailMu.Lock()
	if s.tails == nil {
		s.tails = make(map[servicechat.ID]chatTailSequence)
	}
	if len(s.tails) >= configconstants.ChatTailSequenceCacheEntries {
		for key := range s.tails {
			delete(s.tails, key)
			break
		}
	}
	s.tails[id] = chatTailSequence{size: size, mtime: mtime, seq: seq, err: err}
	s.tailMu.Unlock()
	return seq, err
}
