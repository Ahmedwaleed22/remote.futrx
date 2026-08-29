// Which accounts asked for notifications in *this* browser.
//
// The browser's push subscription is not durable: a service restart, a deploy,
// or the push service rotating an endpoint can leave the device with nothing
// registered even though permission was never revoked. Remembering the opt-in
// locally is what lets the app restore the subscription silently instead of
// asking the user to allow notifications all over again.
//
// It is recorded per account because a browser subscription belongs to the
// whole origin: on a shared browser, one user's opt-in must never quietly turn
// notifications on for the next person who signs in.
//
// Leaf module: it owns one list in the browser's store and knows nothing about
// subscriptions, the server, or who is signed in.

import { STORAGE_KEYS } from "../config/storageKeys.ts";
import { readJson, removeString, writeJson } from "./browserStore.ts";

class PushDeviceOptIn {
  /** Whether this account turned notifications on in this browser before. */
  has(account: string): boolean {
    const wanted = this.#identify(account);
    return wanted !== "" && this.#accounts().includes(wanted);
  }

  /** Records that this account wants notifications on this device. */
  remember(account: string): void {
    const wanted = this.#identify(account);
    if (wanted === "") return;
    const known = this.#accounts();
    if (known.includes(wanted)) return;
    writeJson(STORAGE_KEYS.pushOptIn, [...known, wanted]);
  }

  /** Drops the opt-in, so nothing restores a device the user turned off. */
  forget(account: string): void {
    const wanted = this.#identify(account);
    const kept = this.#accounts().filter((entry) => entry !== wanted);
    if (kept.length === 0) {
      removeString(STORAGE_KEYS.pushOptIn);
      return;
    }
    writeJson(STORAGE_KEYS.pushOptIn, kept);
  }

  /** One spelling per account, so a re-typed address still matches. */
  #identify(account: string): string {
    return account.trim().toLowerCase();
  }

  /** The stored list, tolerating anything an older build may have left. */
  #accounts(): string[] {
    const stored = readJson(STORAGE_KEYS.pushOptIn);
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is string => typeof entry === "string");
  }
}

export const pushDeviceOptIn = new PushDeviceOptIn();
