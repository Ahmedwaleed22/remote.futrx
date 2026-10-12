package service

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	servicechat "github.com/futrx-com/remote.futrx.com/internal/service/chat"
	servicepresence "github.com/futrx-com/remote.futrx.com/internal/service/presence"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	servicepush "github.com/futrx-com/remote.futrx.com/internal/service/push"
)

// audienceTimeout bounds the store reads that resolve who to notify. The
// delivery itself runs separately, on the push service's own deadline.
const audienceTimeout = 5 * time.Second

// chatPushNotifier turns persisted chat events into push notifications. It
// hangs off the chat repository so every path that appends an event —
// interactive prompts, application turns, recovery — is covered by construction.
type chatPushNotifier struct {
	push     *servicepush.Service
	chats    servicechat.Repository
	projects interface {
		Get(context.Context, serviceproject.ID) (serviceproject.Meta, error)
	}
	audience chatNotificationAudience
	presence *servicepresence.Service

	// parked records unanswered requests. Legacy runs can end while waiting;
	// native requests resume inside the same run. Routine terminal events must
	// not replace a question that still needs the user.
	mu     sync.Mutex
	parked map[servicechat.ID]servicechat.QuestionState

	questionBatches map[servicechat.ID]map[questionBatch]uint64

	// notified records, per chat, the chat's read marker at the moment its
	// last notification went out. Until that marker moves forward the user
	// has not seen the chat since, so later turns stay quiet instead of
	// piling up: iOS ignores the per-chat tag and stacks every notification.
	// Held in memory; a restart costs at most one extra notification per chat.
	notified map[servicechat.ID]unreadNotice
	claims   uint64
}

// unreadNotice is one chat's outstanding notification. claim identifies the
// send that recorded it, so a failed delivery can undo only its own record.
type unreadNotice struct {
	readAt int64
	claim  uint64
}

type questionBatch struct {
	turnID    string
	eventType string
	id        string
}

func questionBatchFromEvent(event servicechat.Event) questionBatch {
	id := event.InteractionID
	if id == "" {
		id = event.ID
	}
	if id == "" {
		id = strconv.FormatInt(event.Seq, 10)
	}
	return questionBatch{turnID: event.TurnID, eventType: event.Type, id: id}
}

// ChatEvent decides whether an appended event deserves a notification and, if
// so, who receives it. It never blocks the caller on network I/O.
func (n *chatPushNotifier) ChatEvent(chatID servicechat.ID, event servicechat.Event) {
	if n == nil || !n.push.Enabled() {
		return
	}
	n.trackUserPrompt(chatID, event)
	kind, urgent, ok := notificationKind(event)
	if !n.trackParkedRun(chatID, event) {
		return
	}
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), audienceTimeout)
	defer cancel()

	meta, err := n.chats.Get(ctx, chatID)
	if err != nil {
		log.Printf("push: resolve chat %s: %v", chatID, err)
		return
	}
	recipients, err := n.audience.recipients(ctx, meta)
	if err != nil {
		log.Printf("push: resolve audience for chat %s: %v", chatID, err)
		return
	}
	// Someone with this chat on screen is already watching the thing the
	// notification would announce. Dropping them here silences every device
	// they own, which the service worker cannot do: it only sees the tabs of
	// the browser it runs in, so their other phone would buzz regardless.
	recipients = n.presence.Filter(recipients, string(chatID))
	if len(recipients) == 0 {
		return
	}
	batch := questionBatchFromEvent(event)
	claim, ok := n.claimUnreadSlot(chatID, meta.LastReadAt, kind == servicepush.KindQuestion, batch)
	if !ok {
		return
	}

	projectName := "Remote"
	if meta.ProjectID != "" && n.projects != nil {
		if project, err := n.projects.Get(ctx, serviceproject.ID(meta.ProjectID)); err == nil {
			projectName = project.Name
		}
	}
	title, body := notificationText(kind, projectName, event)
	n.push.NotifyAsync(recipients, servicepush.Notification{
		Kind:   kind,
		ChatID: string(chatID),
		Title:  title,
		Body:   body,
		// One tag per chat: a later notification replaces the chat's earlier
		// tray entry instead of stacking behind it.
		Tag:    "chat:" + string(chatID),
		Urgent: urgent,
	}, func(delivered int) {
		if delivered == 0 {
			n.releaseUnreadSlot(chatID, claim, batch)
		}
	})
}

// claimUnreadSlot reports whether the chat may notify again and, if so,
// records the read marker the notification is about to go out against. A
// distinct question batch bypasses unread suppression: an older "finished"
// notification must not hide a fresh request. Duplicate batches stay quiet.
//
// The slot is claimed before delivery so two events racing through here
// cannot both send; releaseUnreadSlot hands it back if nothing arrived.
func (n *chatPushNotifier) claimUnreadSlot(
	chatID servicechat.ID,
	lastReadAt int64,
	isQuestion bool,
	batch questionBatch,
) (uint64, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.notified == nil {
		n.notified = map[servicechat.ID]unreadNotice{}
	}
	if isQuestion {
		if n.questionBatches == nil {
			n.questionBatches = map[servicechat.ID]map[questionBatch]uint64{}
		}
		if n.questionBatches[chatID] == nil {
			n.questionBatches[chatID] = map[questionBatch]uint64{}
		}
		if _, sent := n.questionBatches[chatID][batch]; sent {
			return 0, false
		}
	}
	if notice, pending := n.notified[chatID]; pending && lastReadAt <= notice.readAt && !isQuestion {
		return 0, false
	}
	n.claims++
	n.notified[chatID] = unreadNotice{readAt: lastReadAt, claim: n.claims}
	if isQuestion {
		n.questionBatches[chatID][batch] = n.claims
	}
	return n.claims, true
}

// releaseUnreadSlot forgets a claim whose notification reached no device, so
// the chat is not kept quiet about something the user never saw. A newer
// claim for the same chat is left alone.
func (n *chatPushNotifier) releaseUnreadSlot(chatID servicechat.ID, claim uint64, batch questionBatch) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if notice, ok := n.notified[chatID]; ok && notice.claim == claim {
		delete(n.notified, chatID)
	}
	if n.questionBatches[chatID][batch] == claim {
		delete(n.questionBatches[chatID], batch)
	}
}

// ChatDeleted drops everything held for a chat that no longer exists.
func (n *chatPushNotifier) ChatDeleted(chatID servicechat.ID) {
	if n == nil {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.parked, chatID)
	delete(n.questionBatches, chatID)
	delete(n.notified, chatID)
}

// trackUserPrompt treats a prompt the user typed as having seen the chat, so
// the run it starts may notify again. An application or legacy scheduled prompt
// does not indicate that the user has seen the chat and leaves it unread.
func (n *chatPushNotifier) trackUserPrompt(chatID servicechat.ID, event servicechat.Event) {
	if event.Type != "user" || strings.TrimSpace(event.ScheduledTaskID) != "" || event.ApplicationID != "" {
		return
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.notified, chatID)
}

// trackParkedRun maintains the "waiting on an answer" flag and reports whether
// the event should still be allowed to notify. Legacy questions survive
// completion until answered; native questions clear on matching resolutions.
func (n *chatPushNotifier) trackParkedRun(
	chatID servicechat.ID,
	event servicechat.Event,
) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.parked == nil {
		n.parked = map[servicechat.ID]servicechat.QuestionState{}
	}
	state := n.parked[chatID]
	if state.AnsweredBy(event) {
		// Structured answers resume the same run rather than appending a user
		// prompt. They still acknowledge the question notification.
		delete(n.notified, chatID)
	}
	if event.Type == "user" {
		delete(n.questionBatches, chatID)
	}
	if (event.Type == "complete" || event.Type == "error") && state.AwaitingAnswer(true) &&
		(event.TurnID == "" || state.TurnID == "" || event.TurnID == state.TurnID) {
		if event.Type == "error" && event.Status == "retrying" {
			// Recovery keeps the question actionable and must not replace its alert.
			return false
		}
		if event.Type == "complete" && state.LegacyPending {
			n.parked[chatID], _ = state.Apply(event)
		} else {
			delete(n.parked, chatID)
		}
		return false
	}
	next, _ := state.Apply(event)
	if next.AwaitingAnswer(true) {
		n.parked[chatID] = next
	} else {
		delete(n.parked, chatID)
	}
	return true
}

// notificationKind maps a chat event onto a notification, or reports that the
// event is not worth interrupting anyone for. Streaming deltas, tool traffic,
// and session bookkeeping all fall through.
func notificationKind(event servicechat.Event) (kind servicepush.Kind, urgent, ok bool) {
	if servicechat.IsQuestionRequest(event) {
		return servicepush.KindQuestion, true, true
	}
	application := event.ApplicationID != ""
	legacyScheduled := strings.TrimSpace(event.ScheduledTaskID) != ""
	switch event.Type {
	case "complete":
		if application {
			return servicepush.KindApplication, false, true
		}
		if legacyScheduled {
			return servicepush.KindScheduled, false, true
		}
		return servicepush.KindComplete, false, true
	case "error":
		if application {
			return servicepush.KindApplication, false, true
		}
		if legacyScheduled {
			return servicepush.KindScheduled, false, true
		}
		return servicepush.KindError, false, true
	default:
		return "", false, false
	}
}
