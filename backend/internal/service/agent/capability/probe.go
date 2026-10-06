package capability

import (
	"context"
	"log"
	"time"

	"github.com/futrx-com/remote.futrx.com/internal/agent"
	configconstants "github.com/futrx-com/remote.futrx.com/internal/config/constants"
	agentmodule "github.com/futrx-com/remote.futrx.com/internal/service/agent/module"
)

// probe owns the bounded provider execution and normalization. Its deadline
// includes the wait for a slot and outlives the initiating HTTP request.
func (c *Service) probe(ctx context.Context, provider agent.CapabilityProvider, containerName string, scope agentmodule.ExecutionScope) agent.Capabilities {
	probeCtx := context.WithoutCancel(ctx)
	timeout := c.capabilityTimeout
	if timeout <= 0 {
		timeout = configconstants.DefaultCapabilityProbeTimeout
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
}
