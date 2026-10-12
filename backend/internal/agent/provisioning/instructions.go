package provisioning

import (
	_ "embed"
	"strings"
)

const publicHostnamePlaceholder = "{{PUBLIC_HOSTNAME}}"

//go:embed assets/AGENTS.md
var instructionsTemplate []byte

// NotificationInstructions shares the template's notification contract with
// providers and execution scopes that do not load a provisioned AGENTS.md.
func NotificationInstructions() string {
	const heading = "## Completion notification\n\n"
	_, content, _ := strings.Cut(string(instructionsTemplate), heading)
	paragraph, _, _ := strings.Cut(content, "\n\n")
	return heading + paragraph
}

func InstructionsTemplate(publicHostname string) []byte {
	hostname := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(publicHostname)), ".")
	return []byte(strings.ReplaceAll(
		string(instructionsTemplate),
		publicHostnamePlaceholder,
		hostname,
	))
}
