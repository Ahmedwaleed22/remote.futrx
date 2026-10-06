package capability

import "github.com/futrx-com/remote.futrx.com/internal/agent"

func cloneCapabilities(input []agent.Capabilities) []agent.Capabilities {
	output := make([]agent.Capabilities, len(input))
	for index, caps := range input {
		output[index] = caps.Clone()
	}
	return output
}
