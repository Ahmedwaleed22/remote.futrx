package main

import (
	"strings"
	"testing"
)

func TestConfigurationRequiresEveryDeclaredValue(t *testing.T) {
	_, err := configurationFromEnv(func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "HELLO_GREETING_B64") {
		t.Fatalf("error = %v, want missing greeting", err)
	}
}
