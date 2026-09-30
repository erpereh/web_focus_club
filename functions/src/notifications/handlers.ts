import { getAppointmentEffectiveSlot } from "../appointmentLifecycle.js";
import { type CustomerAppointmentEvent } from "../email/templates/index.js";
import { classifyAppointmentChange, type NotifiableAppointment } from "./appointmentEvents.js";
import { bonoCivilDate, bonoRemainingMinutes, classifyBonoChange, type NotifiableBono } from "./bonoEvents.js";
import {
  buildAppointmentNotice,
  buildAppointmentReminderNotice,
  buildBonoNotice,
  buildSeriesNotice,
  buildSupportMessageNotice,
} from "./builders.js";
import { type NotifyDeps, notifyCustomerSafely, retryDueDeliveries } from "./dispatcher.js";
import type { NotificationOutboxEntry } from "./outbox.js";
import {
  addMadridDays,
  type IdentifiedDoc,
  planAppointmentReminders,
  planBonoExpiryWarnings,
  planOverdueBonos,
} from "./schedules.js";
import { getBonoTotalMinutes, type LifecycleBono } from "../appointmentLifecycle.js";
import type { BonoNotificationEvent, DeliveryOutcome } from "./types.js";

export interface NotificationHandlerDeps extends NotifyDeps {
  nowDate?: () => Date;
}

interface CustomerProfile {
  name: string;
  email: string;
}

export function createNotificationHandlers(deps: NotificationHandlerDeps) {
  const { db } = deps;
  const nowDate = deps.nowDate ?? (() => new Date());

  async function loadCustomer(uid: string): Promise<CustomerProfile> {
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() as { name?: unknown; email?: unknown; displayName?: unknown } : {};
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const name = typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName.trim()
        : email.split("@")[0] || "";
    return { name, email };
  }

  async function trainerName(trainerId?: string | null): Promise<string> {
    if (!trainerId) return "";
    const snap = await db.collection("trainers").doc(trainerId).get();
    const name = snap.exists ? (snap.data() as { name?: unknown }).name : undefined;
    return typeof name === "string" ? name : "";
  }

  async function bonoNotice(
    bonoId: string,
    bono: NotifiableBono,
    event: BonoNotificationEvent,
    dedupeKey: string,
  ): Promise<DeliveryOutcome | undefined> {
    if (!bono.userId) return undefined;
    const customer = await loadCustomer(bono.userId);
    return notifyCustomerSafely(deps, buildBonoNotice({
      uid: bono.userId,
      dedupeKey,
      event,
      bonoId,
      customerName: customer.name,
      customerEmail: customer.email,
      totalMinutes: getBonoTotalMinutes({ id: bonoId, estado: "activo", ...bono } as LifecycleBono),
      remainingMinutes: bonoRemainingMinutes(bono),
      startDate: bonoCivilDate(bono.fechaAsignacion),
      expiryDate: bonoCivilDate(bono.fechaExpiracion),
    }));
  }

  return {
    async onAppointmentWritten(input: {
      eventId: string;
      appointmentId: string;
      before?: NotifiableAppointment;
      after?: NotifiableAppointment;
    }): Promise<DeliveryOutcome | undefined> {
      const change = classifyAppointmentChange(input.before, input.after, nowDate());
      if (!change) return undefined;
      const appointment = change.appointment;
      if (!appointment.userId) return undefined;
      const customerName = appointment.name || (await loadCustomer(appointment.userId)).name;
      return notifyCustomerSafely(deps, buildAppointmentNotice({
        uid: appointment.userId,
        dedupeKey: `appt:${input.eventId}`,
        event: change.event as CustomerAppointmentEvent,
        appointmentId: input.appointmentId,
        status: change.status,
        customerName,
        customerEmail: appointment.email,
        slot: getAppointmentEffectiveSlot(appointment),
        previousSlot: change.previousSlot,
        sessionType: appointment.sessionType || appointment.serviceType || "",
        trainerName: await trainerName(appointment.assignedTrainer),
        duration: appointment.duration === undefined ? undefined : String(appointment.duration),
      }));
    },

    async onBonoWritten(input: {
      eventId: string;
      bonoId: string;
      before?: NotifiableBono;
      after?: NotifiableBono;
    }): Promise<DeliveryOutcome | undefined> {
      const after = input.after;
      if (!after?.userId) return undefined;
      let hadPreviousBono = false;
      if (!input.before) {
        const others = await db.collection("bonos").where("userId", "==", after.userId).get();
        hadPreviousBono = others.docs.some((docSnap) => docSnap.id !== input.bonoId
          && (docSnap.data() as NotifiableBono).estado !== "eliminado");
      }
      const change = classifyBonoChange(input.before, after, { hadPreviousBono });
      if (!change) return undefined;
      const dedupeKey = change.event === "bono_assigned" || change.event === "bono_renewed"
        ? `bono:${input.bonoId}:created`
        : change.event === "bono_expired"
          ? `bono:${input.bonoId}:expired`
          : `bono:${input.bonoId}:${change.event}:${input.eventId}`;
      return bonoNotice(input.bonoId, after, change.event, dedupeKey);
    },

    async onOutboxCreated(input: {
      operationId: string;
      entry: NotificationOutboxEntry;
    }): Promise<DeliveryOutcome | undefined> {
      const { entry } = input;
      if (!entry.userId) return undefined;
      const customer = entry.customerName && entry.customerEmail
        ? { name: entry.customerName, email: entry.customerEmail }
        : await loadCustomer(entry.userId);
      return notifyCustomerSafely(deps, buildSeriesNotice({
        uid: entry.userId,
        operationId: input.operationId,
        event: entry.event,
        seriesId: entry.seriesId,
        appointmentIds: entry.appointmentIds,
        sessions: entry.sessions,
        cancelledSessions: entry.cancelledSessions,
        customerName: entry.customerName || customer.name,
        customerEmail: entry.customerEmail || customer.email,
      }));
    },

    async notifySupportMessage(input: {
      userId: string;
      conversationId: string;
      messageId: string;
    }): Promise<DeliveryOutcome | undefined> {
      return notifyCustomerSafely(deps, buildSupportMessageNotice({
        uid: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
      }));
    },

    async runBonoExpiryWarnings(): Promise<number> {
      const snap = await db.collection("bonos").where("estado", "==", "activo").get();
      const bonos: IdentifiedDoc<NotifiableBono>[] = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() as NotifiableBono,
      }));
      const byId = new Map(bonos.map((bono) => [bono.id, bono.data]));
      const warnings = planBonoExpiryWarnings(bonos, nowDate());
      for (const warning of warnings) {
        await bonoNotice(warning.bonoId, byId.get(warning.bonoId) as NotifiableBono, warning.event, warning.dedupeKey);
      }
      return warnings.length;
    },

    /** Marks overdue bonos as expired; the bono trigger sends `bono_expired`. */
    async runExpireOverdueBonos(): Promise<number> {
      const snap = await db.collection("bonos").where("estado", "in", ["activo", "agotado"]).get();
      const now = nowDate();
      const overdue = planOverdueBonos(snap.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() as NotifiableBono,
      })), now);
      for (const bonoId of overdue) {
        const ref = db.collection("bonos").doc(bonoId);
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          const estado = current.exists ? (current.data() as NotifiableBono).estado : undefined;
          if (estado !== "activo" && estado !== "agotado") return;
          transaction.set(ref, {
            estado: "expirado",
            expiredAt: now.toISOString(),
            expiredBy: "scheduler",
          }, { merge: true });
        });
      }
      return overdue.length;
    },

    async runAppointmentReminders(): Promise<number> {
      const now = nowDate();
      const dates = [0, 1, 2].map((offset) => addMadridDays(now, offset));
      const [byApprovedSlot, byDate] = await Promise.all([
        db.collection("appointments").where("approvedSlot.date", "in", dates).get(),
        db.collection("appointments").where("date", "in", dates).get(),
      ]);
      const appointments = [...byApprovedSlot.docs, ...byDate.docs].map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() as NotifiableAppointment,
      }));
      const reminders = planAppointmentReminders(appointments, now);
      for (const reminder of reminders) {
        await notifyCustomerSafely(deps, buildAppointmentReminderNotice(reminder));
      }
      return reminders.length;
    },

    async runDeliveryRetries(): Promise<number> {
      return retryDueDeliveries(deps);
    },
  };
}

export type NotificationHandlers = ReturnType<typeof createNotificationHandlers>;
