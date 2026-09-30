import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { CustomerNotification } from "./types.js";

export const NOTIFICATIONS_SUBCOLLECTION = "notifications";

/**
 * Document stored in `users/{uid}/notifications/{notificationId}`. Uses the
 * same `type` (category) / `event` contract as the FCM data payload.
 */
export function buildHistoryDocument(
  notification: CustomerNotification,
  nowMillis: number,
): Record<string, unknown> {
  const { related } = notification;
  return {
    type: notification.category,
    event: notification.event,
    title: notification.title,
    body: notification.body,
    createdAt: Timestamp.fromMillis(nowMillis),
    read: false,
    appointmentId: related.appointmentId ?? null,
    bonoId: related.bonoId ?? null,
    conversationId: related.conversationId ?? null,
    seriesId: related.seriesId ?? null,
    appointmentIds: related.appointmentIds ?? [],
    status: related.status ?? null,
    navigation: notification.navigation,
  };
}

/** Creates the history entry once; a second call with the same id is a no-op. */
export async function recordNotification(
  db: Firestore,
  notificationId: string,
  notification: CustomerNotification,
  nowMillis: number,
): Promise<"created" | "exists"> {
  const ref = db.collection("users").doc(notification.uid)
    .collection(NOTIFICATIONS_SUBCOLLECTION).doc(notificationId);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists) return "exists";
    transaction.set(ref, buildHistoryDocument(notification, nowMillis));
    return "created";
  });
}
