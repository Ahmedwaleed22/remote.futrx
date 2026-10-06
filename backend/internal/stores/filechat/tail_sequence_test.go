package filechat

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
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
