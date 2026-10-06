package capability

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/agent"
	configconstants "github.com/futrx-com/remote.futrx.com/internal/config/constants"
)

// Cache entries and refresh flights are independent per provider and scope.
// Expired results remain visible while one bounded background probe refreshes.
type catalogCache struct {
	mu                   sync.Mutex
	now                  func() time.Time
	liveTTL, degradedTTL time.Duration
	entries              map[string]*catalogCacheEntry
}
type catalogCacheEntry struct {
	expiresAt, usedAt time.Time
	result            agent.Capabilities
	done              chan struct{}
	refreshing        bool
}

func newCatalogCache(liveTTL, degradedTTL time.Duration) *catalogCache {
	return &catalogCache{now: time.Now, liveTTL: liveTTL, degradedTTL: degradedTTL, entries: make(map[string]*catalogCacheEntry)}
}
func (c *catalogCache) start(key string, force bool, discover func() agent.Capabilities) *catalogCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	entry := c.entries[key]
	if entry != nil {
		entry.usedAt = now
		if entry.refreshing || (!force && now.Before(entry.expiresAt)) {
			return entry
		}
	} else {
		// Bound retained catalogs across projects. Never evict an active flight.
		if len(c.entries) >= configconstants.CapabilityCacheEntryLimit {
			oldestKey := ""
			var oldest time.Time
			for k, candidate := range c.entries {
				if !candidate.refreshing && (oldestKey == "" || candidate.usedAt.Before(oldest)) {
					oldestKey, oldest = k, candidate.usedAt
				}
			}
			if oldestKey != "" {
				delete(c.entries, oldestKey)
			}
		}
		entry = &catalogCacheEntry{usedAt: now}
		c.entries[key] = entry
	}
	entry.refreshing = true
	entry.done = make(chan struct{})
	go func() {
		caps := discover()
		c.mu.Lock()
		defer c.mu.Unlock()
		ttl := c.ttl([]agent.Capabilities{caps})
		// Do not discard a healthy catalog after a transient outage. Explicit
		// authentication unavailability must still replace old entitlements.
		if caps.Source != agent.CapabilitySourceLive && caps.UnavailableReason == "" && entry.result.Source == agent.CapabilitySourceLive {
			warning := caps.Warning
			caps = entry.result.Clone()
			caps.Warning = warning
		}
		entry.result = caps.Clone()
		entry.expiresAt = c.now().Add(ttl)
		entry.refreshing = false
		close(entry.done)
	}()
	return entry
}
func (c *catalogCache) snapshot(entry *catalogCacheEntry) (agent.Capabilities, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return entry.result.Clone(), entry.refreshing
}
func (c *catalogCache) ttl(result []agent.Capabilities) time.Duration {
	for _, caps := range result {
		if caps.Source != agent.CapabilitySourceLive || caps.Warning != "" {
			return c.degradedTTL
		}
	}
	return c.liveTTL
}

func (c *catalogCache) wait(ctx context.Context, entry *catalogCacheEntry) error {
	c.mu.Lock()
	done := entry.done
	c.mu.Unlock()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *catalogCache) refreshingScope(prefix string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key, entry := range c.entries {
		if entry.refreshing && strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}
