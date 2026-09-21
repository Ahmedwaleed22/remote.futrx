#!/usr/bin/env bash
# OPTIONAL APPLICATION-SPECIFIC INSTALLATION TEMPLATE
#
# Remote runs this as root inside the target LXD container after it has already
# packaged, built, and installed every program under backend/container/.
# Keep this file only when an application needs work Remote cannot infer, such
# as installing OS packages, writing configuration, creating a systemd unit,
# mounting storage, or performing an application-specific readiness check.
#
# It is not needed for:
#   - a UI-only extension;
#   - a host-only backend/api plugin;
#   - container Go programs that only need Remote's generated build/install;
#   - Hello Remote itself, which has no service, port, packages, or config.
#
# This no-op implementation is intentionally retained in Hello Remote so new
# plugin authors have the correct idempotent shape to copy when they do need it.
set -euo pipefail

echo "hello-remote: no application-specific infrastructure setup required"
