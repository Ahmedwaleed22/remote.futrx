package capability

import (
	"context"
	"github.com/futrx-com/remote.futrx.com/internal/agent"
	serviceproject "github.com/futrx-com/remote.futrx.com/internal/service/project"
	"sync/atomic"
	"testing"
	"time"
)

func TestProgressiveCatalogDoesNotWaitForSlowProvider(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	slow := &catalogTestProvider{id: "slow", release: release, entered: entered}
	fast := &catalogTestProvider{id: "fast"}
	svc := New(catalogTestRegistry{[]agent.CapabilityProvider{fast, slow}}, nil, nil, testSettings())
	first, err := svc.List(context.Background(), ListQuery{Progressive: true})
	if err != nil || len(first) != 2 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	<-entered
	defer close(release)
	deadline := time.Now().Add(time.Second)
	for {
		page, err := svc.List(context.Background(), ListQuery{Progressive: true})
		if err != nil {
			t.Fatal(err)
		}
		if page[0].Source == agent.CapabilitySourceLive {
			if !page[1].Refreshing {
				t.Fatal("slow provider should still refresh")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fast provider blocked on slow provider")
		}
		time.Sleep(time.Millisecond)
	}
	slow.mu.Lock()
	calls := slow.calls
	slow.mu.Unlock()
	if calls != 1 {
		t.Fatalf("slow probes=%d", calls)
	}
}
func TestProgressiveRefreshRetainsHealthyResultOnTransientFailure(t *testing.T) {
	cache := newCatalogCache(time.Hour, time.Minute)
	healthy := cache.start("host:provider", false, func() agent.Capabilities {
		return agent.Capabilities{Source: agent.CapabilitySourceLive, Models: []agent.ModelCapability{{ID: "kept"}}}
	})
	if err := cache.wait(context.Background(), healthy); err != nil {
		t.Fatal(err)
	}
	failed := cache.start("host:provider", true, func() agent.Capabilities {
		return agent.Capabilities{Source: agent.CapabilitySourceFallback, Warning: "temporarily unavailable"}
	})
	if err := cache.wait(context.Background(), failed); err != nil {
		t.Fatal(err)
	}
	result, refreshing := cache.snapshot(failed)
	if refreshing || len(result.Models) != 1 || result.Models[0].ID != "kept" || result.Warning == "" {
		t.Fatalf("result=%+v refreshing=%v", result, refreshing)
	}
	unavailable := cache.start("host:provider", true, func() agent.Capabilities {
		return agent.Capabilities{Source: agent.CapabilitySourceFallback, UnavailableReason: "sign in required"}
	})
	_ = cache.wait(context.Background(), unavailable)
	result, _ = cache.snapshot(unavailable)
	if len(result.Models) != 0 || result.UnavailableReason == "" {
		t.Fatal("explicit auth loss must discard old catalog")
	}
}

type boundedProvider struct {
	active, peak atomic.Int64
	release      chan struct{}
}

func (p *boundedProvider) ID() agent.ProviderID { return "bounded" }
func (p *boundedProvider) Capabilities(ctx context.Context, _ agent.CapabilityRequest) (agent.Capabilities, error) {
	active := p.active.Add(1)
	defer p.active.Add(-1)
	for {
		old := p.peak.Load()
		if active <= old || p.peak.CompareAndSwap(old, active) {
			break
		}
	}
	select {
	case <-p.release:
	case <-ctx.Done():
		return agent.Capabilities{}, ctx.Err()
	}
	return agent.Capabilities{Source: agent.CapabilitySourceLive}, nil
}

type loadProjects struct{}

func (loadProjects) Get(_ context.Context, id serviceproject.ID) (serviceproject.Meta, error) {
	return serviceproject.Meta{ID: id, ContainerName: "container-" + string(id)}, nil
}
func (loadProjects) HasAccess(context.Context, serviceproject.ID, string) (bool, error) {
	return true, nil
}
func TestProviderConcurrencyIsBoundedAcrossProjectScopes(t *testing.T) {
	provider := &boundedProvider{release: make(chan struct{})}
	svc := New(catalogTestRegistry{[]agent.CapabilityProvider{provider}}, loadProjects{}, nil, testSettings())
	ids := []serviceproject.ID{"aaaa", "aaab", "aaac", "aaad", "aaae", "aaaf", "aaba", "aabb", "aabc", "aabd", "aabe", "aabf"}
	for _, id := range ids {
		if _, err := svc.List(context.Background(), ListQuery{ProjectID: id, Progressive: true}); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(time.Second)
	for provider.peak.Load() < 8 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(provider.release)
	for _, id := range ids {
		if _, err := svc.List(context.Background(), ListQuery{ProjectID: id}); err != nil {
			t.Fatal(err)
		}
	}
	if provider.peak.Load() != 8 {
		t.Fatalf("peak probes=%d want=8", provider.peak.Load())
	}
}
