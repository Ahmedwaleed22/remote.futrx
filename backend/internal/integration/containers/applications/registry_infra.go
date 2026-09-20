package applications

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

const defaultInstallScriptPath = "infra/install.sh"

// validateInstallScriptPath rejects manifest overrides outside the capability's
// directory. It runs before other capability discovery so load errors retain
// their established order.
func validateInstallScriptPath(scriptPath string) error {
	if scriptPath != "" && (!fs.ValidPath(scriptPath) || !strings.HasPrefix(scriptPath, "infra/")) {
		return fmt.Errorf("install script must be inside infra/")
	}
	return nil
}

// loadApplicationInfrastructure discovers and prepares an application's
// container-side capability. An explicit manifest path is required to exist.
// backend/container/ generates a build script and may stand alone or run before
// a custom infra script.
func loadApplicationInfrastructure(catalog fs.FS, root, applicationID, applicationVersion, configuredPath string) (string, []byte, *svc.ApplicationContainer, error) {
	installPath := configuredPath
	if installPath == "" {
		installPath = defaultInstallScriptPath
	}

	script, err := fs.ReadFile(catalog, path.Join(root, installPath))
	if errors.Is(err, fs.ErrNotExist) && configuredPath == "" {
		script = nil
		installPath = ""
		err = nil
	}
	if err != nil {
		return "", nil, nil, fmt.Errorf("read install script %q: %w", installPath, err)
	}

	container, err := packContainerSource(catalog, root, applicationID)
	if err != nil {
		return "", nil, nil, fmt.Errorf("container source: %w", err)
	}
	if container == nil {
		script, err = withInfraPayload(catalog, root, script)
		if err != nil {
			return "", nil, nil, fmt.Errorf("infra payload: %w", err)
		}
		return installPath, script, nil, nil
	}
	if _, err := fs.Stat(catalog, path.Join(root, "infra", "payload.tar.gz")); err == nil {
		return "", nil, nil, fmt.Errorf("backend/container and infra/payload.tar.gz cannot both be present")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", nil, nil, fmt.Errorf("inspect infra payload: %w", err)
	}

	buildVersion := containerBuildVersion(applicationVersion, container.digest)
	prologue := containerBuildScript(applicationID, buildVersion, container.commands)
	combined := append(prologue, script...)
	metadata := &svc.ApplicationContainer{
		Commands:     append([]string(nil), container.commands...),
		SourceDigest: container.digest,
		BuildVersion: buildVersion,
	}
	return installPath, stageInfraPayload(container.payload, combined), metadata, nil
}

func containerBuildVersion(applicationVersion, digest string) string {
	if applicationVersion == "" {
		return digest[:16]
	}
	return applicationVersion + "+" + digest[:16]
}
