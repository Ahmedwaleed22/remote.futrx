// Package lifecycle owns Hello Remote's event publishing and subscription
// state. It is a sibling of api because event flow is a backend lifecycle
// concern, not an HTTP request handler, while both packages still run in the
// same per-instance backend process.
package lifecycle

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

const (
	greetingsPublisher = "greetings"
	greetedEvent       = "greeted"
	greetedVersion     = 1
)

type Activity struct {
	PublisherReady bool                `json:"publisherReady"`
	Received       int                 `json:"received"`
	LastEvent      *applications.Event `json:"lastEvent,omitempty"`
}

// Events implements the optional publisher and subscriber capabilities that
// api embeds into the process served to Remote. Its zero value is ready to use.
type Events struct {
	mu        sync.Mutex
	publisher applications.EventPublisher
	received  int
	lastEvent *applications.Event
}

func (events *Events) InitPublisher(publisher applications.EventPublisher) error {
	events.mu.Lock()
	defer events.mu.Unlock()
	events.publisher = publisher
	return nil
}

func (events *Events) OnEvent(event applications.Event) error {
	event.Payload = append([]byte(nil), event.Payload...)
	events.mu.Lock()
	defer events.mu.Unlock()
	events.received++
	events.lastEvent = &event
	return nil
}

func (events *Events) PublishGreeting(visits int) error {
	events.mu.Lock()
	publisher := events.publisher
	events.mu.Unlock()
	if publisher == nil {
		return fmt.Errorf("publisher is not initialized")
	}

	payload, err := json.Marshal(map[string]int{"visits": visits})
	if err != nil {
		return fmt.Errorf("encode greeted event: %w", err)
	}
	return publisher.Publish(applications.Publication{
		Publisher: greetingsPublisher,
		Event:     greetedEvent,
		Version:   greetedVersion,
		Payload:   payload,
	})
}

func (events *Events) Snapshot() Activity {
	events.mu.Lock()
	defer events.mu.Unlock()

	activity := Activity{
		PublisherReady: events.publisher != nil,
		Received:       events.received,
	}
	if events.lastEvent != nil {
		last := *events.lastEvent
		last.Payload = append([]byte(nil), last.Payload...)
		activity.LastEvent = &last
	}
	return activity
}
