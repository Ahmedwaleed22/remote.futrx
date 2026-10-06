package filechat

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkLoadingTailSequence(b *testing.B) {
	path := filepath.Join(b.TempDir(), "events.jsonl")
	// A 32 MiB log with a normal small final event. Fixture setup is untimed.
	raw := bytes.Repeat([]byte(" "), 32<<20)
	raw = append(raw, '\n')
	raw = append(raw, []byte(`{"type":"complete","seq":7000,"t":7000}`+"\n")...)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		b.Fatal(err)
	}
	size := int64(len(raw))
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		seq, err := lastStoredEventSeq(path, size)
		if err != nil || seq != 7000 {
			b.Fatalf("seq=%d err=%v", seq, err)
		}
	}
}
func TestLoadingTailSequenceExpandsOnlyForCompleteRecord(t *testing.T) {
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
