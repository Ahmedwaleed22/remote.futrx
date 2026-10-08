# Scheduled Tasks

Install this project application from **Applications**. Ask the agent to
remember work for a specific time or to repeat it on a five-field cron schedule.
The stored message wakes a normal agent turn in the same chat. No separate
arming action or manual skill selection is needed.

The package follows Hello Remote and Code Server: `application.json` owns
installation and capabilities; `backend/main.go` wires the API to its lifecycle
publisher and `Runtime.AgentTurns` through `ServeWithRuntime`; `backend/api/` owns task validation,
persistence and scheduling; `backend/lifecycle/` owns the `tasks.due` event;
`infra/` owns the container CLI; `skills/` publishes the workflow; and `ui/`
contributes a scoped chat-header action through the supported extension API.
It declares no container daemon, port, credential or external infrastructure.
The clock runs in the application's host backend, so it can wake a stopped
project container through Remote's normal prompt execution path.

## Use

```text
Notify me every day at 15:00 UTC to review the deployment.
```

The application stores private task definitions in its instance `DataDir` as
`tasks.json`. New tasks are active. Times use RFC3339 with an explicit offset;
cron uses numeric lists, ranges and steps, an explicit IANA timezone, and
traditional day-of-month OR day-of-week semantics. Prompts are capped at 32 KiB.
An installation retains up to 100 definitions; delete old definitions if full.
The shared application agent runtime admits at most two simultaneous application turns
across the server. Each chat still admits one turn at a time.

The clock action lists this chat's tasks. Refresh, pause, resume, run now and
delete use this application's backend. The open panel quietly refreshes every
three seconds so queued runs update without a page reload. Finished tasks are
archived automatically; **Show archived tasks** reveals their history. **Archive**
pauses future runs and preserves the definition; an already claimed run is not
cancelled. **Restore** returns a manually archived task to the paused list.
Archived definitions still count toward the 100-task limit. Definitions are created conversationally;
there is no definition-edit form. Resume recomputes the next future deadline.
A one-time task in the past or a task exhausted at `maxRuns` cannot be resumed.
Run now requests one occurrence; recurring tasks schedule their next normal
occurrence after the requested run finishes. Pause stops new claims; a claim
already pending or an agent already running finishes normally.

Scheduled turns receive only permission to complete their current task.
Interactive turns receive owner/chat/project-scoped management access. Remote
injects `REMOTE_APPLICATION_API` and `REMOTE_APPLICATION_GRANT` into eligible project
turns and revokes the grant after each run. These are runtime capabilities,
not project secrets. Every dispatch rechecks the owner and chat/project access.

## Lifecycle and delivery

Stop terminates the app backend and stops automatic delivery while keeping
state. Start resumes its clock; one overdue occurrence is delivered rather than
replaying every missed interval. Uninstall removes the CLI, published skill
and instance data. Upgrade retains the instance data. Rebuild the CLI archive
with `bash applications/scheduled-tasks/infra/build-payload.sh` after editing
`infra/remote-schedule`; the payload test checks for stale archives.

The manifest opts into shared background recovery, agent turns and agent tools.
Remote restores all opted-in running backends after host restarts or child
crashes. The app saves claims before calling `AgentTurns.Start`, retries busy
execution every 15 seconds, and polls accepted turns once per second. Its
`tasks.due` event is observability, not delivery acknowledgment. It interprets
completion markers and saves outcomes/next deadlines itself before forgetting
Remote's durable execution receipt. A child restart reuses the existing turn;
an interrupted agent can be retried after a host restart. Delivery is at least
once, so prompts with external side effects should inspect target state before
repeating an action. See the [generic runtime contract](../../docs/dev/installable-applications/25-application-agent-runtime.md).

The retired built-in scheduler's data file is left untouched. Its old task
definitions are not imported automatically; recreate wanted reminders through
the installed application. The old core APIs, task store and drawer are removed.

## Verification

```sh
jq empty applications/scheduled-tasks/application.json
bash -n applications/scheduled-tasks/infra/*.sh
node --test applications/scheduled-tasks/infra/*.test.mjs applications/scheduled-tasks/ui/scripts/*.test.mjs
go test ./applications/scheduled-tasks/backend/...
(cd backend && go test ./internal/service/applications ./internal/service/prompt ./internal/integration/containers/applications)
```

The core integration test compiles and runs the packaged backend through the
generated-module builder, creates an active task through a scoped grant,
restarts the application backend, observes the correct chat wake-up and verifies
completion. For a live check, install the application in a disposable project,
ask for a reminder one minute ahead without selecting a skill, close the
browser, and confirm the reminder appears in that chat. Stop/start and uninstall
should remove its action and scheduling access as described above.
