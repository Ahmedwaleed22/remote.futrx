package main

import (
	"net/http"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

const (
	greetingPublisher = "greetings"
	greetedEvent      = "greeted"
	greetedVersion    = 1
)

type eventActivity struct {
	PublisherReady bool                `json:"publisherReady"`
	Received       int                 `json:"received"`
	LastEvent      *applications.Event `json:"lastEvent,omitempty"`
}

func (b *api) eventActivity(applications.Request) applications.Response {
	b.mu.Lock()
	activity := eventActivity{
		PublisherReady: b.publisher != nil,
		Received:       b.events,
	}
	if b.lastEvent != nil {
		last := *b.lastEvent
		last.Payload = append([]byte(nil), last.Payload...)
		activity.LastEvent = &last
	}
	b.mu.Unlock()

	return applications.JSON(http.StatusOK, activity)
}
