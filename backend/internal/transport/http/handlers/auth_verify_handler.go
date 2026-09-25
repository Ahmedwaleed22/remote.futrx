package httphandlers

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	serviceapplications "github.com/futrx-com/remote.futrx.com/internal/service/applications"
	serviceauth "github.com/futrx-com/remote.futrx.com/internal/service/auth"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	httptransport "github.com/futrx-com/remote.futrx.com/internal/transport/http"
)

var projectVerifyHostPattern = regexp.MustCompile(`^([a-z0-9][a-z0-9-]*)--(\d{4,5})\.dev\.(.+)$`)
var codeServerPathPattern = regexp.MustCompile(`^/([a-z0-9][a-z0-9-]*)(?:/|$)`)

type authVerifyHandler struct {
	auth         *serviceauth.Service
	access       *serviceauth.AccessVerifier
	shares       shareAuthorizer
	projects     *serviceproject.Service
	applications *serviceapplications.Service
}

func (h *authVerifyHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/auth/verify", h.verify)
	mux.HandleFunc("/auth/verify-code-server", h.verifyCodeServer)
}

func (h *authVerifyHandler) verify(w http.ResponseWriter, r *http.Request) {
	h.verifyRequest(w, r, false)
}

func (h *authVerifyHandler) verifyCodeServer(w http.ResponseWriter, r *http.Request) {
	h.verifyRequest(w, r, true)
}

func (h *authVerifyHandler) verifyRequest(w http.ResponseWriter, r *http.Request, requireCodeServer bool) {
	host := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Host")))
	matchedSlug, matchedPort := h.matchPreviewHost(host)
	if requireCodeServer {
		matchedSlug = h.codeServerSlug(host, r.Header.Get("X-Forwarded-Uri"))
		if matchedSlug == "" {
			http.Error(w, "invalid Code Server route", http.StatusNotFound)
			return
		}
	}

	// Only the preview host class can be authorized by a public share link.
	// The IDE hosts and the main application never reach this branch, because
	// matchPreviewHost leaves the slug empty for them. It runs before the
	// session check so that a member who opens a share URL themselves also
	// gets the token stripped from it rather than forwarding it into the
	// project's own request logs.
	if !requireCodeServer && matchedSlug != "" && h.authorizeShare(w, r, matchedSlug, matchedPort) {
		return
	}

	err := h.access.Verify(r.Context(), httptransport.SessionCookieValue(r), matchedSlug)
	if err == nil {
		if requireCodeServer {
			available, appErr := h.codeServerAvailable(r.Context(), matchedSlug)
			if appErr != nil {
				http.Error(w, "Code Server availability unavailable", http.StatusInternalServerError)
				return
			}
			if !available {
				http.Error(w, "Code Server is not installed or running", http.StatusNotFound)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	switch {
	case errors.Is(err, serviceauth.ErrAuthenticationRequired):
		h.redirectToLogin(w, r)
	case errors.Is(err, serviceauth.ErrProjectNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, serviceauth.ErrProjectAccessDenied),
		errors.Is(err, serviceauth.ErrAccountNotAuthorized):
		http.Error(w, err.Error(), http.StatusForbidden)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *authVerifyHandler) codeServerSlug(host, forwardedURI string) string {
	base := strings.ToLower(strings.TrimSpace(baseHost(h.auth.BaseURL())))
	if base == "" {
		return ""
	}
	if host == "code."+base {
		if match := codeServerPathPattern.FindStringSubmatch(forwardedURI); match != nil {
			return match[1]
		}
		return ""
	}
	if suffix := ".code." + base; strings.HasSuffix(host, suffix) {
		slug := strings.TrimSuffix(host, suffix)
		if codeServerPathPattern.MatchString("/" + slug + "/") {
			return slug
		}
	}
	return ""
}

func (h *authVerifyHandler) codeServerAvailable(ctx context.Context, slug string) (bool, error) {
	if h.projects == nil || h.applications == nil {
		return false, nil
	}
	project, err := h.projects.GetBySlug(ctx, slug)
	if err != nil {
		return false, nil
	}
	installed, err := h.applications.ListProject(ctx, string(project.ID))
	if err != nil {
		return false, err
	}
	for _, app := range installed {
		if app.ApplicationID == "code-server" && app.Status == serviceapplications.StatusRunning {
			return true, nil
		}
	}
	return false, nil
}

// matchPreviewHost resolves a forwarded host to the project slug and port
// behind a <slug>--<port>.dev.<base> preview URL. Anything else yields an
// empty slug, which keeps the caller on the session-only path.
func (h *authVerifyHandler) matchPreviewHost(host string) (string, int) {
	match := projectVerifyHostPattern.FindStringSubmatch(host)
	if match == nil {
		return "", 0
	}
	base := strings.ToLower(strings.TrimSpace(baseHost(h.auth.BaseURL())))
	if base == "" || match[3] != base {
		return "", 0
	}
	port, err := strconv.Atoi(match[2])
	if err != nil {
		return match[1], 0
	}
	return match[1], port
}

func (h *authVerifyHandler) redirectToLogin(w http.ResponseWriter, r *http.Request) {
	base := h.auth.BaseURL()
	if base == "" {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	loginURL := base + "/"
	if returnTo := reconstructOriginalURL(r); returnTo != "" && isSafeReturnTo(returnTo, base) {
		loginURL += "?return_to=" + url.QueryEscape(returnTo)
	}
	http.Redirect(w, r, loginURL, http.StatusFound)
}
