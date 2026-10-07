package httphandlers

import (
	"io"
	"net/http"
	"strings"

	"github.com/futrx-com/remote.futrx.com/internal/service/scheduledmessages"
	httptransport "github.com/futrx-com/remote.futrx.com/internal/transport/http"
	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

type ScheduleHandler struct{ messages *scheduledmessages.Service }

func NewScheduleHandler(messages *scheduledmessages.Service) *ScheduleHandler {
	return &ScheduleHandler{messages: messages}
}
func (h *ScheduleHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/agent-api/schedules", h.handle)
	mux.HandleFunc("/agent-api/schedules/", h.handle)
}
func (h *ScheduleHandler) handle(w http.ResponseWriter, r *http.Request) {
	if h.messages == nil {
		httptransport.SendErr(w, 503, "scheduled messages unavailable")
		return
	}
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || scheme != "Bearer" {
		httptransport.SendErr(w, 401, "capability required")
		return
	}
	grant, err := h.messages.Resolve(token)
	if err != nil {
		httptransport.SendErr(w, 401, "invalid or expired capability")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		httptransport.SendErr(w, 400, "body exceeds 64 KiB")
		return
	}
	response, err := h.messages.CallAgent(r.Context(), grant, applications.Request{Method: r.Method, Path: strings.TrimPrefix(r.URL.Path, "/agent-api/schedules"), Body: body})
	if err != nil {
		httptransport.SendErr(w, 503, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.Status)
	_, _ = w.Write(response.Body)
}
