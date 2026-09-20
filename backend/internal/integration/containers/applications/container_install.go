package applications

import (
	"fmt"
	"strings"
)

// containerBuildMarkerDir holds one marker file per application, recording the
// build its binaries came from.
//
// The marker is what makes installing idempotent, and it is deliberately not a
// question asked of the binary. Doing that would oblige every container program
// to implement a --version flag and carry a version variable for the build to
// stamp — an unwritten contract that costs a full toolchain download and rebuild
// on every install and start when an author does not know to satisfy it. A file
// the server writes and reads needs nothing from the program at all.
const containerBuildMarkerDir = "/usr/local/lib/remote"

// containerBuildScript returns the provisioning program for an application's
// backend/container/ source: fetch a Go toolchain for the container's own
// architecture, build the application's commands, install them, and record the
// build so that doing it again is free.
//
// This is generated rather than shipped because it was identical in every
// application that had one, down to a hand-copied Go version that had already
// drifted between them. An application supplies Go source; the shell is the
// server's to write.
func containerBuildScript(applicationID, buildVersion string, commands []string) []byte {
	if len(commands) == 0 {
		// Container source that is itself package main builds as one binary
		// named after the application.
		commands = []string{applicationID}
	}
	marker := fmt.Sprintf("%s/%s.build", containerBuildMarkerDir, applicationID)

	var out strings.Builder
	out.WriteString("set -euo pipefail\n")
	fmt.Fprintf(&out, "APP_BUILD_VERSION=%s\n", shellQuote(buildVersion))
	fmt.Fprintf(&out, "APP_BUILD_MARKER=%s\n", shellQuote(marker))
	out.WriteString("export APP_BUILD_VERSION\n")
	out.WriteString(`APP_CONTAINER_SOURCE="${APP_PACKAGE_DIR:?container source was not staged}/` + infraPayloadRoot + `"
export APP_CONTAINER_SOURCE

if [ "$(cat "$APP_BUILD_MARKER" 2>/dev/null || true)" != "$APP_BUILD_VERSION" ]; then
  GOROOT_DIR=/usr/local/go
  if ! "$GOROOT_DIR/bin/go" version 2>/dev/null | grep -q 'go` + containerGoVersion + ` '; then
    ARCH="$(dpkg --print-architecture)"
    case "$ARCH" in
      amd64 | arm64) ;;
      *)
        echo "install: unsupported container architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    if ! command -v curl >/dev/null 2>&1; then
      apt-get -o DPkg::Lock::Timeout=300 update -qq
      apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends curl ca-certificates
    fi
    curl -fsSL -o /tmp/remote-go.tgz "https://go.dev/dl/go` + containerGoVersion + `.linux-${ARCH}.tar.gz"
    rm -rf "$GOROOT_DIR"
    tar -C /usr/local -xzf /tmp/remote-go.tgz
    rm -f /tmp/remote-go.tgz
  fi

  APP_BUILD_DIR="$(mktemp -d)"
  trap 'rm -rf -- "$APP_BUILD_DIR"' EXIT
`)
	for _, command := range commands {
		target := "."
		if command != applicationID || len(commands) > 1 {
			target = "./cmd/" + command
		}
		fmt.Fprintf(&out,
			"  (cd \"$APP_CONTAINER_SOURCE\" && CGO_ENABLED=0 \"$GOROOT_DIR/bin/go\" build"+
				" -mod=mod -buildvcs=false -trimpath"+
				" -ldflags \"-s -w -X main.version=$APP_BUILD_VERSION\""+
				" -o \"$APP_BUILD_DIR/%s\" %s)\n",
			command, target)
		fmt.Fprintf(&out, "  install -m 0755 \"$APP_BUILD_DIR/%s\" /usr/local/bin/%s\n", command, command)
	}
	fmt.Fprintf(&out, `
  mkdir -p %s
  printf '%%s\n' "$APP_BUILD_VERSION" >"$APP_BUILD_MARKER"
fi
`, shellQuote(containerBuildMarkerDir))
	return []byte(out.String())
}

// shellQuote renders a value as a single-quoted shell word. Everything it is
// given here is server-derived, but the binaries and versions it interpolates
// end up in a root shell inside a container, so nothing reaches one unquoted.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
