# Chat and model loading performance

This branch makes model catalogs progressive (`GET /api/agent-capabilities?progressive=1`). Each provider retains its own result/TTL and refresh flight. Initial responses include `refreshing: true` for unfinished providers; browser observers poll with backoff and stop on unmount. A transient failed probe retains a previous healthy catalog with a warning; explicit authentication unavailability replaces it. Existing clients without `progressive=1` still receive a complete catalog. Provider work has a global concurrency limit of eight and a deadline that includes waiting for a slot.

Other changes:

- Indexing checks read the log tail in expanding 4 KB windows, cache its sequence by file size/mtime, and back off frontend polls to four seconds.
- Streaming updates fold only new ordered events; out-of-order/replayed events keep the full merge path. Raw provider telemetry remains persisted on the server and is not retained by the chat UI. Completed turns reconcile with the compact transcript projection, preserving later live events and explicitly loaded history.
- Search folding uses flat strings, skips caching large transcript text, and caps retained cache characters. Inactive model scopes are bounded to 32 in the browser.
- The workspace subscribes with `chatLimit=100`; older metadata is paged through `/api/chats?limit=100&before=...`. Deep links hydrate the selected chat directly. Search and filters fetch the full authorized metadata snapshot only on demand to preserve existing fuzzy ranking/facet semantics, and release it when cleared. The metadata endpoint also supports `q` for simple title/path/provider matching; this does not replace rich client search.
- Project tabs load only their own data. Settings uses `/api/projects/:id/container?resources=1`, skipping guest, agent/version and credential probes. Existing full inspection remains available on Info.
- Chat history and expanded transcript downloads abort when their owning view is unmounted.

## Repeatable baseline comparison

Install frontend dependencies with `npm --prefix frontend ci`. Use the Go version in `backend/go.mod`. From the repository root:

```bash
GO_BIN=/usr/local/go/bin/go bash scripts/performance/run.sh origin/qa
```

This creates an isolated temporary worktree at the baseline ref, copies only the compatible test fixtures into it, runs the same scenarios against baseline and candidate, and removes the temporary worktree. Results and machine-readable `report.json` are saved under `.performance/`. It does not contact production, run installed provider CLIs, or modify user chats.

Scenarios:

1. 64 simultaneous HTTP model requests against deterministic 1 ms and 200 ms providers: cold cache, warm cache and forced refresh; p50/p95/p99, failure count and actual probe count.
2. 100 loaded turns plus 4,000 streamed deltas in 1,000 batches: batch latency, retained JS heap and process RSS after garbage collection.
3. Find-in-chat folding of 100 different approximately 68 KB transcript strings: retained JS heap and process RSS after garbage collection.
4. Reading the sequence of a normal final event in a 32 MiB log: repeated Go allocation/latency benchmarks.

An optional real Chromium scenario tests 12 chat/settings navigation cycles and 100 unique 512 KB native telemetry events, with 1,000 fixture chats. It records JS heap, DOM nodes, HTTP calls, page errors and screenshots. Install Playwright at the workspace or repository root and its Chromium browser, then run:

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
  BROWSER_LOAD_TEST=1 GO_BIN=/usr/local/go/bin/go \
  bash scripts/performance/run.sh origin/qa
```

The browser harness serves built UI assets on ephemeral loopback HTTP ports inside the test process, mocks API/WS fixtures, and tears down the browser/server afterward. JS heap and Node RSS are **not total browser-tab RAM**. Fixture delays are intentional, not measurements of LXD or provider latency. Repeat comparisons on an otherwise idle machine; avoid running builds and other tests concurrently.

The separate draft-preservation worktree can be checked using the same browser harness:

```bash
npm --prefix /workspace/remote-futrx-chat-drafts/frontend run build
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
  node scripts/performance/browser.mjs /workspace/remote-futrx-chat-drafts --drafts
```

This checks unsent text, in-flight upload ownership, attachment restoration after navigation/reload, explicit removal, and duplicate/aborted upload counts.

## Generate a huge chat to open in the UI

Run `scripts/performance/seed-huge-chat.py` on the machine running your **test** backend. Stop that backend first, then restart it afterward: its metadata catalog is cached. Set `--data-dir` to its actual `DATA_DIR` (the backend default is `/opt/remote.futrx/data`). `--template-chat` is the ID from an existing chat URL; only its project/account and execution settings are copied, never its conversation or provider session IDs. A new chat directory is always created; existing chats are never filled or overwritten.

```bash
python3 scripts/performance/seed-huge-chat.py \
  --data-dir /path/to/test-backend/data \
  --template-chat YOUR_EXISTING_CHAT_ID \
  --turns 2000 --text-kb 8 --tool-kb 32 --telemetry-kb 16
```

This produces approximately 120 MB of JSONL with 2,000 user/assistant turns, tool outputs and raw telemetry, without calling a model or executing the synthetic tool commands. The output includes the new chat ID, size and `/chats/<id>` route. Open that route after restarting. Test initial indexing/loading, Load older messages, scrolling, expanding tool output, find-in-chat (`needle-1500`), and navigation away/back while watching browser task-manager memory. Finding old content may require loading its history first. Increase to `--turns 10000` for roughly 600 MB on disk; payload flags are KB per turn. Disk size and browser RAM differ because transcript projections are compact and paginated.

To generate a standalone fixture outside the backend, omit the template and use a scratch directory. Without a template, project/account visibility is not inherited. For a fair comparison, use the same generated files and actions on QA and the candidate; copy only metadata/log files while each test backend is stopped and let each rebuild its own transcript index. Remove the synthetic chat using the normal UI when finished.

## Production follow-up

Deploy only through the normal QA workflow after review. Compare network p95 for capability/transcript/workspace/resource calls on the same dataset. New backend logs include provider probe duration/source/failure and workspace snapshot counts, without provider output or prompt content. Capture browser heap profiles before/after a fixed navigation/search/streaming sequence; tab task-manager memory also includes decoded images, GPU allocations, frames and other browser overhead that these synthetic tests do not measure.
