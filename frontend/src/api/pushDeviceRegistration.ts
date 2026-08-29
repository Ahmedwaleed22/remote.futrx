import {
  reconcileSubscriptionOwnership,
  type EndpointSubscription,
} from "./pushSubscriptionOwnership.ts";

/** Where a device ended up after Remote tried to restore its registration. */
export type PushDeviceRegistration =
  /** This device holds a subscription the signed-in account owns. */
  | "registered"
  /** A subscription is present but the server could not confirm it yet. */
  | "unverified"
  /** This device receives nothing, and nothing may be created without asking. */
  | "absent";

/**
 * Everything the restore policy is allowed to touch. Passing the browser and
 * the server in as functions keeps the policy — which is the part that decides
 * whether a user gets asked for permission again — testable on its own.
 */
export interface PushDeviceEnvironment<T extends EndpointSubscription> {
  /** The subscription this browser currently holds, if any. */
  existing: T | null;
  /** Whether the endpoint was signed with the key the server signs with today. */
  matchesServerKey: (subscription: T) => boolean;
  /** Server answer for one endpoint; rejects when the server cannot answer. */
  ownsEndpoint: (endpoint: string) => Promise<boolean>;
  /** Whether this account already turned notifications on in this browser. */
  optedIn: boolean;
  /** True only when permission is already granted, so restoring never prompts. */
  permissionGranted: boolean;
  unsubscribeLocal: (subscription: T) => Promise<unknown>;
  forgetOnServer: (endpoint: string) => Promise<unknown>;
  subscribeLocal: () => Promise<T>;
  registerOnServer: (subscription: T) => Promise<unknown>;
}

/**
 * Restores what the user already agreed to, without ever asking again.
 *
 * A push subscription outlives neither a rotated VAPID key nor a push service
 * that retires an endpoint, and the server's record of it can disappear with a
 * restore of `DATA_DIR`. None of that is the user withdrawing consent, so when
 * this device is missing a usable subscription and permission is still granted,
 * a replacement is created and registered silently. A permission prompt only
 * ever comes from the user pressing "Turn on".
 */
export async function restoreDeviceRegistration<T extends EndpointSubscription>(
  environment: PushDeviceEnvironment<T>
): Promise<PushDeviceRegistration> {
  const existing = environment.existing;
  if (existing) {
    if (environment.matchesServerKey(existing)) {
      const ownership = await reconcileSubscriptionOwnership(
        existing,
        environment.ownsEndpoint,
        environment.unsubscribeLocal
      );
      if (ownership === "owned") return "registered";
      // Keep an unconfirmed registration exactly as it is: the server being
      // unreachable — mid-update, or offline — is not the user turning
      // notifications off, and discarding it here would cost the subscription.
      if (ownership === "unverified") return "unverified";
      // "foreign": already unsubscribed locally. Fall through and mint one for
      // the account that is actually signed in.
    } else {
      // Signed with a retired key, so the push service can never deliver to it.
      await environment.forgetOnServer(existing.endpoint);
      await environment.unsubscribeLocal(existing);
    }
  }

  if (!environment.optedIn || !environment.permissionGranted) return "absent";

  const created = await environment.subscribeLocal();
  await environment.registerOnServer(created);
  return "registered";
}
