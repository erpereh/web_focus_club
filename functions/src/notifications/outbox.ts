import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { type AppointmentSlotLike, getAppointmentEffectiveSlot } from "../appointmentLifecycle.js";
import type { SeriesNotificationEvent } from "./types.js";

export const NOTIFICATION_OUTBOX_COLLECTION = "notification_outbox";

export interface OutboxSession {
  date: string;
  time: string;
}

/**
 * One grouped customer notice for a multi-appointment (recurring) operation.
 * Written in the same transaction as the appointment changes, so the notice
 * is sent exactly when the operation commits — never per appointment.
 */
export interface NotificationOutboxEntry {
  userId: string;
  event: SeriesNotificationEvent;
  seriesId: string;
  appointmentIds: string[];
  sessions: OutboxSession[];
  cancelledSessions: OutboxSession[];
  customerName: string;
  customerEmail: string;
  actor: "admin" | "customer";
  createdAt: string;
  /**
   * Minutes returned to the bono in the same transaction. Customer copy only
   * mentions a refund when this is positive.
   */
  refundedMinutes?: number;
}

export interface NotificationOperation {
  operationId: string;
  ref: DocumentReference;
}

/** Allocates the operation id to stamp on every appointment it changes. */
export function newNotificationOperation(db: Firestore): NotificationOperation {
  const ref = db.collection(NOTIFICATION_OUTBOX_COLLECTION).doc();
  return { operationId: ref.id, ref };
}

interface SessionSource {
  approvedSlot?: AppointmentSlotLike | null;
  preferredSlots?: AppointmentSlotLike[];
  date?: string;
  time?: string;
}

export function sessionOf(appointment: SessionSource): OutboxSession | undefined {
  const slot = getAppointmentEffectiveSlot(appointment);
  return slot ? { date: slot.date, time: slot.time } : undefined;
}

export function sessionsOf(appointments: SessionSource[]): OutboxSession[] {
  return appointments
    .map(sessionOf)
    .filter((session): session is OutboxSession => Boolean(session))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

export function writeNotificationOutbox(
  transaction: Transaction,
  operation: NotificationOperation,
  entry: Omit<NotificationOutboxEntry, "cancelledSessions" | "customerName" | "customerEmail"> & Partial<Pick<NotificationOutboxEntry, "cancelledSessions" | "customerName" | "customerEmail">>,
): void {
  if (entry.appointmentIds.length === 0 && (entry.cancelledSessions ?? []).length === 0) return;
  transaction.create(operation.ref, {
    cancelledSessions: [],
    customerName: "",
    customerEmail: "",
    ...entry,
  } satisfies NotificationOutboxEntry);
}
