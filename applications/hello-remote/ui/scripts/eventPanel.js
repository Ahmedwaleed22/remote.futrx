import { mountInspectionRefresh } from "./inspectionRefresh.js";

export function mountEventPanel(host, backend, target, isDisposed) {
  const refresh = host.querySelector("[data-event-refresh]");
  const status = host.querySelector("[data-event-status]");
  const facts = host.querySelector("[data-event-facts]");

  const setFact = (name, value) => {
    host.querySelector(`[data-event-${name}]`).textContent = value;
  };
  const show = (activity) => {
    setFact("publisher", activity.publisherReady ? "Ready" : "Not initialized");
    setFact("received", String(activity.received ?? 0));
    setFact("last", eventSummary(activity.lastEvent));
    setFact("payload", payloadSummary(activity.lastEvent));
    status.textContent = activity.lastEvent
      ? "Latest subscribed event received by this backend process."
      : "No subscribed events received by this backend process yet.";
    facts.hidden = false;
  };

  return mountInspectionRefresh({
    refresh,
    isDisposed,
    load: () => backend.call("events", target),
    onLoading: () => {
      status.textContent = "Reading backend event activity…";
    },
    onSuccess: show,
    onFailure: (error) => {
      facts.hidden = true;
      status.textContent = `Event inspection failed: ${error.message}`;
    },
  });
}

export function eventSummary(event) {
  if (!event) return "None yet";
  const publisher = event.source?.publisher || "unknown publisher";
  const name = event.name || "unknown event";
  const version = Number.isInteger(event.version) ? `v${event.version}` : "unknown version";
  return `${publisher} · ${name} · ${version}`;
}

export function payloadSummary(event) {
  if (!event || event.payload == null) return "None";
  if (typeof event.payload === "string") return event.payload;
  try {
    return JSON.stringify(event.payload);
  } catch {
    return "Unreadable payload";
  }
}
