#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
base=${1:-origin/qa}
out=${2:-"$repo/.performance/$(date -u +%Y%m%dT%H%M%SZ)"}
go_bin=${GO_BIN:-go}
command -v "$go_bin" >/dev/null
node --version >/dev/null
[ -d "$repo/frontend/node_modules" ] || { echo 'Run npm --prefix frontend ci first.' >&2; exit 1; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
baseline=$(mktemp -d "$out/baseline.XXXXXX")
git -C "$repo" worktree add --detach "$baseline" "$base"
git -C "$repo" rev-parse "$base" > "$out/baseline-ref.txt"
cleanup() { git -C "$repo" worktree remove --force "$baseline"; }
trap cleanup EXIT
mkdir -p "$baseline/backend/internal/performance"
cp "$repo/backend/internal/performance/loading_test.go" "$baseline/backend/internal/performance/"
cp "$repo/backend/internal/stores/filechat/tail_performance_test.go" "$baseline/backend/internal/stores/filechat/"
ln -s "$repo/frontend/node_modules" "$baseline/frontend/node_modules"
for label in baseline candidate; do
 target="$baseline"
 [ "$label" != candidate ] || target="$repo"
 node --experimental-strip-types --expose-gc "$repo/scripts/performance/streaming.mjs" "$target" > "$out/streaming-$label.json"
 node --experimental-strip-types --expose-gc "$repo/scripts/performance/search-memory.mjs" "$target" > "$out/search-$label.json"
 REMOTE_LOAD_TEST=1 "$go_bin" -C "$target/backend" test ./internal/performance -run TestCapabilityHTTPLoad -count=1 -v > "$out/http-$label.log" 2>&1
 "$go_bin" -C "$target/backend" test ./internal/stores/filechat -run '^$' -bench BenchmarkLoadingTailSequence -benchmem -benchtime=1s -count=3 > "$out/tail-$label.log" 2>&1
 if [ "${BROWSER_LOAD_TEST:-0}" = 1 ]; then
  npm --prefix "$target/frontend" run build > "$out/build-$label.log" 2>&1
  flags=()
  [ "$label" != baseline ] || flags+=(--baseline)
  node "$repo/scripts/performance/browser.mjs" "$target" "${flags[@]}" > "$out/browser-$label.json" 2> "$out/browser-$label-error.log"
 fi
done
python3 "$repo/scripts/performance/report.py" "$out"
echo "Results: $out"
