package chat

import "testing"

func TestMetadataPageCursorIsStableForTiedTimestampsAndDeletion(t *testing.T) {
	metas := []Meta{{ID: "cccc", LastMessageAt: 4}, {ID: "bbbb", LastMessageAt: 4}, {ID: "aaaa", LastMessageAt: 4}, {ID: "dddd", LastMessageAt: 3}}
	first := SelectChatPage(metas, ChatPageQuery{Limit: 2})
	if len(first.Chats) != 2 || first.Chats[0].ID != "aaaa" || first.Chats[1].ID != "bbbb" || !first.HasMore || !ValidChatCursor(first.NextBefore) {
		t.Fatalf("first=%+v", first)
	}
	next := SelectChatPage([]Meta{metas[0], metas[2], metas[3]}, ChatPageQuery{Limit: 2, Before: first.NextBefore})
	if len(next.Chats) != 2 || next.Chats[0].ID != "cccc" || next.Chats[1].ID != "dddd" || next.HasMore {
		t.Fatalf("next=%+v", next)
	}
	if ValidChatCursor("invalid") {
		t.Fatal("invalid cursor accepted")
	}
}
