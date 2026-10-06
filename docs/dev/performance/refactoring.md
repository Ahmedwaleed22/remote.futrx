# Refactor review, 6 October 2026

Scope: the changes in `perf/chat-model-loading` through `f9fa8000` and in `fix/preserve-chat-drafts` through `e2dccc77`. The branches and worktrees remain separate. Existing pure projectors, streaming replay, text folding, access deduplication, HTTP contracts, and cancellation paths were reviewed and retained in their current owners.

## Smell → principle → structural move

Paths below are relative to the repository; draft paths belong to `fix/preserve-chat-drafts`.

| Original evidence | Responsibility problem | Resulting owner |
| --- | --- | --- |
| `backend/internal/service/agent/capability/service.go:156` | Catalog orchestration included provider execution, deadline/semaphore handling, normalization and logging | `backend/internal/service/agent/capability/probe.go:14`; the catalog keeps authorization, scope selection and cache coordination |
| `backend/internal/stores/filechat/transcript_projection_reader.go:75` | Projection orchestration also owned tail-file scanning and its metadata cache | `backend/internal/stores/filechat/tail_sequence.go:13` owns those persistence details |
| `backend/internal/service/chat/page.go:10` | Public paging contracts were declared alongside selection and cursor algorithms | Contracts live in `backend/internal/service/chat/model.go`; fixed limits live in `internal/config/constants/chat.go` |
| `backend/internal/service/project/service.go:501` | A variadic boolean obscured full versus lightweight inspection; an anonymous optional interface hid the dependency role | Named `InspectContainer` / `InspectContainerResources` operations and `ContainerResourceInspector`, preserving the existing full-inspection fallback |
| `frontend/src/state/stores/agents/agentCapabilityCatalogStore.ts:19` | Reactive snapshots, HTTP calls, request coalescing, observers and timers shared a state module | `frontend/src/services/agents/agentCapabilityCatalogService.ts:25` owns the async workflow; the Zustand store owns snapshots; `app/agentCapabilities.ts` constructs both |
| `frontend/src/state/hooks/workspace/useWorkspaceData.ts:38` | The hook constructed concrete dependencies and enforced generation-sensitive metadata hydration | `frontend/src/services/workspace/workspaceChatService.ts:7` owns hydration; `app/workspaceFeed.ts` constructs dependencies; the hook selects state and binds UI lifecycle |
| `frontend/src/state/hooks/projects/useProjectContainersController.ts:28` | Manual refresh and initial load repeated the same tab-selection policy | `frontend/src/services/projects/projectTabDataService.ts:5` selects loaders, preserving invocation order; the hook retains framework lifecycle and cancellation |
| Draft `frontend/src/state/hooks/chat/useAttachmentUpload.ts:34` | The presentation hook coordinated upload handles, file naming, previews, persistence and extension claims | `frontend/src/services/chat/attachmentUploadService.ts:14` owns the session workflow behind injected boundaries; the hook selects state and binds target updates |
| Draft `frontend/src/state/stores/chat/attachmentDraftStore.ts:8` | Public mutable upload maps and browser/storage details leaked from the reactive data layer | Handles and completion callbacks are private to the upload service; `api/chat/attachmentDraftStorage.ts:7` owns serialization and preview reconstruction; the store owns draft state |
| Draft `frontend/src/state/stores/workspace/workspaceStore.ts:62` | Workspace state mutations also coordinated attachment and composer cleanup | `frontend/src/services/chat/chatDraftSessionService.ts:5` owns explicit discard order, invoked before the deletion reaches the workspace feed |
| `scripts/performance/seed-huge-chat.py:12` | One function mixed CLI parsing, metadata selection, event generation and filesystem publication | `parse_arguments`, `template_metadata`, `fixture_events`, and `publish_chat`, with the existing CLI coordinating them |

Behavioral dependency contracts are in `port/`; application data stays with existing `models/` owners. New settings are centralized in the existing configuration directories. Services are framework-independent; app composition constructs concrete dependencies and contexts expose them to hooks. Importing the new composition modules starts no sockets, requests or polling timers.

## Behavior preserved by

- Both frontend production builds and final TypeScript checks passed. Full frontend suites: **560/560** on performance and **557/557** on drafts, including the store architecture check.
- Full backend `go test ./...` passed. Race checks passed for capability discovery, project inspection, inspection probes and HTTP handlers. Chat paging and filechat tests passed after extraction and final import cleanup.
- The 64-client model HTTP fixture passed cold, warm and forced-refresh phases with **192 successful requests, zero failures**, and shared probes. Progressive response shape, fallback/authentication behavior, deadlines and concurrency remain covered by the existing tests.
- Streaming and search memory fixtures passed. The refactored performance UI completed 12 navigation cycles and telemetry injection with **zero page errors** and **5,907,092 bytes retained JS heap**, consistent with the earlier approximately 5.9 MB fixture result. This is not total tab RAM or a navigation-latency claim.
- The draft Chromium fixture passed text/image restoration, three navigation cycles, reload and explicit removal: **one upload, zero navigation-triggered upload deletions, zero page errors**.
- Focused runtime checks verified completion across remount, explicit upload discard, stale metadata rejection, current deep-link seeding, and the existing pending behavior during an extension claim.
- The generator characterization test pins metadata, event types/order, sequence/timestamps, payloads, preservation of the source chat, omission of provider session IDs, collision errors and staging cleanup. It passed before and after extraction. `bash -n scripts/performance/run.sh` passed.

## Commit history and verification

| Commit | Subject | Relevant proof |
| --- | --- | --- |
| `98435294` | Separate capability catalog orchestration from provider probes | Capability race suite |
| `92feb25c` | Separate cached log-tail reads from transcript projection | Filechat/paging tests |
| `f9b9cb83` | Keep chat paging contracts with chat models and configuration | Paging tests and backend build/tests |
| `0904c142` | Name full and resource-only container inspection operations | Project/inspection/handler race suites |
| `a053288d` | Extract loading workflows from stores and presentation hooks | TypeScript, production build, 560 frontend tests, browser and runtime fixtures |
| `f81dd6fa` | Characterize the huge-chat fixture format and collision behavior | Characterization test against the original generator |
| `5403812d` | Separate fixture generation from CLI and file publication | The same characterization test after extraction |
| `f4e463c6` | Group extracted backend imports by dependency layer | Capability/filechat suites |
| Draft `d26462ca` | Give chat draft uploads and cleanup explicit session owners | TypeScript, production build, 557 frontend tests, Chromium draft scenario and focused upload checks |

Commits retain SSH signing. The missing files at the configured signing-key path were restored from the project's existing SSH secret; Git signing settings and hooks were not disabled. Nothing was pushed or deployed.

## Deliberately not changed

An existing behavior was reproduced: removing an attachment after an extension claims a completed upload removes its draft chip but leaves its upload batch pending until the claim resolves or the existing timeout expires. The refactor preserves it; changing that cancellation behavior is a separate fix.

Untouched legacy workflows were not reorganized across the entire application. No new feature, cache policy, wire shape, polling delay, authentication rule, persistence format, or fixture payload was introduced. Real-session profiling of the reported 729 MB tab usage and improvements to end-to-end navigation latency remain outside this behavior-preserving refactor.
