import assert from "node:assert/strict";
import test from "node:test";

import {
  eventSummary,
  mountEventPanel,
  payloadSummary,
} from "./eventPanel.js";

test("summarizes received event identity and payload", () => {
  const event = {
    source: { publisher: "remote.applications" },
    name: "installed",
    version: 1,
    payload: { applicationId: "hello-remote" },
  };
  assert.equal(
    eventSummary(event),
    "remote.applications · installed · v1"
  );
  assert.equal(payloadSummary(event), '{"applicationId":"hello-remote"}');
  assert.equal(eventSummary(undefined), "None yet");
  assert.equal(payloadSummary(undefined), "None");
});

test("loads event activity and removes its refresh listener on cleanup", async () => {
  const elements = eventElements();
  const calls = [];
  const activity = {
    publisherReady: true,
    received: 3,
    lastEvent: {
      source: { publisher: "applications.hello-remote.greetings" },
      name: "greeted",
      version: 1,
      payload: { visits: 4 },
    },
  };
  const backend = {
    call: (path, target) => {
      calls.push([path, target]);
      return Promise.resolve(activity);
    },
  };
  const target = { projectId: "project-1" };

  const dispose = mountEventPanel(elements.host, backend, target, () => false);
  assert.equal(elements.refresh.disabled, true);
  assert.equal(elements.status.textContent, "Reading backend event activity…");

  await new Promise(setImmediate);
  assert.deepEqual(calls, [["events", target]]);
  assert.equal(elements.refresh.disabled, false);
  assert.equal(elements.facts.hidden, false);
  assert.equal(elements.fields.get("publisher").textContent, "Ready");
  assert.equal(elements.fields.get("received").textContent, "3");
  assert.equal(
    elements.fields.get("last").textContent,
    "applications.hello-remote.greetings · greeted · v1"
  );
  assert.equal(elements.fields.get("payload").textContent, '{"visits":4}');

  dispose();
  elements.refresh.dispatchEvent(new Event("click"));
  assert.equal(calls.length, 1);
});

function eventElements() {
  const refresh = new EventTarget();
  refresh.disabled = false;
  const status = { textContent: "" };
  const facts = { hidden: true };
  const fields = new Map(
    ["publisher", "received", "last", "payload"].map((name) => [
      name,
      { textContent: "" },
    ])
  );
  return {
    refresh,
    status,
    facts,
    fields,
    host: {
      querySelector(selector) {
        if (selector === "[data-event-refresh]") return refresh;
        if (selector === "[data-event-status]") return status;
        if (selector === "[data-event-facts]") return facts;
        return fields.get(selector.match(/^\[data-event-(.+)]$/)?.[1]);
      },
    },
  };
}
