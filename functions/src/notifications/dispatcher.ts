import type { Firestore } from "firebase-admin/firestore";
import { sanitizeEmailError } from "../email/brevo.js";
import { sendEmailOnce } from "../email/dispatch.js";
import type { EmailClient, EmailMessage } from "../email/types.js";
import { recordNotification } from "./history.js";
import { dispatchIdFor } from "./ledger.js";
import { type PushContent, type PushMessaging, sendPushOnce } from "./push.js";
import type {
  ChannelName,
  ChannelResult,
  CustomerNotification,
  DeliveryOutcome,
  DeliveryStatus,
} from "./types.js";

export const NOTIFICATION_DELIVERY_COLLECTION = "notification_deliveries";
export const DELIVERY_MAX_ATTEMPTS = 8;
export const DELIVERY_BASE_BACKOFF_MS = 5 * 60 * 1000;
export const DELIVERY_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** A delivery left `pending` longer than this is assumed crashed and retried. */
export const DELIVERY_STALE_PENDING_MS = 10 * 60 * 1000;

export interface NotifyDeps {
  db: Firestore;
  messaging: PushMessaging;
  /** Lazy: push/history-only notices never need the Brevo secret. */
  getEmailClient: () => EmailClient;
  now?: () => number;
}

interface StoredChannel {
  status: ChannelResult["status"];
  lastError?: string | null;
  messageId?: string | null;
}

export interface DeliveryDocument {
  uid: string;
  dedupeKey: string;
  type: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  /**
   * Due time of the next run. Only `pending`/`retrying` deliveries carry a
   * number; terminal ones store `null`, so a range query on this single field
   * returns exactly the due work (no composite index needed).
   */
  nextAttemptAtMillis: number | null;
  createdAtMillis: number;
  /** Appointments this notice is about; lets reminders see recent notices. */
  appointmentIds: string[];
  notification: CustomerNotification;
  push: PushContent | null;
  channels: Partial<Record<ChannelName, StoredChannel>>;
}

export function notificationIdFor(dedupeKey: string): string {
  return dispatchIdFor(dedupeKey);
}

/** FCM data payload: only strings, same contract as the history document. */
export function buildPushContent(notification: CustomerNotification, notificationId: string): PushContent {
  const { related } = notification;
  const data: Record<string, string> = {
    type: notification.category,
    event: notification.event,
    notificationId,
    route: notification.navigation.route,
  };
  if (related.appointmentId) data.appointmentId = related.appointmentId;
  if (related.status) data.status = related.status;
  if (related.bonoId) data.bonoId = related.bonoId;
  if (related.conversationId) data.conversationId = related.conversationId;
  if (related.seriesId) data.seriesId = related.seriesId;
  if (related.appointmentIds?.length) data.appointmentIds = related.appointmentIds.join(",");
  return { notification: { title: notification.title, body: notification.body }, data };
}

export function deliveryBackoffMs(attempts: number): number {
  return Math.min(DELIVERY_BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), DELIVERY_MAX_BACKOFF_MS);
}

function initialChannels(notification: CustomerNotification): DeliveryDocument["channels"] {
  return {
    history: { status: "pending" },
    ...(notification.channels.push ? { push: { status: "pending" } } : {}),
    ...(notification.channels.email ? { email: { status: "pending" } } : {}),
  };
}

function isDone(channel: StoredChannel | undefined): boolean {
  return !channel || channel.status === "sent" || channel.status === "skipped";
}

async function runChannel(
  name: ChannelName,
  deps: NotifyDeps,
  notificationId: string,
  delivery: DeliveryDocument,
): Promise<StoredChannel> {
  const now = deps.now ?? (() => Date.now());
  const { notification } = delivery;
  try {
    if (name === "history") {
      const result = await recordNotification(deps.db, notificationId, notification, now());
      return { status: result === "owner_missing" ? "skipped" : "sent", lastError: null };
    }
    if (name === "push") {
      const outcome = await sendPushOnce({
        db: deps.db,
        messaging: deps.messaging,
        uid: notification.uid,
        dedupeKey: `${notification.dedupeKey}:push`,
        content: delivery.push ?? buildPushContent(notification, notificationId),
        now,
      });
      if (outcome.status === "skipped" && outcome.reason === "in_progress") {
        return { status: "failed", lastError: "Push send in progress elsewhere." };
      }
      return { status: outcome.status === "sent" ? "sent" : "skipped", lastError: null };
    }
    const message = notification.channels.email as EmailMessage;
    const outcome = await sendEmailOnce({
      db: deps.db,
      client: deps.getEmailClient(),
      dedupeKey: `${notification.dedupeKey}:email`,
      message,
      context: { relatedId: notification.related.appointmentId ?? notification.related.bonoId, recipientType: "customer" },
      now,
    });
    if (outcome.status === "skipped" && outcome.reason === "in_progress") {
      return { status: "failed", lastError: "Email send in progress elsewhere." };
    }
    return {
      status: "sent",
      lastError: null,
      messageId: outcome.status === "sent" ? outcome.messageId : null,
    };
  } catch (error) {
    return { status: "failed", lastError: sanitizeEmailError(error) };
  }
}

/**
 * Runs every channel of a stored delivery that has not succeeded yet, then
 * records per-channel results. Failed channels are scheduled for a later
 * retry; channels that already succeeded are never repeated (their own
 * ledgers also guard against it).
 */
export async function runDelivery(
  deps: NotifyDeps,
  notificationId: string,
  delivery: DeliveryDocument,
): Promise<DeliveryOutcome> {
  const now = deps.now ?? (() => Date.now());
  const channels = { ...delivery.channels };
  const order: ChannelName[] = ["history", "push", "email"];
  // The customer was deleted after the notice was queued: never write into
  // a removed account or keep emailing it.
  const ownerExists = await customerExists(deps.db, delivery.uid);

  for (const name of order) {
    if (!(name in channels) || isDone(channels[name])) continue;
    channels[name] = ownerExists
      ? await runChannel(name, deps, notificationId, delivery)
      : { status: "skipped", lastError: null };
  }

  const failed = order.filter((name) => channels[name]?.status === "failed");
  const attempts = delivery.attempts + 1;
  let status: DeliveryStatus = "complete";
  let nextAttemptAtMillis: number | null = null;
  if (failed.length > 0) {
    status = attempts >= DELIVERY_MAX_ATTEMPTS ? "failed" : "retrying";
    nextAttemptAtMillis = status === "retrying" ? now() + deliveryBackoffMs(attempts) : null;
    const log = status === "failed" ? console.error : console.warn;
    log("[Notify] Delivery channels failed", {
      notificationId,
      event: delivery.event,
      failed,
      attempts,
      status,
      errors: failed.map((name) => channels[name]?.lastError),
    });
  }

  await deps.db.collection(NOTIFICATION_DELIVERY_COLLECTION).doc(notificationId).set({
    channels,
    status,
    attempts,
    nextAttemptAtMillis,
    updatedAt: new Date(now()).toISOString(),
  }, { merge: true });

  if (status === "complete") {
    console.log("[Notify] Delivered", {
      notificationId,
      type: delivery.type,
      event: delivery.event,
      channels: Object.fromEntries(order.filter((n) => channels[n]).map((n) => [n, channels[n]?.status])),
      emailMessageId: channels.email?.messageId ?? undefined,
    });
  }

  return {
    notificationId,
    status,
    channels: Object.fromEntries(order
      .filter((name) => channels[name])
      .map((name) => [name, {
        status: channels[name]!.status,
        ...(channels[name]!.lastError ? { error: channels[name]!.lastError! } : {}),
        ...(channels[name]!.messageId ? { messageId: channels[name]!.messageId! } : {}),
      }])),
  };
}

async function customerExists(db: Firestore, uid: string): Promise<boolean> {
  if (!uid) return false;
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists;
}

function relatedAppointmentIds(notification: CustomerNotification): string[] {
  const ids = new Set(notification.related.appointmentIds ?? []);
  if (notification.related.appointmentId) ids.add(notification.related.appointmentId);
  return [...ids];
}

/**
 * Central entry point: persists the delivery spec (idempotent per dedupe key),
 * then writes history, sends push and email. Safe to call again for the same
 * dedupe key: finished deliveries are not repeated. Customers without a
 * `users/{uid}` document (deleted accounts) are not notified at all.
 */
export async function notifyCustomer(deps: NotifyDeps, notification: CustomerNotification): Promise<DeliveryOutcome> {
  const now = deps.now ?? (() => Date.now());
  const notificationId = notificationIdFor(notification.dedupeKey);
  const ref = deps.db.collection(NOTIFICATION_DELIVERY_COLLECTION).doc(notificationId);

  if (!(await customerExists(deps.db, notification.uid))) {
    console.log("[Notify] Skipped: customer account no longer exists", {
      notificationId,
      event: notification.event,
    });
    return {
      notificationId,
      status: "complete",
      channels: Object.fromEntries(Object.keys(initialChannels(notification))
        .map((name) => [name, { status: "skipped" as const }])),
    };
  }

  const delivery = await deps.db.runTransaction<DeliveryDocument>(async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists) return snap.data() as DeliveryDocument;
    const created: DeliveryDocument = {
      uid: notification.uid,
      dedupeKey: notification.dedupeKey,
      type: notification.category,
      event: notification.event,
      status: "pending",
      attempts: 0,
      // Acts as a lease: if this run crashes, the retry sweep picks it up.
      nextAttemptAtMillis: now() + DELIVERY_STALE_PENDING_MS,
      createdAtMillis: now(),
      appointmentIds: relatedAppointmentIds(notification),
      notification,
      push: notification.channels.push ? buildPushContent(notification, notificationId) : null,
      channels: initialChannels(notification),
    };
    // JSON round-trip drops `undefined`, which Firestore rejects.
    const stored = JSON.parse(JSON.stringify(created)) as DeliveryDocument;
    transaction.set(ref, { ...stored, createdAt: new Date(now()).toISOString() });
    return stored;
  });

  if (delivery.status === "complete" || delivery.status === "failed") {
    return {
      notificationId,
      status: delivery.status,
      channels: Object.fromEntries(Object.entries(delivery.channels)
        .map(([name, channel]) => [name, { status: channel!.status }])),
    };
  }
  return runDelivery(deps, notificationId, delivery);
}

/** Trigger-friendly variant: never throws; failures stay persisted for retry. */
export async function notifyCustomerSafely(
  deps: NotifyDeps,
  notification: CustomerNotification,
): Promise<DeliveryOutcome | undefined> {
  try {
    return await notifyCustomer(deps, notification);
  } catch (error) {
    console.error("[Notify] Failed to start delivery", {
      event: notification.event,
      dedupeKey: notification.dedupeKey,
      error: sanitizeEmailError(error),
    });
    return undefined;
  }
}

/**
 * Deletes the notification ledger entries of a removed customer. The account
 * itself (including `notifications` and `fcmTokens`) is removed with a
 * recursive delete by the caller. Returns the number of deleted documents.
 */
export async function purgeCustomerDeliveries(db: Firestore, uid: string): Promise<number> {
  const snap = await db.collection(NOTIFICATION_DELIVERY_COLLECTION).where("uid", "==", uid).get();
  await Promise.all(snap.docs.map((docSnap) => docSnap.ref.delete()));
  return snap.docs.length;
}

/**
 * Retries deliveries whose failed channels are due, plus deliveries stuck in
 * `pending` (the process died mid-send), oldest due first. Only due documents
 * are read, so deliveries scheduled further in the future can never crowd
 * out the ones that are due. Returns the number processed.
 */
export async function retryDueDeliveries(deps: NotifyDeps, limit = 100): Promise<number> {
  const now = deps.now ?? (() => Date.now());
  const snap = await deps.db.collection(NOTIFICATION_DELIVERY_COLLECTION)
    .where("nextAttemptAtMillis", "<=", now())
    .orderBy("nextAttemptAtMillis", "asc")
    .limit(limit)
    .get();
  const due = snap.docs
    .map((docSnap) => ({ id: docSnap.id, delivery: docSnap.data() as DeliveryDocument }))
    .filter(({ delivery }) => delivery.status === "retrying" || delivery.status === "pending");

  for (const { id, delivery } of due) {
    try {
      await runDelivery(deps, id, delivery);
    } catch (error) {
      console.error("[Notify] Retry failed", { notificationId: id, error: sanitizeEmailError(error) });
    }
  }
  return due.length;
}
