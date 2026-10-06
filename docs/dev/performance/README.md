# Chat and model loading performance

This branch makes model catalogs progressive (`GET /api/agent-capabilities?progressive=1`). Each provider retains its own result/TTL and refresh flight. Initial responses include `refreshing: true` for unfinished providers; browser observers poll with backoff and stop on unmount. A transient failed probe retains a previous healthy catalog with a warning; explicit authentication unavailability replaces it. Existing clients without `progressive=1` still receive a complete catalog. Provider work has a global concurrency limit of eight and a deadline that includes waiting for a slot.

Other changes:

- Indexing checks read the log tail in expanding 4 KB windows, cache its sequence by file size/mtime, and back off frontend polls to four seconds.
- Streaming updates fold only new ordered events; out-of-order/replayed events keep the full merge path. Raw provider telemetry remains persisted on the server and is not retained by the chat UI. Completed turns reconcile with the compact transcript projection, preserving later live events and explicitly loaded history.
- Search folding uses flat strings, skips caching large transcript text, and caps retained cache characters. Inactive model scopes are bounded to 32 in the browser.
- The workspace subscribes with `chatLimit=100`; older metadata is paged through `/api/chats?limit=100&before=...`. Deep links hydrate the selected chat directly. Search and filters fetch the full authorized metadata snapshot only on demand to preserve existing fuzzy ranking/facet semantics, and release it when cleared. The metadata endpoint also supports `q` for simple title/path/provider matching; this does not replace rich client search.
- Project tabs load only their own data. Settings uses `/api/projects/:id/container?resources=1`, skipping guest, agent/version and credential probes. Existing full inspection remains available on Info.
- Chat history and expanded transcript downloads abort when their owning view is unmounted.

## Production follow-up

Deploy only through the normal QA workflow after review. Compare network p95 for capability/transcript/workspace/resource calls on the same dataset. New backend logs include provider probe duration/source/failure and workspace snapshot counts, without provider output or prompt content. Capture browser heap profiles before/after a fixed navigation/search/streaming sequence; tab task-manager memory also includes decoded images, GPU allocations, frames and other browser overhead that these synthetic tests do not measure.
