import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { sanitizeEmailError } from "../email/brevo.js";
import { claimLedger, dispatchIdFor, markLedgerFailed, markLedgerSent } from "./ledger.js";

export const PUSH_DISPATCH_COLLECTION = "push_dispatches";
export const PUSH_DISPATCH_LEASE_MS = 2 * 60 * 1000;
const MULTICAST_LIMIT = 500;

/**
 * Android notification channel created by the Flutter app at startup
 * (`MainActivity.kt`) and declared as the FCM default channel in its
 * manifest. Builds that do not have it yet fall back to the manifest default.
 */
export const ANDROID_NOTIFICATION_CHANNEL_ID = "focus_club_default";

/** Platform delivery options shared by every customer push. */
export const PUSH_PLATFORM_OPTIONS = {
  android: {
    priority: "high" as const,
    notification: {
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      sound: "default",
    },
  },
  apns: {
    headers: { "apns-priority": "10", "apns-push-type": "alert" },
    payload: { aps: { sound: "default" } },
  },
};

export interface PushMessage {
  tokens: string[];
  notification: { title: string; body: string };
  data: Record<string, string>;
  android?: typeof PUSH_PLATFORM_OPTIONS.android;
  apns?: typeof PUSH_PLATFORM_OPTIONS.apns;
}

/** Minimal slice of firebase-admin Messaging, injectable for tests. */
export interface PushMessaging {
  sendEachForMulticast(message: PushMessage): Promise<{
    successCount: number;
    failureCount: number;
    responses: Array<{ success: boolean; error?: { code?: string } }>;
  }>;
}

export interface PushContent {
  notification: { title: string; body: string };
  data: Record<string, string>;
}

export type PushOutcome =
  | { status: "sent"; successCount: number }
  | { status: "skipped"; reason: "push_disabled" | "no_tokens" | "already_sent" | "in_progress" };

interface UserPushProfile {
  pushNotificationsEnabled?: boolean;
}

interface TokenDoc {
  token?: unknown;
}

export function isInvalidFcmTokenError(code?: string): boolean {
  return code === "messaging/registration-token-not-registered"
    || code === "messaging/invalid-registration-token";
}

async function loadTokens(db: Firestore, uid: string): Promise<Array<{ ref: DocumentReference; token: string }> | null> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const user = userSnap.exists ? userSnap.data() as UserPushProfile : undefined;
  if (!user || user.pushNotificationsEnabled !== true) return null;

  const tokenSnap = await userRef.collection("fcmTokens").get();
  return tokenSnap.docs
    .map((docSnap) => {
      const tokenDoc = docSnap.data() as TokenDoc;
      const token = typeof tokenDoc.token === "string" ? tokenDoc.token.trim() : "";
      return token ? { ref: docSnap.ref, token } : null;
    })
    .filter((entry): entry is { ref: DocumentReference; token: string } => entry !== null);
}

/**
 * Sends a push to every registered device of `uid` at most once per dedupe
 * key. Respects `pushNotificationsEnabled`, prunes invalid tokens and throws
 * when no device accepted the message so the caller can retry later.
 */
export async function sendPushOnce({
  db,
  messaging,
  uid,
  dedupeKey,
  content,
  now = () => Date.now(),
  leaseMs = PUSH_DISPATCH_LEASE_MS,
}: {
  db: Firestore;
  messaging: PushMessaging;
  uid: string;
  dedupeKey: string;
  content: PushContent;
  now?: () => number;
  leaseMs?: number;
}): Promise<PushOutcome> {
  const tokens = await loadTokens(db, uid);
  if (tokens === null) return { status: "skipped", reason: "push_disabled" };
  if (tokens.length === 0) return { status: "skipped", reason: "no_tokens" };

  const dispatchId = dispatchIdFor(dedupeKey);
  const claim = await claimLedger(db, PUSH_DISPATCH_COLLECTION, dispatchId, {
    uid,
    type: content.data.type ?? null,
    event: content.data.event ?? null,
  }, now(), leaseMs);
  if (!claim.claimed) return { status: "skipped", reason: claim.reason };

  try {
    let successCount = 0;
    let lastErrorCode = "";
    for (let index = 0; index < tokens.length; index += MULTICAST_LIMIT) {
      const batch = tokens.slice(index, index + MULTICAST_LIMIT);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map((entry) => entry.token),
        notification: content.notification,
        data: content.data,
        ...PUSH_PLATFORM_OPTIONS,
      });
      successCount += response.successCount;
      await Promise.all(response.responses.map((sendResponse, responseIndex) => {
        const code = sendResponse.error?.code;
        if (!sendResponse.success && code) lastErrorCode = code;
        if (!sendResponse.success && isInvalidFcmTokenError(code)) {
          return batch[responseIndex].ref.delete();
        }
        return Promise.resolve();
      }));
    }

    if (successCount === 0) {
      throw new Error(`FCM delivered to no device${lastErrorCode ? ` (${lastErrorCode})` : ""}.`);
    }

    await markLedgerSent(claim.ref, now(), { successCount });
    return { status: "sent", successCount };
  } catch (error) {
    const message = sanitizeEmailError(error, "Unknown push error.");
    try {
      await markLedgerFailed(claim.ref, now(), message);
    } catch (writeError) {
      console.error("[Push] Failed to store dispatch failure", { dispatchId, error: sanitizeEmailError(writeError) });
    }
    throw new Error(message);
  }
}
