import assert from "node:assert/strict";
import test from "node:test";

import { restoreDeviceRegistration } from "./pushDeviceRegistration.ts";

interface Recorder {
  unsubscribed: string[];
  forgotten: string[];
  registered: string[];
  created: number;
}

function environment(overrides: Record<string, unknown> = {}) {
  const recorder: Recorder = {
    unsubscribed: [],
    forgotten: [],
    registered: [],
    created: 0,
  };
  const base = {
    existing: { endpoint: "https://push.example.com/device" },
    matchesServerKey: () => true,
    ownsEndpoint: async () => true,
    optedIn: true,
    permissionGranted: true,
    unsubscribeLocal: async (subscription: { endpoint: string }) => {
      recorder.unsubscribed.push(subscription.endpoint);
    },
    forgetOnServer: async (endpoint: string) => {
      recorder.forgotten.push(endpoint);
    },
    subscribeLocal: async () => {
      recorder.created++;
      return { endpoint: `https://push.example.com/fresh-${recorder.created}` };
    },
    registerOnServer: async (subscription: { endpoint: string }) => {
      recorder.registered.push(subscription.endpoint);
    },
  };
  return { environment: { ...base, ...overrides }, recorder };
}

test("a confirmed device is left exactly as it is", async () => {
  const { environment: env, recorder } = environment();

  assert.equal(await restoreDeviceRegistration(env), "registered");
  assert.deepEqual(recorder.unsubscribed, []);
  assert.equal(recorder.created, 0);
});

test("a device the server cannot confirm keeps its subscription", async () => {
  const { environment: env, recorder } = environment({
    ownsEndpoint: async () => {
      throw new Error("502 while the backend restarts");
    },
  });

  assert.equal(await restoreDeviceRegistration(env), "unverified");
  assert.deepEqual(recorder.unsubscribed, []);
  assert.equal(recorder.created, 0);
});

test("a subscription the server lost is recreated without asking again", async () => {
  const { environment: env, recorder } = environment({ ownsEndpoint: async () => false });

  assert.equal(await restoreDeviceRegistration(env), "registered");
  assert.deepEqual(recorder.unsubscribed, ["https://push.example.com/device"]);
  assert.deepEqual(recorder.registered, ["https://push.example.com/fresh-1"]);
});

test("a subscription signed with a retired key is replaced on both sides", async () => {
  const { environment: env, recorder } = environment({ matchesServerKey: () => false });

  assert.equal(await restoreDeviceRegistration(env), "registered");
  assert.deepEqual(recorder.forgotten, ["https://push.example.com/device"]);
  assert.deepEqual(recorder.unsubscribed, ["https://push.example.com/device"]);
  assert.deepEqual(recorder.registered, ["https://push.example.com/fresh-1"]);
});

test("a device with nothing registered is restored from a remembered opt-in", async () => {
  const { environment: env, recorder } = environment({ existing: null });

  assert.equal(await restoreDeviceRegistration(env), "registered");
  assert.deepEqual(recorder.registered, ["https://push.example.com/fresh-1"]);
});

test("an account that never opted in on this device is left alone", async () => {
  const { environment: env, recorder } = environment({ existing: null, optedIn: false });

  assert.equal(await restoreDeviceRegistration(env), "absent");
  assert.equal(recorder.created, 0);
});

test("restoring never subscribes before permission is granted", async () => {
  const { environment: env, recorder } = environment({
    existing: null,
    permissionGranted: false,
  });

  assert.equal(await restoreDeviceRegistration(env), "absent");
  assert.equal(recorder.created, 0);
});
