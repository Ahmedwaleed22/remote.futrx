package chat

import (
	"encoding/base64"
	configconstants "github.com/futrx-com/remote.futrx.com/internal/config/constants"
	"sort"
	"strconv"
	"strings"
)

func ValidChatCursor(cursor string) bool {
	if cursor == "" {
		return true
	}
	_, _, ok := parseChatCursor(cursor)
	return ok
}
func parseChatCursor(cursor string) (int64, ID, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, "", false
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 || !ValidID(ID(parts[1])) {
		return 0, "", false
	}
	timestamp, err := strconv.ParseInt(parts[0], 10, 64)
	return timestamp, ID(parts[1]), err == nil && timestamp >= 0
}
func SelectChatPage(metas []Meta, query ChatPageQuery) ChatPage {
	limit := query.Limit
	if limit <= 0 || limit > configconstants.ChatMetadataPageLimit {
		limit = configconstants.ChatMetadataPageLimit
	}
	page := ChatPage{Chats: []Meta{}, Total: len(metas)}
	beforeT, beforeID, _ := parseChatCursor(query.Before)
	tokens := strings.Fields(strings.ToLower(query.Search))
	selected := make([]Meta, 0)
	for _, meta := range metas {
		if query.Before != "" && (meta.LastMessageAt > beforeT || (meta.LastMessageAt == beforeT && meta.ID <= beforeID)) {
			continue
		}
		searchable := strings.ToLower(meta.Title + " " + meta.Cwd + " " + meta.TmuxSession + " " + string(meta.Provider))
		match := true
		for _, token := range tokens {
			if !strings.Contains(searchable, token) {
				match = false
				break
			}
		}
		if match {
			selected = append(selected, meta)
		}
	}
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].LastMessageAt == selected[j].LastMessageAt {
			return selected[i].ID < selected[j].ID
		}
		return selected[i].LastMessageAt > selected[j].LastMessageAt
	})
	page.HasMore = len(selected) > limit
	if len(selected) > limit {
		selected = selected[:limit]
	}
	page.Chats = selected
	if page.HasMore {
		last := selected[len(selected)-1]
		page.NextBefore = base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(last.LastMessageAt, 10) + ":" + string(last.ID)))
	}
	return page
}
