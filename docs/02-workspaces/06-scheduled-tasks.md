# Scheduled tasks

Scheduled Tasks is an optional project application under
[`applications/scheduled-tasks/`](../../applications/scheduled-tasks/). The
application owns the cron clock, definitions, claims, persistence, CLI, skill
and chat-header UI. Core supplies authenticated per-turn access and the bridge
that wakes the existing agent/chat execution path.

`backend/main.go` composes the request API and the lifecycle-owned `tasks`
publisher through `rpc.ServeWithRuntime`, following Hello Remote. The manifest
registers `tasks.due` version 1. It declares only the project scope, installer,
uninstaller, host backend, publisher and UI that are implemented.

## Create and wake

1. Installing the app publishes `/workspace/scripts/remote-schedule` and its
   `scheduled-tasks` skill using normal application provisioning.
2. Every supported project turn with a running installation receives the skill
   and `REMOTE_SCHEDULE_API` / `REMOTE_SCHEDULE_GRANT`. Explicit skill selection
   is unnecessary. The grant is bound to owner, chat and project and revoked at
   turn completion, with a four-hour expiry as a fallback.
3. The CLI uses the capability-authenticated `/agent-api/schedules` bridge.
   Core stamps the grant's caller and chat before forwarding to the app API.
   Newly created tasks are active.
4. The application checks its deadlines once per second and atomically saves
   a random run claim before publishing `tasks.due` with task and run IDs.
5. Core resolves the live installation and the claimed task from the app,
   rechecks owner registration, project access and chat/project identity, then
   calls `prompt.Service.Start`. The stored prompt becomes a normal user event
   in that chat; selected provider, session, container startup, transcript,
   notifications and one-run-per-chat locking follow the existing run path.
6. Core sends the result back to the application. The app clears the claim,
   records the result and schedules its next future occurrence, or disables a
   one-time, completed or exhausted task.

The core bridge lives in
[`scheduledmessages/`](../../backend/internal/service/scheduledmessages/).
It owns no task store or deadline calculation. It restores running scheduler
backends every 15 seconds after host restarts or child crashes. Core's event
callback only enqueues work; it never re-enters a producer-held instance lock.

## Storage and retries

Tasks live in `tasks.json` in each application's host `Instance.DataDir`.
Writes use a private temporary file, file fsync, atomic rename and directory
fsync. Stop/start and upgrades retain the data; uninstall removes it.

The event bus remains best effort. Until a claim is acknowledged, the app
republishes it every 15 seconds. Core deduplicates accepted runs in memory and
retries result acknowledgments without repeating the accepted agent turn.
Busy chats and maintenance retry the pending claim. At most two scheduled turns
run simultaneously across the server. A restart can retry an interrupted run,
so delivery is at least once across host crashes rather than exactly once.
Missed cron intervals produce one overdue run and then a future deadline.

The retired scheduler's shared data file is left intact for reference. Existing
definitions are not imported automatically and must be recreated through the
application. The old core scheduler, file store, user schedule routes, default
skill fallback and built-in drawer no longer exist.

## Scope and limits

An interactive grant manages only its owner's tasks in its chat/project.
Scheduled turns receive `complete-self` only, checked against the live run ID.
The application checks caller ownership on its API; core stamps trusted event
source identity and refuses stale, stopped or cross-project installations.

Definitions support RFC3339 one-time dates or numeric five-field cron and IANA
timezones. The existing parser's list/range/step, Sunday and DST tests move into
the application. Prompts are capped at 32 KiB; an installation retains 100 task
definitions. Recurring monitoring supports `maxRuns`. There is no manual arm
step, definition-edit form, configurable overlap policy, recurrence floor or
scheduler-specific deployment environment configuration.

Verification includes application unit tests, publisher contract tests, CLI
payload tests, project UI visibility tests, a prompt test for access without a
selected skill, and a real generated-backend create/restart/wake/finish test.
See the [application README](../../applications/scheduled-tasks/README.md).
