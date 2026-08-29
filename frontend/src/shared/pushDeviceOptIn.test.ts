import assert from "node:assert/strict";
import test from "node:test";

import { forgetOptIn, hasOptedIn, rememberOptIn } from "./pushDeviceOptIn.ts";

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

  rememberOptIn("Person@Example.com");

  assert.equal(hasOptedIn("person@example.com"), true);
});

test("one account's opt-in never speaks for another in a shared browser", () => {
  useMemoryStorage();

  rememberOptIn("first@example.com");

  assert.equal(hasOptedIn("second@example.com"), false);
});

test("turning notifications off stops the device from being restored", () => {
  useMemoryStorage();
  rememberOptIn("first@example.com");
  rememberOptIn("second@example.com");

  forgetOptIn("first@example.com");

  assert.equal(hasOptedIn("first@example.com"), false);
  assert.equal(hasOptedIn("second@example.com"), true);
});

test("an unusable store is not an opt-in", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });

  rememberOptIn("first@example.com");

  assert.equal(hasOptedIn("first@example.com"), false);
});
