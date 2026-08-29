// Which accounts asked for notifications in *this* browser.
//
// The browser's push subscription is not durable: a service restart, a deploy,
// or the push service rotating an endpoint can leave the device with nothing
// registered even though permission was never revoked. Remembering the opt-in
// locally is what lets the app restore the subscription silently instead of
// asking the user to allow notifications all over again.
//
// It is keyed by account because a browser subscription belongs to the whole
// origin: on a shared browser, one user's opt-in must never quietly turn
// notifications on for the next person who signs in.

import { STORAGE_KEYS } from "../config/storageKeys.ts";
import { readJson, removeString, writeJson } from "./browserStore.ts";

function normalize(account: string): string {
  return account.trim().toLowerCase();
}

function accounts(): string[] {
  const stored = readJson(STORAGE_KEYS.pushOptIn);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is string => typeof entry === "string");
}

/** Whether this account turned notifications on in this browser before. */
export function hasOptedIn(account: string): boolean {
  const wanted = normalize(account);
  if (!wanted) return false;
  return accounts().includes(wanted);
}

/** Records that this account wants notifications on this device. */
export function rememberOptIn(account: string): void {
  const wanted = normalize(account);
  if (!wanted) return;
  const known = accounts();
  if (known.includes(wanted)) return;
  writeJson(STORAGE_KEYS.pushOptIn, [...known, wanted]);
}

/** Drops the opt-in, so nothing restores a device the user turned off. */
export function forgetOptIn(account: string): void {
  const wanted = normalize(account);
  const kept = accounts().filter((entry) => entry !== wanted);
  if (kept.length === 0) {
    removeString(STORAGE_KEYS.pushOptIn);
    return;
  }
  writeJson(STORAGE_KEYS.pushOptIn, kept);
}
