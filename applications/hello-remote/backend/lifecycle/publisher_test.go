package lifecycle

import (
	"encoding/json"
	"testing"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

type recordingPublisher struct {
	publication applications.Publication
}

func (publisher *recordingPublisher) Publish(publication applications.Publication) error {
	publication.Payload = append(json.RawMessage(nil), publication.Payload...)
	publisher.publication = publication
	return nil
}

func TestPublishGreetingUsesTheDeclaredEventContract(t *testing.T) {
	var owner Publisher
	publisher := &recordingPublisher{}
	if err := owner.InitPublisher(publisher); err != nil {
		t.Fatalf("init publisher: %v", err)
	}
	if err := owner.PublishGreeting(3); err != nil {
		t.Fatalf("publish greeting: %v", err)
	}

	publication := publisher.publication
	if publication.Publisher != "greetings" || publication.Event != "greeted" ||
		publication.Version != 1 {
		t.Fatalf("publication identity = %+v", publication)
	}
	var payload map[string]int
	if err := json.Unmarshal(publication.Payload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload["visits"] != 3 {
		t.Fatalf("payload = %v, want visits 3", payload)
	}
}
