// Synthetic load tests exercise real capability orchestration and HTTP
// serialization with deterministic providers, without touching user data.
package performance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/agent"
	capability "github.com/futrx-com/remote.futrx.com/internal/service/agent/capability"
	handlers "github.com/futrx-com/remote.futrx.com/internal/transport/http/handlers"
)

type loadProvider struct {
	id    agent.ProviderID
	delay time.Duration
	calls atomic.Int64
}

func (p *loadProvider) ID() agent.ProviderID { return p.id }
func (p *loadProvider) Capabilities(ctx context.Context, _ agent.CapabilityRequest) (agent.Capabilities, error) {
	p.calls.Add(1)
	select {
	case <-time.After(p.delay):
	case <-ctx.Done():
		return agent.Capabilities{}, ctx.Err()
	}
	return agent.Capabilities{Provider: p.id, Source: agent.CapabilitySourceLive, Models: []agent.ModelCapability{{ID: "load-model", Label: "Load Model"}}}, nil
}

type loadRegistry []agent.CapabilityProvider

func (r loadRegistry) CapabilityProviders() []agent.CapabilityProvider { return r }
func TestCapabilityHTTPLoad(t *testing.T) {
	if os.Getenv("REMOTE_LOAD_TEST") != "1" {
		t.Skip("set REMOTE_LOAD_TEST=1 for the synthetic HTTP load test")
	}
	fast := &loadProvider{id: "fast", delay: time.Millisecond}
	slow := &loadProvider{id: "slow", delay: 200 * time.Millisecond}
	svc := capability.New(loadRegistry{fast, slow}, nil, nil, capability.Settings{CapabilityTimeout: time.Second, CapabilityCacheTTL: time.Hour, DegradedCapabilityCacheTTL: time.Minute})
	server := httptest.NewServer(http.HandlerFunc(handlers.NewAgentCapabilitiesHandler(svc).HandleCollection))
	defer server.Close()
	client := server.Client()
	client.Timeout = 5 * time.Second
	for _, phase := range []string{"cold", "warm", "refresh"} {
		if phase == "warm" {
			time.Sleep(250 * time.Millisecond)
		}
		var wg sync.WaitGroup
		start := make(chan struct{})
		latencies := make([]float64, 64)
		var failures atomic.Int64
		for i := range latencies {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				url := server.URL + "/api/agent-capabilities?progressive=1"
				if phase == "refresh" {
					url += "&refresh=1"
				}
				begin := time.Now()
				response, err := client.Get(url)
				if err != nil {
					failures.Add(1)
					return
				}
				_, err = io.Copy(io.Discard, response.Body)
				response.Body.Close()
				if err != nil || response.StatusCode != http.StatusOK {
					failures.Add(1)
				}
				latencies[i] = float64(time.Since(begin).Microseconds()) / 1000
			}(i)
		}
		begin := time.Now()
		close(start)
		wg.Wait()
		sort.Float64s(latencies)
		result := map[string]any{"phase": phase, "requests": len(latencies), "concurrency": 64, "failed": failures.Load(), "p50_ms": latencies[31], "p95_ms": latencies[60], "p99_ms": latencies[63], "elapsed_ms": time.Since(begin).Milliseconds(), "fast_probes": fast.calls.Load(), "slow_probes": slow.calls.Load()}
		raw, _ := json.Marshal(result)
		fmt.Println(string(raw))
		if failures.Load() != 0 {
			t.Fatalf("load failures: %d", failures.Load())
		}
	}
	// Let background refresh finish, then assert fan-out was coalesced.
	time.Sleep(250 * time.Millisecond)
	if fast.calls.Load() > 4 || slow.calls.Load() > 4 {
		t.Fatalf("duplicate probes under load: fast=%d slow=%d", fast.calls.Load(), slow.calls.Load())
	}
}
