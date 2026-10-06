package filechat

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
)

func TestTailSequenceExpandsOnlyForCompleteRecord(t *testing.T) {
	for _, length := range []int{20, 5000, 90000} {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "events.jsonl")
			raw := []byte(fmt.Sprintf("{\"type\":\"complete\",\"seq\":1,\"t\":1}\n{\"type\":\"assistant_text\",\"seq\":2,\"t\":2,\"text\":\"%s\"}\n", bytes.Repeat([]byte("x"), length)))
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			seq, err := lastStoredEventSeq(path, int64(len(raw)))
			if err != nil || seq != 2 {
				t.Fatalf("seq=%d err=%v", seq, err)
			}
		})
	}
}

func TestCachedTailSequenceInvalidatesOnRewriteAndSizeChange(t *testing.T) {
	store := &Store{root: t.TempDir()}
	id := servicechat.ID("0123456789ab")
	if err := os.MkdirAll(store.chatDir(id), 0700); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		records string
		mtime   int64
		seq     int64
	}{
		{"{\"type\":\"complete\",\"seq\":1,\"t\":1}\n", 1, 1},
		{"{\"type\":\"complete\",\"seq\":2,\"t\":2}\n", 2, 2},
		{"{\"type\":\"complete\",\"seq\":3,\"t\":3}\n\n", 2, 3},
		{"{\"type\":\"complete\",\"seq\":4,\"t\":4}\n", 2, 4},
	} {
		if err := os.WriteFile(store.eventsPath(id), []byte(step.records), 0600); err != nil {
			t.Fatal(err)
		}
		seq, err := store.cachedTailSequence(id, int64(len(step.records)), step.mtime)
		if err != nil || seq != step.seq {
			t.Fatalf("seq=%d want=%d err=%v", seq, step.seq, err)
		}
		// An unchanged snapshot can still be served without reopening the log.
		if err := os.Remove(store.eventsPath(id)); err != nil {
			t.Fatal(err)
		}
		seq, err = store.cachedTailSequence(id, int64(len(step.records)), step.mtime)
		if err != nil || seq != step.seq {
			t.Fatalf("cached seq=%d want=%d err=%v", seq, step.seq, err)
		}
	}
}
