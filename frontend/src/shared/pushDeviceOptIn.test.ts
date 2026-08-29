import assert from "node:assert/strict";
import test from "node:test";

import { pushDeviceOptIn } from "./pushDeviceOptIn.ts";

function useMemoryStorage(): void {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
  });
}

test("an account that turned notifications on is remembered for this browser", () => {
  useMemoryStorage();

  pushDeviceOptIn.remember("Person@Example.com");

  assert.equal(pushDeviceOptIn.has("person@example.com"), true);
});

test("one account's opt-in never speaks for another in a shared browser", () => {
  useMemoryStorage();

  pushDeviceOptIn.remember("first@example.com");

  assert.equal(pushDeviceOptIn.has("second@example.com"), false);
});

test("turning notifications off stops the device from being restored", () => {
  useMemoryStorage();
  pushDeviceOptIn.remember("first@example.com");
  pushDeviceOptIn.remember("second@example.com");

  pushDeviceOptIn.forget("first@example.com");

  assert.equal(pushDeviceOptIn.has("first@example.com"), false);
  assert.equal(pushDeviceOptIn.has("second@example.com"), true);
});

test("an unusable store is not an opt-in", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });

  pushDeviceOptIn.remember("first@example.com");

  assert.equal(pushDeviceOptIn.has("first@example.com"), false);
});
