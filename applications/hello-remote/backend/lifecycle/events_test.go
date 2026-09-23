package lifecycle

import (
	"encoding/json"
	"sync"
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
	var events Events
	publisher := &recordingPublisher{}
	if err := events.InitPublisher(publisher); err != nil {
		t.Fatalf("init publisher: %v", err)
	}
	if err := events.PublishGreeting(3); err != nil {
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

func TestEventSnapshotsOwnTheirPayloadBytes(t *testing.T) {
	var events Events
	payload := json.RawMessage(`{"visits":1}`)
	if err := events.OnEvent(applications.Event{
		Name: "greeted", Version: 1, Payload: payload,
	}); err != nil {
		t.Fatalf("receive event: %v", err)
	}
	payload[0] = 'x'

	first := events.Snapshot()
	if first.Received != 1 || string(first.LastEvent.Payload) != `{"visits":1}` {
		t.Fatalf("snapshot = %+v", first)
	}
	first.LastEvent.Payload[0] = 'x'
	if got := string(events.Snapshot().LastEvent.Payload); got != `{"visits":1}` {
		t.Fatalf("stored payload changed through snapshot: %s", got)
	}
}

func TestOnEventIsSafeForConcurrentDelivery(t *testing.T) {
	var events Events
	const deliveries = 32
	var wait sync.WaitGroup
	wait.Add(deliveries)
	for index := 0; index < deliveries; index++ {
		go func() {
			defer wait.Done()
			_ = events.OnEvent(applications.Event{
				Name: "greeted", Version: 1,
				Payload: json.RawMessage(`{"visits":1}`),
			})
		}()
	}
	wait.Wait()

	if got := events.Snapshot().Received; got != deliveries {
		t.Fatalf("received = %d, want %d", got, deliveries)
	}
}
