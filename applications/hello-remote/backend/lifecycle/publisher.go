// Package lifecycle owns Hello Remote's event publication. It is a sibling of
// api because publishing application events is a backend lifecycle concern,
// not an HTTP request handler, while both packages still run in the same
// per-instance backend process.
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

// Publisher implements the optional publisher capability that api embeds into
// the process served to Remote. Its zero value is ready to initialize.
type Publisher struct {
	mu        sync.Mutex
	publisher applications.EventPublisher
}

func (owner *Publisher) InitPublisher(publisher applications.EventPublisher) error {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	owner.publisher = publisher
	return nil
}

func (owner *Publisher) PublishGreeting(visits int) error {
	owner.mu.Lock()
	publisher := owner.publisher
	owner.mu.Unlock()
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
