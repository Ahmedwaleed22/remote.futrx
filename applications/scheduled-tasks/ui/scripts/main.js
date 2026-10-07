const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><circle cx="16" cy="17" r="3"/><path d="M16 15v2l1 1"/></svg>';

const ACTION_ICONS = {
  Pause: '<path d="M8 5v14M16 5v14"/>',
  Resume: '<path d="m9 5 10 7-10 7Z"/>',
  "Run now": '<path d="m9 5 10 7-10 7Z"/>',
  Archive: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/>',
  Restore: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  Delete: '<path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7"/>',
};

function actionIcon(paths, className = "scheduled-tasks-action-icon") {
  const icon = document.createElement("span");
  icon.className = className;
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
  return icon;
}

export function taskState(task, now = Date.now()) {
  if (task.activeRunId) return "Run pending";
  if (task.enabled) return "Scheduled";
  if ((task.kind === "once" && task.runCount > 0) || (task.maxRuns > 0 && task.runCount >= task.maxRuns)) return "Finished";
  if (task.kind === "once" && Date.parse(task.at) <= now) return "Time has passed";
  return "Paused";
}

export function isArchived(task) {
  return Boolean(task.archived || taskState(task) === "Finished");
}

export function readableTime(value, timezone = "UTC") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date) + ` (${timezone})`;
  } catch { return date.toISOString() + " (UTC)"; }
}

export function scheduleSummary(task) {
  if (task.kind === "once") return `Once, on ${readableTime(task.at, task.timezone)}`;
  const fields = (task.cron || "").trim().split(/\s+/);
  const [minute, hour, day, month, weekday] = fields;
  const zone = task.timezone || "UTC";
  if (fields.length === 5 && day === "*" && month === "*" && weekday === "*") {
    if (minute === "*" && hour === "*") return `Every minute (${zone})`;
    if (/^\*\/[1-9]\d*$/.test(minute) && hour === "*") return `Every ${minute.slice(2)} minutes (${zone})`;
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return `Every day at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} (${zone})`;
  }
  return task.nextRunAt ? `Repeats; next run on ${readableTime(task.nextRunAt, task.timezone)}` : "Recurring schedule; no next run while paused";
}

export function friendlyError(error) {
  const message = String(error?.message || error || "Unknown error");
  if (/future RFC3339|choose at or cron/.test(message)) return "This reminder’s time has passed. Use Run now, or ask the agent to create a reminder for a future time.";
  if (/maxRuns/.test(message)) return "This task has finished its planned runs. Ask the agent to create a new schedule.";
  if (/pending run|claim changed/.test(message)) return "This task already has a run pending. Refresh to see its latest status.";
  if (/task not found|404/.test(message)) return "This task is no longer available. Refresh the list.";
  if (/fetch|network|timeout|backend|running/i.test(message)) return "Couldn’t reach Scheduled Tasks. Check your connection and that the application is running, then try again.";
  return `Couldn’t complete the request. ${message}`;
}

export function installed(remote, projectId) {
  return Boolean(projectId && remote.backend.instances.some(
    (instance) => instance.scope === "project" && instance.projectId === projectId,
  ));
}

export default function activate(remote) {
  remote.ui.register(remote.slots.chatHeaderActions, (host, context) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scheduled-tasks-trigger";
    button.innerHTML = ICON;
    button.setAttribute("aria-label", "Scheduled tasks");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.title = "View scheduled tasks";
    let popup;
    const toggle = () => {
      if (popup) { popup.close(); return; }
      popup = openTasks(remote, context, button, () => {
        popup = undefined;
        button.setAttribute("aria-expanded", "false");
      });
      button.setAttribute("aria-expanded", "true");
    };
    button.addEventListener("click", toggle);
    host.append(button);
    return () => { popup?.close(); button.removeEventListener("click", toggle); };
  }, {
    when: (context) => Boolean(context.chatId && installed(remote, context.projectId)),
  });
}

export function openTasks(remote, context, anchor, onClose = () => {}) {
  const openPopup = anchor ? (options) => {
    const panel = document.createElement("div");
    panel.className = "scheduled-tasks-popover";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", options.title);
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = options.title;
    const badge = document.createElement("span");
    badge.className = "scheduled-tasks-badge";
    badge.innerHTML = ICON;
    badge.setAttribute("aria-hidden", "true");
    const heading = document.createElement("div");
    const count = document.createElement("span");
    count.className = "scheduled-tasks-count";
    heading.append(title, count);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", "Close scheduled tasks");
    header.append(badge, heading, dismiss);
    const body = document.createElement("div");
    panel.append(header, body);
    document.body.append(panel);
    const cleanup = options.mount(body, { header, dismiss, count });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      cleanup?.();
      panel.remove();
      document.removeEventListener("keydown", key);
      onClose();
    };
    const key = (event) => { if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); } };
    dismiss.addEventListener("click", () => { close(); anchor.focus(); });
    document.addEventListener("keydown", key);
    dismiss.focus();
    return { body, close };
  } : remote.ui.openPopup;
  return openPopup({
    title: "Scheduled tasks", width: 360,
    mount: (body, chrome) => {
      body.classList.add("scheduled-tasks-panel");
      let closed = false;
      let loading = false;
      let showArchived = false;
      let renderedSnapshot;
      const target = { projectId: context.projectId };
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      const list = document.createElement("div");
      const archiveToggle = document.createElement("button");
      archiveToggle.type = "button";
      archiveToggle.className = "scheduled-tasks-action scheduled-tasks-archive-toggle";
      const archiveLabel = document.createElement("span");
      archiveLabel.className = "scheduled-tasks-archive-label";
      archiveLabel.textContent = "Show archived tasks";
      archiveToggle.append(
        actionIcon(ACTION_ICONS.Archive), archiveLabel,
        actionIcon('<path d="m6 9 6 6 6-6"/>', "scheduled-tasks-action-icon scheduled-tasks-archive-chevron"),
      );
      archiveToggle.setAttribute("aria-expanded", "false");
      const refresh = document.createElement("button");
      refresh.type = "button"; refresh.textContent = "Refresh";
      refresh.setAttribute("aria-label", "Refresh scheduled tasks");
      if (chrome) {
        refresh.textContent = "↻";
        chrome.header.insertBefore(refresh, chrome.dismiss);
        body.replaceChildren(status, list, archiveToggle);
      } else body.replaceChildren(status, refresh, list, archiveToggle);
      const action = (label, task, method, suffix = "", data, feedback = status) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scheduled-tasks-action";
        if (label === "Run now") button.classList.add("scheduled-tasks-action-primary");
        if (method === "DELETE") button.classList.add("scheduled-tasks-action-destructive");
        button.title = `${label}: ${task.name}`;
        const text = document.createElement("span");
        text.textContent = label;
        button.append(actionIcon(ACTION_ICONS[label]), text);
        button.addEventListener("click", async () => {
          if (method === "DELETE" && !window.confirm(`Delete ${task.name}?`)) return;
          button.disabled = true;
          feedback.textContent = "";
          try {
            await remote.backend.call(`tasks/${encodeURIComponent(task.id)}${suffix}`, {
              ...target, method, ...(data ? { body: data } : {}),
            });
            await load();
          } catch (error) { if (!closed) feedback.textContent = friendlyError(error); }
          finally { if (!closed) button.disabled = false; }
        });
        return button;
      };
      async function load(quiet = false) {
        if (closed || loading) return;
        loading = true; refresh.disabled = true; status.textContent = "";
        body.setAttribute("aria-busy", "true");
        if (!quiet) {
          renderedSnapshot = undefined;
          list.replaceChildren();
          if (chrome) {
            chrome.count.textContent = "";
            chrome.count.classList.add("scheduled-tasks-skeleton-count");
          }
          for (let index = 0; index < 3; index++) {
            const skeleton = document.createElement("section");
            skeleton.className = "scheduled-tasks-skeleton";
            skeleton.setAttribute("aria-hidden", "true");
            skeleton.innerHTML = '<span class="scheduled-tasks-skeleton-line scheduled-tasks-skeleton-title"></span><span class="scheduled-tasks-skeleton-line scheduled-tasks-skeleton-meta"></span><span class="scheduled-tasks-skeleton-line"></span><span class="scheduled-tasks-skeleton-line scheduled-tasks-skeleton-meta"></span><span class="scheduled-tasks-skeleton-actions"><i></i><i></i><i></i></span>';
            list.append(skeleton);
          }
        }
        try {
          const allTasks = await remote.backend.call("tasks", {
            ...target,
            query: { chatId: context.chatId },
          });
          if (closed) return;
          allTasks.sort((a, b) => a.id.localeCompare(b.id));
          const snapshot = JSON.stringify([showArchived, allTasks]);
          if (quiet && snapshot === renderedSnapshot) return;
          renderedSnapshot = snapshot;
          const archived = allTasks.filter(isArchived);
          const tasks = allTasks.filter((task) => showArchived || !isArchived(task));
          archiveLabel.textContent = `${showArchived ? "Hide" : "Show"} archived tasks${archived.length ? ` (${archived.length})` : ""}`;
          list.replaceChildren();
          if (chrome) chrome.count.textContent = tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : "No tasks";
          tasks.sort((a, b) => Number(isArchived(a)) - Number(isArchived(b)) || (a.nextRunAt || Infinity) - (b.nextRunAt || Infinity));
          for (const task of tasks) {
            const row = document.createElement("section");
            const title = document.createElement("h3"); title.textContent = task.name;
            const info = document.createElement("p");
            info.className = "scheduled-tasks-state";
            const state = taskState(task);
            info.textContent = isArchived(task) ? `Archived · ${state}` : state;
            if (task.activeRunId) info.textContent += " — waiting for the agent or running; updates automatically";
            const prompt = document.createElement("p"); prompt.textContent = task.prompt;
            const what = document.createElement("span");
            what.className = "scheduled-tasks-label";
            what.textContent = "What the agent will do";
            const when = document.createElement("p");
            when.className = "scheduled-tasks-when";
            when.textContent = scheduleSummary(task);
            const feedback = document.createElement("p");
            feedback.className = "scheduled-tasks-error";
            feedback.setAttribute("role", "alert");
            const actions = document.createElement("div");
            actions.className = "scheduled-tasks-actions";
            if (!isArchived(task) && (task.enabled || state === "Paused")) actions.append(action(task.enabled ? "Pause" : "Resume", task, "PATCH", "", { enabled: !task.enabled }, feedback));
            if (!isArchived(task) && !task.activeRunId) actions.append(action("Run now", task, "POST", "/run", undefined, feedback));
            if (!isArchived(task)) actions.append(action("Archive", task, "PATCH", "", { archived: true }, feedback));
            else if (state !== "Finished") actions.append(action("Restore", task, "PATCH", "", { archived: false }, feedback));
            actions.append(action("Delete", task, "DELETE", "", undefined, feedback));
            row.append(title, info, what, prompt, when);
            if (state === "Time has passed" || state === "Finished") {
              const note = document.createElement("p");
              note.className = "scheduled-tasks-note";
              note.textContent = isArchived(task) ? "No more automatic runs. Ask the agent to schedule it again." : "No more automatic runs. Run it now, or ask the agent to schedule it again.";
              row.append(note);
            }
            if (task.lastError && !task.activeRunId) feedback.textContent = `Last run: ${friendlyError(task.lastError)}`;
            row.append(feedback, actions); list.append(row);
          }
          status.textContent = "";
          if (!tasks.length) {
            const empty = document.createElement("section");
            empty.className = "scheduled-tasks-empty";
            const symbol = document.createElement("span");
            symbol.className = "scheduled-tasks-badge";
            symbol.innerHTML = ICON;
            symbol.setAttribute("aria-hidden", "true");
            const title = document.createElement("h3");
            title.textContent = "No scheduled tasks";
            const help = document.createElement("p");
            help.textContent = "Ask the agent to schedule work in this chat. It can create a one-time reminder or a recurring cron task.";
            const example = document.createElement("blockquote");
            example.textContent = "“Watch the deploy every 5 minutes and stop when it is healthy.”";
            empty.append(symbol, title, help, example);
            list.append(empty);
          }
        } catch (error) {
          if (!closed) {
            if (!quiet) list.replaceChildren();
            status.className = "scheduled-tasks-error";
            status.textContent = friendlyError(error) + " Use Refresh to retry.";
            if (chrome) chrome.count.textContent = "Unable to load tasks";
          }
        }
        finally {
          loading = false;
          if (!closed) {
            refresh.disabled = false;
            body.setAttribute("aria-busy", "false");
            chrome?.count.classList.remove("scheduled-tasks-skeleton-count");
          }
        }
      }
      const refreshTasks = () => { void load(); };
      const toggleArchived = () => {
        showArchived = !showArchived;
        archiveToggle.setAttribute("aria-expanded", String(showArchived));
        void load(true);
      };
      archiveToggle.addEventListener("click", toggleArchived);
      refresh.addEventListener("click", refreshTasks);
      const timer = setInterval(() => { void load(true); }, 3000);
      void load();
      return () => { closed = true; clearInterval(timer); archiveToggle.removeEventListener("click", toggleArchived); refresh.removeEventListener("click", refreshTasks); body.classList.remove("scheduled-tasks-panel"); };
    },
  });
}
