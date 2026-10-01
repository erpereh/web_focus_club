import type { Firestore } from "firebase-admin/firestore";

export const FCM_TOKENS_SUBCOLLECTION = "fcmTokens";

/**
 * FCM considers a token expired after 270 days without activity. The app
 * refreshes `updatedAt` on every launch with push enabled, so a token this
 * old belongs to an uninstalled app or an abandoned device.
 */
export const FCM_TOKEN_STALE_MS = 270 * 24 * 60 * 60 * 1000;

/** Owner uid of a `users/{uid}/fcmTokens/{token}` document path. */
export function tokenOwnerUid(path: string): string | undefined {
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === "users" && parts[2] === FCM_TOKENS_SUBCOLLECTION
    ? parts[1]
    : undefined;
}

/**
 * A device token belongs to the account that registered it last. Removes the
 * same token from every other account, so a shared or handed-over phone never
 * receives the previous customer's notices (even if that customer signed out
 * without the app being able to unregister, e.g. an old build or a crash).
 * Returns the number of removed registrations.
 */
export async function claimFcmTokenForUser(db: Firestore, uid: string, token: string): Promise<number> {
  if (!uid || !token) return 0;
  const snap = await db.collectionGroup(FCM_TOKENS_SUBCOLLECTION).where("token", "==", token).get();
  const others = snap.docs.filter((docSnap) => {
    const owner = tokenOwnerUid(docSnap.ref.path);
    return owner !== undefined && owner !== uid;
  });
  await Promise.all(others.map((docSnap) => docSnap.ref.delete()));
  return others.length;
}

function updatedAtMillis(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (value &&typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? undefined : millis;
  }
  return undefined;
}

/**
 * Removes device registrations not refreshed for {@link FCM_TOKEN_STALE_MS}.
 * Tokens rejected by FCM are already pruned after a failed send.
 */
export async function pruneStaleFcmTokens(db: Firestore, now: Date, limit = 500): Promise<number> {
  const cutoff = now.getTime() - FCM_TOKEN_STALE_MS;
  const snap = await db.collectionGroup(FCM_TOKENS_SUBCOLLECTION)
    .where("updatedAt", "<", new Date(cutoff))
    .limit(limit)
    .get();
  const stale = snap.docs.filter((docSnap) => {
    const millis = updatedAtMillis((docSnap.data() as { updatedAt?: unknown }).updatedAt);
    return millis !== undefined && millis < cutoff;
  });
  await Promise.all(stale.map((docSnap) => docSnap.ref.delete()));
  return stale.length;
}
