#!/usr/bin/env bash
# Rebuild the reproducible infrastructure payload.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! tar --version 2>/dev/null | head -n 1 | grep -q 'GNU tar'; then
  echo "package.sh: GNU tar is required" >&2
  exit 1
fi
(
  cd infra/source
  find . -type f \
    \( -name '*.go' -o -name 'go.mod' -o -name 'VERSION' \) -printf '%P\0' |
    LC_ALL=C sort -z |
    tar --create --format=ustar \
      --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --mode='0644' \
      --transform='s|^|infra/|' \
      --null --no-recursion --files-from=-
) | gzip -9 -n >infra/payload.tar.gz
echo "package.sh: wrote infra/payload.tar.gz ($(wc -c <infra/payload.tar.gz) bytes)"
