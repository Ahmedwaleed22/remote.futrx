package applications

import (
	"strings"
	"testing"
)

func TestContainerBuildScriptBuildsCommandsAndUsesMarker(t *testing.T) {
	script := string(containerBuildScript("example", "2+abc", []string{"agent", "worker"}))
	for _, want := range []string{
		"/usr/local/lib/remote/example.build",
		"./cmd/agent",
		"./cmd/worker",
		"/usr/local/bin/agent",
		"/usr/local/bin/worker",
		"go" + containerGoVersion,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("generated script does not contain %q", want)
		}
	}
	if strings.Contains(script, `agent --version`) || strings.Contains(script, `worker --version`) {
		t.Fatal("generated script requires a plugin-defined --version command")
	}
}

func TestContainerBuildScriptBuildsRootProgramAsApplicationID(t *testing.T) {
	script := string(containerBuildScript("example", "1+abc", nil))
	if !strings.Contains(script, `-o "$APP_BUILD_DIR/example" .`) {
		t.Fatalf("root build command missing from:\n%s", script)
	}
}
