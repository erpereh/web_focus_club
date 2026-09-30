import {
  type AppointmentSlotLike,
  type EffectiveAppointmentSlot,
  getAppointmentEffectiveSlot,
  madridCivilSlotToInstant,
} from "../appointmentLifecycle.js";
import type { AppointmentNotificationEvent } from "./types.js";

/** Customer-visible subset of an appointment document. */
export interface NotifiableAppointment {
  userId?: string;
  name?: string;
  email?: string;
  status?: string;
  approvedSlot?: AppointmentSlotLike | null;
  preferredSlots?: AppointmentSlotLike[];
  date?: string;
  time?: string;
  assignedTrainer?: string | null;
  duration?: string | number;
  sessionType?: string | null;
  serviceType?: string;
  recurrenceSeriesId?: string;
  notificationOperationId?: string;
}

export interface AppointmentChange {
  event: AppointmentNotificationEvent;
  /** Appointment whose data describes the notice (after, or before on delete). */
  appointment: NotifiableAppointment;
  previousSlot?: EffectiveAppointmentSlot;
  status: string;
}

const ACTIVE_STATUSES = new Set(["pending", "approved"]);

function slotKey(slot: EffectiveAppointmentSlot | undefined): string {
  return slot ? `${slot.date}T${slot.time}` : "";
}

function visibleDetailsChanged(before: NotifiableAppointment, after: NotifiableAppointment): boolean {
  return slotKey(getAppointmentEffectiveSlot(before)) !== slotKey(getAppointmentEffectiveSlot(after))
    || (before.assignedTrainer ?? "") !== (after.assignedTrainer ?? "")
    || String(before.duration ?? "") !== String(after.duration ?? "")
    || (before.sessionType ?? "") !== (after.sessionType ?? "");
}

function startsAfter(appointment: NotifiableAppointment, now: Date): boolean {
  const slot = getAppointmentEffectiveSlot(appointment);
  const start = slot ? madridCivilSlotToInstant(slot) : undefined;
  // Unknown slot: do not hide the notice.
  return !start || start.getTime() > now.getTime();
}

/** True when this write belongs to a grouped (recurring) operation. */
export function isGroupedOperationWrite(before?: NotifiableAppointment, after?: NotifiableAppointment): boolean {
  const operationId = after?.notificationOperationId;
  return Boolean(operationId && operationId !== before?.notificationOperationId);
}

/**
 * Maps an appointment write to the customer notice it deserves, or `null`
 * when the change has no visible impact for the customer (technical fields,
 * past sessions, grouped recurring operations handled elsewhere...).
 */
export function classifyAppointmentChange(
  before: NotifiableAppointment | undefined,
  after: NotifiableAppointment | undefined,
  now: Date,
): AppointmentChange | null {
  if (isGroupedOperationWrite(before, after)) return null;

  if (!before && after) {
    if (after.status === "pending") return { event: "appointment_requested", appointment: after, status: "pending" };
    if (after.status === "approved") return { event: "appointment_confirmed", appointment: after, status: "approved" };
    return null;
  }

  if (before && !after) {
    if (!ACTIVE_STATUSES.has(before.status ?? "") || !startsAfter(before, now)) return null;
    return { event: "appointment_deleted", appointment: before, status: "deleted" };
  }

  if (!before || !after) return null;
  // Edits to sessions that already happened are bookkeeping, not news.
  if (!startsAfter(before, now) && !startsAfter(after, now)) return null;

  const previousSlot = getAppointmentEffectiveSlot(before);
  const status = after.status ?? "";
  if (before.status !== after.status) {
    switch (after.status) {
      case "approved":
        return { event: "appointment_confirmed", appointment: after, status };
      case "rejected":
        return { event: "appointment_rejected", appointment: after, status };
      case "cancelled":
        return { event: "appointment_cancelled", appointment: after, status };
      case "pending":
        if (before.status !== "approved") return null;
        return visibleDetailsChanged(before, after)
          ? { event: "appointment_rescheduled", appointment: after, previousSlot, status }
          : { event: "appointment_requested", appointment: after, status };
      default:
        return null;
    }
  }

  if (ACTIVE_STATUSES.has(status) && visibleDetailsChanged(before, after)) {
    return { event: "appointment_rescheduled", appointment: after, previousSlot, status };
  }
  return null;
}
