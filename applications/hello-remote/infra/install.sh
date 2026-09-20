#!/usr/bin/env bash
# Build the bundled inspector inside the target project container.
set -euo pipefail

BIN="/usr/local/bin/hello-remote-info"
PACKAGE_DIR="${APP_PACKAGE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SOURCE_DIR="$PACKAGE_DIR/infra"
# A source checkout keeps its nested Go module below infra/source so the root
# catalog's go:embed can still see infra/install.sh and payload.tar.gz. The
# staged payload has already flattened source/ back to infra/.
if [ -z "${APP_PACKAGE_DIR:-}" ]; then
  SOURCE_DIR="$PACKAGE_DIR/infra/source"
fi
GO_VERSION="1.24.7"

if [ ! -f "$SOURCE_DIR/go.mod" ] || [ ! -f "$SOURCE_DIR/VERSION" ]; then
  echo "install: bundled infrastructure source is missing" >&2
  exit 1
fi
SOURCE_VERSION="$(cat "$SOURCE_DIR/VERSION")"
SOURCE_HASH="$(cd "$SOURCE_DIR" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
BUILD_VERSION="${SOURCE_VERSION}+${SOURCE_HASH:0:16}"

installed_version() { "$BIN" --version 2>/dev/null; }
install_source() {
  local goroot="/usr/local/go" arch build_dir
  if ! "$goroot/bin/go" version >/dev/null 2>&1; then
    arch="$(dpkg --print-architecture)"
    case "$arch" in amd64|arm64) ;; *) echo "install: unsupported architecture: $arch" >&2; return 1 ;; esac
    if ! command -v curl >/dev/null 2>&1; then
      apt-get -o DPkg::Lock::Timeout=300 update -qq
      apt-get -o DPkg::Lock::Timeout=300 install -y -qq --no-install-recommends curl ca-certificates
    fi
    curl -fsSL -o /tmp/hello-remote-go.tgz "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz"
    rm -rf "$goroot"
    tar -C /usr/local -xzf /tmp/hello-remote-go.tgz
    rm -f /tmp/hello-remote-go.tgz
  fi
  build_dir="$(mktemp -d)"
  (cd "$SOURCE_DIR" && CGO_ENABLED=0 "$goroot/bin/go" build \
    -mod=readonly -buildvcs=false -trimpath \
    -ldflags "-s -w -X main.version=${BUILD_VERSION}" \
    -o "$build_dir/hello-remote-info" ./cmd/hello-remote-info)
  install -m 0755 "$build_dir/hello-remote-info" "$BIN"
  rm -rf "$build_dir"
}

if [ "$(installed_version || true)" != "$BUILD_VERSION" ]; then
  install_source
fi
"$BIN" >/dev/null
echo "install: Hello Remote container inspector is ready"
