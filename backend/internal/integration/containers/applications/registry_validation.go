package applications

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/futrx-com/remote.futrx.com/internal/integration/containers/applications/hosttools"
	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

var (
	serviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]*$`)
	environmentPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	identityPattern    = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*$`)
)

func validateApplication(application svc.Application) error {
	if len(application.HostTools) > 0 && !application.NeedsContainer() {
		return fmt.Errorf("host tools require a provisioned application")
	}
	for _, tool := range application.HostTools {
		if err := hosttools.Validate(tool); err != nil {
			return fmt.Errorf("host tool %q: %w", tool.Name, err)
		}
	}

	if application.Name == "" {
		return fmt.Errorf("missing name")
	}
	// Version is what an installed instance is compared against to decide
	// whether its container side must be converged again, so an application
	// without one could never be upgraded in place. It is free text — "8.0", "16",
	// "1.2.3-rc1" — because the only question ever asked of it is whether it
	// differs from what an instance recorded, never which of two is newer.
	if strings.TrimSpace(application.Version) == "" {
		return fmt.Errorf("missing version")
	}
	if len(application.Scopes) == 0 {
		return fmt.Errorf("missing scopes")
	}
	for _, scope := range application.Scopes {
		if !scope.Valid() {
			return fmt.Errorf("invalid scope %q", scope)
		}
	}
	if err := validateService(application); err != nil {
		return err
	}
	if !application.NeedsContainer() {
		if application.Port.Internal != 0 || application.Port.DefaultExternal != 0 || application.Healthcheck.Command != "" {
			return fmt.Errorf("port and healthcheck require a container capability")
		}
	} else if application.Port.Internal == 0 && (application.Port.DefaultExternal != 0 || application.Healthcheck.Command != "") {
		return fmt.Errorf("port.defaultExternal and healthcheck require port.internal")
	}
	if application.UI == nil && application.Backend == nil && !application.NeedsContainer() && len(application.Skills) == 0 {
		return fmt.Errorf("application has no infra, backend, ui, or skills")
	}
	return nil
}

func validateService(application svc.Application) error {
	service := application.Service
	if service == nil {
		return nil
	}
	if !serviceNamePattern.MatchString(service.Name) || strings.HasSuffix(service.Name, ".service") {
		return fmt.Errorf("service.name must be a valid unit name without the .service suffix")
	}
	if len(service.Command) == 0 || !strings.HasPrefix(service.Command[0], "/") {
		return fmt.Errorf("service.command must start with an absolute executable path")
	}
	for _, argument := range service.Command {
		if strings.ContainsAny(argument, "\x00\r\n") {
			return fmt.Errorf("service.command arguments cannot contain control characters")
		}
	}
	if strings.ContainsAny(service.Description, "\r\n") {
		return fmt.Errorf("service.description must be one line")
	}
	if service.User != "" && !identityPattern.MatchString(service.User) {
		return fmt.Errorf("service.user is invalid")
	}
	if service.Group != "" && !identityPattern.MatchString(service.Group) {
		return fmt.Errorf("service.group is invalid")
	}
	validRestart := map[string]bool{
		"": true, "no": true, "on-success": true, "on-failure": true,
		"on-abnormal": true, "on-watchdog": true, "on-abort": true, "always": true,
	}
	if !validRestart[service.Restart] {
		return fmt.Errorf("service.restart %q is invalid", service.Restart)
	}
	if service.RestartSec < 0 {
		return fmt.Errorf("service.restartSec cannot be negative")
	}
	if protect := service.Hardening.ProtectSystem; protect != "" && protect != "true" && protect != "full" && protect != "strict" {
		return fmt.Errorf("service.hardening.protectSystem %q is invalid", protect)
	}

	declared := make(map[string]bool, len(application.Env))
	for _, variable := range application.Env {
		declared[variable.Key] = true
	}
	targets := make(map[string]bool, len(service.Environment))
	for _, variable := range service.Environment {
		if !environmentPattern.MatchString(variable.Key) {
			return fmt.Errorf("service.environment key %q is invalid", variable.Key)
		}
		if targets[variable.Key] {
			return fmt.Errorf("service.environment key %q is duplicated", variable.Key)
		}
		targets[variable.Key] = true
		if !declared[variable.FromEnv] {
			return fmt.Errorf("service.environment %q references undeclared env %q", variable.Key, variable.FromEnv)
		}
		if variable.Encoding != "base64" {
			return fmt.Errorf("service.environment %q must use base64 encoding", variable.Key)
		}
	}
	return nil
}
