package githubreleases

import (
	"context"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGitHubRepository(t *testing.T) {
	for _, origin := range []string{
		"https://github.com/team/fork.git", "git@github.com:team/fork.git",
		"ssh://git@github.com/team/fork.git", "https://user:credential@github.com/team/fork/",
	} {
		got, err := githubRepository(origin)
		if err != nil || got != "team/fork" {
			t.Errorf("repository = %q, error = %v", got, err)
		}
	}
	for _, origin := range []string{
		"/tmp/repo", "https://gitlab.com/team/fork", "https://github.com.evil.test/team/fork",
		"https://github.com/team/fork/extra", "https://github.com/../fork", "https://github.com/team/%2e%2e",
	} {
		if got, err := githubRepository(origin); err == nil {
			t.Errorf("unsupported origin was accepted as %q", got)
		}
	}
}

func TestReadReleaseNotesUsesExactTagAndOriginWithoutCredentials(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "--quiet"}, {"remote", "add", "origin", "https://user:credential@github.com/team/fork.git"},
	} {
		if output, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git: %v: %s", err, output)
		}
	}
	client := New()
	client.http.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if got, want := req.URL.String(), "https://api.github.com/repos/team/fork/releases/tags/v0.25.1"; got != want {
			t.Errorf("endpoint = %q, want %q", got, want)
		}
		if req.Header.Get("Authorization") != "" || req.URL.User != nil {
			t.Error("git credentials were forwarded to the API")
		}
		if req.Header.Get("Accept") != "application/vnd.github+json" || req.Header.Get("X-GitHub-Api-Version") == "" {
			t.Error("missing GitHub API headers")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"tag_name":"v0.25.1","name":"Fixes","body":"## Changes\n- A fix","html_url":"javascript:alert(1)","published_at":"2026-10-06T00:00:00Z"}`))}, nil
	})
	notes, err := client.ReadReleaseNotes(context.Background(), dir, "v0.25.1")
	if err != nil {
		t.Fatal(err)
	}
	if notes.Tag != "v0.25.1" || notes.Title != "Fixes" || notes.Body != "## Changes\n- A fix" || notes.PublishedAt == "" {
		t.Fatalf("notes = %+v", notes)
	}
	if notes.URL != "https://github.com/team/fork/releases/tag/v0.25.1" {
		t.Fatalf("release URL = %q", notes.URL)
	}
}

func TestFetchReleaseNotesResponses(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		wantErr bool
	}{
		{"unpublished", 404, "", false},
		{"empty notes", 200, `{"tag_name":"0.25.1","body":null}`, false},
		{"rate limit", 403, "", true},
		{"outage", 503, "", true},
		{"invalid JSON", 200, "<html>", true},
		{"wrong release", 200, `{"tag_name":"0.26.0","body":"different release"}`, true},
		{"draft", 200, `{"tag_name":"0.25.1","draft":true}`, true},
		{"oversized", 200, strings.Repeat(" ", maxResponseBytes+1), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := New()
			client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			notes, err := client.fetch(context.Background(), "team/fork", "0.25.1")
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, want error = %v", err, tc.wantErr)
			}
			if !tc.wantErr && (notes.Body != "" || notes.Tag != "0.25.1" || notes.URL == "") {
				t.Fatalf("empty release = %+v", notes)
			}
		})
	}
}
