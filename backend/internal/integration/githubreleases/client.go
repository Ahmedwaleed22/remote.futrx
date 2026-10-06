// Package githubreleases reads published release notes from the installation's
// GitHub origin. It never forwards git credentials to the public GitHub API.
package githubreleases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/service/selfupdate"
)

const requestTimeout = 10 * time.Second
const maxResponseBytes = 1024 * 1024

var repositoryPart = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

type Client struct {
	http *http.Client
}

func New() *Client { return &Client{http: &http.Client{Timeout: requestTimeout}} }

func (c *Client) ReadReleaseNotes(ctx context.Context, installDir, tag string) (selfupdate.ReleaseNotes, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	origin, err := exec.CommandContext(ctx, "git", "-C", installDir, "remote", "get-url", "origin").Output()
	if err != nil {
		return selfupdate.ReleaseNotes{}, errors.New("could not determine the release notes repository")
	}
	repository, err := githubRepository(strings.TrimSpace(string(origin)))
	if err != nil {
		return selfupdate.ReleaseNotes{}, err
	}
	return c.fetch(ctx, repository, tag)
}

func (c *Client) fetch(ctx context.Context, repository, tag string) (selfupdate.ReleaseNotes, error) {
	notes := selfupdate.ReleaseNotes{
		Tag: tag,
		URL: "https://github.com/" + repository + "/releases/tag/" + url.PathEscape(tag),
	}
	endpoint := "https://api.github.com/repos/" + repository + "/releases/tags/" + url.PathEscape(tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return notes, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("User-Agent", "remote.futrx")
	resp, err := c.http.Do(req)
	if err != nil {
		return notes, errors.New("could not reach GitHub for release notes")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return notes, nil
	}
	if resp.StatusCode != http.StatusOK {
		return notes, fmt.Errorf("release notes request failed (HTTP %d)", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return notes, errors.New("could not read release notes")
	}
	var release struct {
		Tag         string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
	}
	if err := json.Unmarshal(body, &release); err != nil {
		return notes, errors.New("invalid release notes response")
	}
	if release.Draft || release.Tag != tag {
		return notes, errors.New("release notes did not match the requested release")
	}
	notes.Title = release.Name
	notes.Body = strings.TrimSpace(release.Body)
	notes.PublishedAt = release.PublishedAt
	return notes, nil
}

func githubRepository(origin string) (string, error) {
	path := ""
	if strings.HasPrefix(origin, "git@github.com:") {
		path = strings.TrimPrefix(origin, "git@github.com:")
	} else if parsed, err := url.Parse(origin); err == nil && strings.EqualFold(parsed.Hostname(), "github.com") {
		path = strings.TrimPrefix(parsed.Path, "/")
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimSuffix(path, "/"), ".git"), "/")
	if len(parts) != 2 {
		return "", errors.New("release notes are only available for GitHub repositories")
	}
	for _, part := range parts {
		if !repositoryPart.MatchString(part) || part == "." || part == ".." {
			return "", errors.New("invalid release notes repository")
		}
	}
	return strings.Join(parts, "/"), nil
}
