package filechat

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
)

func TestQuestionStateSurvivesStoreReopenWithoutLeakingIntoChatMetadata(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	state := servicechat.QuestionState{TurnID: "turn", PendingInteractions: []string{"request-private"}, LegacyPending: true}
	if _, err := store.Create(ctx, servicechat.Meta{ID: "abcd", QuestionState: state}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	meta, err := reopened.Get(ctx, "abcd")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(meta.QuestionState, state) {
		t.Fatalf("reopened question state = %+v", meta.QuestionState)
	}
	meta.AwaitingAnswer = meta.QuestionState.AwaitingAnswer(false)
	data, err := json.Marshal(meta)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"awaitingAnswer":true`) || strings.Contains(string(data), "request-private") || strings.Contains(string(data), "questionState") {
		t.Fatalf("public metadata does not isolate private question state: %s", data)
	}
}
