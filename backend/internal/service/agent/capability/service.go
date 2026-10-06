// Package capability aggregates the provider-specific capability catalogs
// exposed by the registered agent CLIs.
//
// Capability discovery may start expensive CLI probes. Requests for the same
// provider and execution environment share one flight and cache entry. Healthy
// and degraded providers expire independently. Progressive callers see stale
// results during refresh and poll for new completions; legacy callers wait.
// A backend restart clears every entry.
package capability

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/agent"
	agentmodule "github.com/futrx-com/remote.futrx.com/internal/service/agent/module"
	serviceauth "github.com/futrx-com/remote.futrx.com/internal/service/auth"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
)

var (
	ErrProjectLookupUnavailable = errors.New("project lookup unavailable")
	ErrProjectNotFound          = errors.New("project not found")
	ErrAuthenticationRequired   = errors.New("authentication required")
	ErrProjectAccessDenied      = errors.New("project access denied")
)

type ProjectCatalog interface {
	Get(ctx context.Context, id serviceproject.ID) (serviceproject.Meta, error)
	HasAccess(ctx context.Context, id serviceproject.ID, email string) (bool, error)
}

type Authorizer interface {
	CurrentSession(ctx context.Context, cookieValue string) (*serviceauth.Session, error)
	IsAdmin(ctx context.Context, email string) (bool, error)
}

type CapabilityRegistry interface {
	CapabilityProviders() []agent.CapabilityProvider
}

type ScopePolicy interface {
	SupportsScope(provider string, scope agentmodule.ExecutionScope) bool
}

type DescriptorPolicy interface {
	Descriptor(provider string) (agentmodule.Descriptor, bool)
}

type ListQuery struct {
	ProjectID     serviceproject.ID
	SessionCookie string
	Refresh       bool
	// Progressive returns immediately; clients poll while providers refresh.
	Progressive bool
}

type Service struct {
	agents            CapabilityRegistry
	projects          ProjectCatalog
	auth              Authorizer
	capabilityTimeout time.Duration
	scopes            ScopePolicy
	descriptors       DescriptorPolicy
	cache             *catalogCache
	probeSlots        chan struct{}
}

// Settings are cross-provider discovery policies supplied by the application
// composition root. Provider-specific probe behavior remains in each adapter.
type Settings struct {
	CapabilityTimeout          time.Duration
	CapabilityCacheTTL         time.Duration
	DegradedCapabilityCacheTTL time.Duration
}

func WithScopePolicy(policy ScopePolicy) Option {
	return func(catalog *Service) {
		catalog.scopes = policy
	}
}

type ModulePolicy interface {
	ScopePolicy
	DescriptorPolicy
}

// WithModulePolicy applies the same validated module declarations to scope
// filtering and public capability metadata.
func WithModulePolicy(policy ModulePolicy) Option {
	return func(target *Service) {
		target.scopes = policy
		target.descriptors = policy
	}
}

type Option func(*Service)

func New(
	agents CapabilityRegistry,
	projects ProjectCatalog,
	auth Authorizer,
	settings Settings,
	options ...Option,
) *Service {
	catalog := &Service{
		agents:            agents,
		projects:          projects,
		auth:              auth,
		capabilityTimeout: settings.CapabilityTimeout,
		cache: newCatalogCache(
			settings.CapabilityCacheTTL,
			settings.DegradedCapabilityCacheTTL,
		),
		probeSlots: make(chan struct{}, 8),
	}
	for _, option := range options {
		if option != nil {
			option(catalog)
		}
	}
	return catalog
}

func (c *Service) List(ctx context.Context, query ListQuery) ([]agent.Capabilities, error) {
	containerName := ""
	flightKey := "host"
	scope := agentmodule.ScopeHost
	if query.ProjectID != "" {
		if c.projects == nil {
			return nil, ErrProjectLookupUnavailable
		}
		project, err := c.projects.Get(ctx, query.ProjectID)
		if err != nil {
			if errors.Is(err, serviceproject.ErrNotFound) {
				return nil, ErrProjectNotFound
			}
			return nil, err
		}
		if err := c.authorize(ctx, project.ID, query.SessionCookie); err != nil {
			return nil, err
		}
		containerName = project.ContainerName
		flightKey = "project:" + string(project.ID) + ":" + containerName
		scope = agentmodule.ScopeProject
	}

	providers := c.capabilityProviders(scope)
	// Repeated refreshes join the scope's active discovery, even when a
	// faster sibling has already finished.
	force := query.Refresh && !c.cache.refreshingScope(flightKey+":provider:")
	entries := make([]*catalogCacheEntry, len(providers))
	for i, provider := range providers {
		key := flightKey + ":provider:" + string(provider.ID())
		entries[i] = c.cache.start(key, force, func() agent.Capabilities {
			probeCtx := context.WithoutCancel(ctx)
			timeout := c.capabilityTimeout
			if timeout <= 0 {
				timeout = 30 * time.Second
			}
			probeCtx, cancel := context.WithTimeout(probeCtx, timeout)
			defer cancel()
			started := time.Now()
			var caps agent.Capabilities
			var err error
			select {
			case c.probeSlots <- struct{}{}:
				caps, err = provider.Capabilities(probeCtx, agent.CapabilityRequest{ContainerName: containerName})
				<-c.probeSlots
			case <-probeCtx.Done():
				err = probeCtx.Err()
			}
			caps.Provider = provider.ID()
			c.decorate(&caps)
			if caps.Source == "" {
				caps.Source = agent.CapabilitySourceFallback
			}
			if err != nil && caps.Warning == "" {
				caps.Warning = "Provider capabilities are temporarily unavailable"
			}
			if caps.Models == nil {
				caps.Models = []agent.ModelCapability{}
			}
			if caps.Modes == nil {
				caps.Modes = []agent.CapabilityOption{}
			}
			log.Printf("capability probe provider=%s scope=%s duration=%s source=%s failed=%t", provider.ID(), scope, time.Since(started), caps.Source, err != nil)
			return caps
		})
	}
	result := make([]agent.Capabilities, len(providers))
	for i, entry := range entries {
		if !query.Progressive {
			if err := c.cache.wait(ctx, entry); err != nil {
				return nil, err
			}
		}
		caps, refreshing := c.cache.snapshot(entry)
		if caps.Provider == "" {
			caps = agent.Capabilities{Provider: providers[i].ID(), Source: agent.CapabilitySourceFallback, Models: agent.WithAutoModel(nil, "Provider default"), Modes: []agent.CapabilityOption{}}
			c.decorate(&caps)
		}
		caps.Refreshing = refreshing
		result[i] = caps
	}
	return result, nil
}

func (c *Service) decorate(capabilities *agent.Capabilities) {
	if capabilities == nil || c.descriptors == nil {
		return
	}
	descriptor, ok := c.descriptors.Descriptor(string(capabilities.Provider))
	if !ok {
		return
	}
	capabilities.Label = descriptor.Label
	capabilities.Default = descriptor.Default
	capabilities.ExecutionScopes = make([]string, len(descriptor.ExecutionScopes))
	for index, scope := range descriptor.ExecutionScopes {
		capabilities.ExecutionScopes[index] = string(scope)
	}
	var apiKey *agent.CapabilityAPIKeyAuthentication
	if descriptor.APIKeyAuth != nil {
		apiKey = &agent.CapabilityAPIKeyAuthentication{
			CreateURL:       descriptor.APIKeyAuth.CreateURL,
			CreateLabel:     descriptor.APIKeyAuth.CreateLabel,
			CredentialLabel: descriptor.APIKeyAuth.CredentialLabel,
		}
	}
	capabilities.Authentication = agent.CapabilityAuthentication{
		Mode:                string(descriptor.Auth),
		Instructions:        descriptor.AuthInstructions,
		SatisfiesAccessGate: descriptor.SatisfiesAccessGate,
		APIKey:              apiKey,
	}
	capabilities.Features = agent.CapabilityFeatures{
		Sessions: agent.CapabilitySessionSupport{
			Resume: descriptor.Features.Sessions.Resume,
			Fork:   descriptor.Features.Sessions.Fork,
		},
		Skills:                string(descriptor.Features.Skills),
		BrowserTools:          descriptor.Features.BrowserTools,
		ScheduledTools:        descriptor.Features.ScheduledTools,
		ExecutionPolicies:     descriptor.Features.ExecutionPolicies,
		StreamingPresentation: string(descriptor.Features.StreamingPresentation),
	}
	if capabilities.Features.StreamingPresentation == "" {
		capabilities.Features.StreamingPresentation = string(agentmodule.StreamingTokens)
	}
}

func (c *Service) capabilityProviders(scope agentmodule.ExecutionScope) []agent.CapabilityProvider {
	providers := c.agents.CapabilityProviders()
	if c.scopes == nil {
		return providers
	}
	filtered := make([]agent.CapabilityProvider, 0, len(providers))
	for _, provider := range providers {
		if c.scopes.SupportsScope(string(provider.ID()), scope) {
			filtered = append(filtered, provider)
		}
	}
	return filtered
}

func (c *Service) authorize(ctx context.Context, projectID serviceproject.ID, cookie string) error {
	if c.auth == nil {
		return nil
	}
	session, err := c.auth.CurrentSession(ctx, cookie)
	if err != nil || session == nil {
		return ErrAuthenticationRequired
	}
	email := strings.ToLower(strings.TrimSpace(session.Email))
	if email == "" {
		return ErrAuthenticationRequired
	}
	isAdmin, _ := c.auth.IsAdmin(ctx, email)
	if isAdmin {
		return nil
	}
	hasAccess, err := c.projects.HasAccess(ctx, projectID, email)
	if err != nil {
		return err
	}
	if !hasAccess {
		return ErrProjectAccessDenied
	}
	return nil
}
