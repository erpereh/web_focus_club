import type { EffectiveAppointmentSlot } from "../appointmentLifecycle.js";
import {
  appointmentCustomerEventEmail,
  type AppointmentEmailStatus,
  appointmentSeriesEmail,
  bonoEmail,
  type BonoEmailEvent,
  type CustomerAppointmentEvent,
} from "../email/templates/index.js";
import type { EmailMessage } from "../email/types.js";
import type {
  BonoNotificationEvent,
  CustomerNotification,
  SeriesNotificationEvent,
} from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isNotifiableEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** "lunes, 5 de octubre a las 10:15" in Europe/Madrid civil terms. */
export function shortWhen(slot: { date?: string; time?: string } | undefined): string {
  if (!slot?.date) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.date);
  if (!match) return [slot.date, slot.time].filter(Boolean).join(" ");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const label = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
  }).format(date);
  return slot.time ? `${label} a las ${slot.time}` : label;
}

function customerEmail(
  address: string | undefined,
  name: string,
  category: EmailMessage["category"],
  rendered: { subject: string; html: string; text: string },
  tags: string[],
): EmailMessage | undefined {
  if (!isNotifiableEmail(address)) return undefined;
  return { ...rendered, category, to: [{ email: address.trim(), name }], tags };
}

// ---------------------------------------------------------------- appointments

export interface AppointmentNoticeInput {
  uid: string;
  dedupeKey: string;
  event: CustomerAppointmentEvent;
  appointmentId: string;
  status: string;
  customerName: string;
  customerEmail?: string;
  slot?: EffectiveAppointmentSlot;
  previousSlot?: EffectiveAppointmentSlot;
  sessionType: string;
  trainerName: string;
  duration?: string;
  /** Missing = training. Nutrition copy says "consulta" instead of "sesión". */
  appointmentType?: string;
  /**
   * True only when the appointment document records an actual refund
   * (`minutesRefundedAt`). Copy never claims a refund otherwise.
   */
  minutesRefunded?: boolean;
}

const REFUND_SENTENCE = "Los minutos reservados se han devuelto a tu bono.";

function withRefund(text: string, refunded: boolean | undefined): string {
  return refunded ? `${text} ${REFUND_SENTENCE}` : text;
}

const APPOINTMENT_PUSH: Record<CustomerAppointmentEvent, { title: string; body: (when: string, input: AppointmentNoticeInput) => string }> = {
  appointment_requested: {
    title: "Solicitud de cita recibida",
    body: (when) => `Hemos recibido tu solicitud para el ${when}. Te avisaremos cuando la revisemos.`,
  },
  appointment_confirmed: {
    title: "Cita confirmada",
    body: (when, input) => `Tu ${sessionNoun(input)} del ${when} está confirmada.`,
  },
  appointment_rescheduled: {
    title: "Tu cita ha cambiado",
    body: (when, input) => input.status === "pending"
      ? `Tu cita ahora es el ${when} y está pendiente de confirmación.`
      : `Tu sesión ahora es el ${when}${input.trainerName ? ` con ${input.trainerName}` : ""}.`,
  },
  appointment_rejected: {
    title: "Cita no confirmada",
    body: (when) => `No hemos podido confirmar tu cita del ${when}.`,
  },
  appointment_cancelled: {
    title: "Cita cancelada",
    body: (when, input) => withRefund(`Tu cita del ${when} ha sido cancelada.`, input.minutesRefunded),
  },
  appointment_deleted: {
    title: "Cita eliminada",
    body: (when, input) => withRefund(`Tu cita del ${when} se ha eliminado de tu agenda.`, input.minutesRefunded),
  },
  appointment_proposed: {
    title: "Te proponemos otra hora",
    body: (when) => `La hora solicitada no está disponible. Te proponemos el ${when}. ¿Quieres confirmarla?`,
  },
  appointment_proposal_declined: {
    title: "Propuesta rechazada",
    body: (_when, input) => withRefund("Has rechazado la hora propuesta. Puedes solicitar otra cita cuando quieras.", input.minutesRefunded),
  },
};

function sessionNoun(input: AppointmentNoticeInput): string {
  return input.appointmentType === "nutrition" ? "consulta de nutrición" : "sesión";
}

export function buildAppointmentNotice(input: AppointmentNoticeInput): CustomerNotification {
  const when = shortWhen(input.slot) || "tu próxima sesión";
  const copy = APPOINTMENT_PUSH[input.event];
  const emailStatus = (["pending", "approved", "rejected", "cancelled", "deleted"].includes(input.status)
    ? input.status
    : "pending") as AppointmentEmailStatus;
  const rendered = appointmentCustomerEventEmail(input.event, {
    action: input.event === "appointment_confirmed"
      || input.event === "appointment_requested"
      || input.event === "appointment_proposed" ? "confirmed" : "deleted",
    status: emailStatus,
    appointmentId: input.appointmentId,
    customerName: input.customerName,
    customerEmail: input.customerEmail ?? "",
    date: input.slot?.date ?? "",
    time: input.slot?.time ?? "",
    sessionType: input.sessionType,
    trainerName: input.trainerName,
    duration: input.duration,
    minutesRefunded: input.minutesRefunded === true,
  }, input.previousSlot);

  return {
    uid: input.uid,
    dedupeKey: input.dedupeKey,
    category: "appointment_status",
    event: input.event,
    title: copy.title,
    body: copy.body(when, input),
    related: { appointmentId: input.appointmentId, status: input.status },
    navigation: { route: "appointment", params: { appointmentId: input.appointmentId } },
    channels: {
      push: true,
      email: customerEmail(input.customerEmail, input.customerName, "appointment_customer", rendered, [input.event]),
    },
  };
}

export function buildAppointmentReminderNotice(input: {
  uid: string;
  appointmentId: string;
  slot: EffectiveAppointmentSlot;
}): CustomerNotification {
  return {
    uid: input.uid,
    dedupeKey: `reminder:${input.appointmentId}:${input.slot.date}T${input.slot.time}`,
    category: "appointment_status",
    event: "appointment_reminder",
    // The scheduler may run late within its recovery window: never claim "24 h".
    title: "Recordatorio de tu cita",
    body: `Tienes una sesión el ${shortWhen(input.slot)}.`,
    related: { appointmentId: input.appointmentId, status: "approved" },
    navigation: { route: "appointment", params: { appointmentId: input.appointmentId } },
    channels: { push: true },
  };
}

// ---------------------------------------------------------------- recurring

export interface SeriesNoticeInput {
  uid: string;
  operationId: string;
  event: SeriesNotificationEvent;
  seriesId: string;
  appointmentIds: string[];
  sessions: EffectiveAppointmentSlot[];
  cancelledSessions?: EffectiveAppointmentSlot[];
  customerName: string;
  customerEmail?: string;
  /** Minutes the operation verifiably returned to the bono (0 = none). */
  refundedMinutes?: number;
}

const SERIES_PUSH: Record<SeriesNotificationEvent, { title: string; body: (n: number) => string }> = {
  appointment_series_requested: {
    title: "Solicitud de citas recurrentes recibida",
    body: (n) => `Hemos recibido tu solicitud de ${n} ${n === 1 ? "sesión" : "sesiones"}. Te avisaremos cuando la revisemos.`,
  },
  appointment_series_confirmed: {
    title: "Citas recurrentes confirmadas",
    body: (n) => `Se han confirmado ${n} ${n === 1 ? "sesión" : "sesiones"}.`,
  },
  appointment_series_rejected: {
    title: "Citas recurrentes no confirmadas",
    body: (n) => `No hemos podido confirmar tu solicitud de ${n} ${n === 1 ? "sesión" : "sesiones"}.`,
  },
  appointment_series_cancelled: {
    title: "Citas recurrentes canceladas",
    body: (n) => `Se han cancelado ${n} ${n === 1 ? "sesión" : "sesiones"} de tu serie.`,
  },
  appointment_series_rescheduled: {
    title: "Tus citas recurrentes han cambiado",
    body: (n) => `Se han actualizado ${n} ${n === 1 ? "sesión" : "sesiones"} de tu serie.`,
  },
  appointment_series_returned_to_pending: {
    title: "Citas recurrentes pendientes",
    body: (n) => `${n} ${n === 1 ? "sesión vuelve" : "sesiones vuelven"} a estar pendientes de confirmación.`,
  },
  appointment_series_renewal_pending: {
    title: "Citas renovadas por confirmar",
    body: (n) => `Tienes ${n} ${n === 1 ? "cita renovada pendiente" : "citas renovadas pendientes"} de confirmar.`,
  },
};

const SERIES_STATUS: Record<SeriesNotificationEvent, string> = {
  appointment_series_requested: "pending",
  appointment_series_confirmed: "approved",
  appointment_series_rejected: "rejected",
  appointment_series_cancelled: "cancelled",
  appointment_series_rescheduled: "approved",
  appointment_series_returned_to_pending: "pending",
  appointment_series_renewal_pending: "pending",
};

export function buildSeriesNotice(input: SeriesNoticeInput): CustomerNotification {
  const sessions = [...input.sessions].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const cancelled = [...(input.cancelledSessions ?? [])]
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const count = input.event === "appointment_series_cancelled" ? sessions.length || cancelled.length : sessions.length;
  const copy = SERIES_PUSH[input.event];
  const rendered = appointmentSeriesEmail(input.event, {
    customerName: input.customerName,
    sessions,
    cancelledSessions: cancelled,
    refundedMinutes: input.refundedMinutes ?? 0,
  });
  const firstAppointmentId = input.appointmentIds[0];
  return {
    uid: input.uid,
    dedupeKey: `op:${input.operationId}`,
    category: "appointment_status",
    event: input.event,
    title: copy.title,
    body: withRefund(copy.body(count), (input.refundedMinutes ?? 0) > 0),
    related: {
      seriesId: input.seriesId,
      appointmentIds: input.appointmentIds,
      ...(firstAppointmentId ? { appointmentId: firstAppointmentId } : {}),
      status: SERIES_STATUS[input.event],
    },
    navigation: { route: "appointments", params: { seriesId: input.seriesId } },
    channels: {
      push: true,
      email: customerEmail(input.customerEmail, input.customerName, "appointment_series_customer", rendered, [input.event]),
    },
  };
}

// ---------------------------------------------------------------- bonos

export interface BonoNoticeInput {
  uid: string;
  dedupeKey: string;
  event: BonoNotificationEvent;
  bonoId: string;
  customerName: string;
  customerEmail?: string;
  totalMinutes: number;
  remainingMinutes: number;
  startDate?: string;
  expiryDate?: string;
  /** Bulk administrative change: record it in the history, send nothing. */
  historyOnly?: boolean;
}

function dayMonth(date?: string): string {
  return shortWhen(date ? { date } : undefined);
}

const BONO_PUSH: Record<BonoNotificationEvent, { title: string; body: (input: BonoNoticeInput) => string }> = {
  bono_assigned: {
    title: "Tu bono ya está activo",
    body: (i) => `Tienes ${i.totalMinutes} minutos disponibles${i.expiryDate ? ` hasta el ${dayMonth(i.expiryDate)}` : ""}.`,
  },
  bono_renewed: {
    title: "Tu bono se ha renovado",
    body: (i) => `Tienes ${i.totalMinutes} minutos disponibles${i.expiryDate ? ` hasta el ${dayMonth(i.expiryDate)}` : ""}.`,
  },
  bono_exhausted: {
    title: "Tu bono se ha agotado",
    body: () => "Ya no te quedan minutos disponibles para nuevas reservas.",
  },
  bono_expired: {
    title: "Tu bono ha caducado",
    body: () => "Tu bono ya no puede usarse para nuevas reservas.",
  },
  bono_validity_changed: {
    title: "Validez del bono actualizada",
    body: (i) => i.expiryDate ? `Tu bono ahora es válido hasta el ${dayMonth(i.expiryDate)}.` : "Hemos actualizado las fechas de tu bono.",
  },
  bono_expiring_7d: {
    title: "Tu bono caduca en 7 días",
    body: (i) => `Te quedan ${i.remainingMinutes} minutos hasta el ${dayMonth(i.expiryDate)}.`,
  },
  bono_expiring_2d: {
    title: "Tu bono caduca en 2 días",
    body: (i) => `Te quedan ${i.remainingMinutes} minutos hasta el ${dayMonth(i.expiryDate)}.`,
  },
};

export function buildBonoNotice(input: BonoNoticeInput): CustomerNotification {
  const copy = BONO_PUSH[input.event];
  const rendered = bonoEmail(input.event as BonoEmailEvent, {
    customerName: input.customerName,
    totalMinutes: input.totalMinutes,
    remainingMinutes: input.remainingMinutes,
    startDate: input.startDate,
    expiryDate: input.expiryDate,
  });
  return {
    uid: input.uid,
    dedupeKey: input.dedupeKey,
    category: "bono_status",
    event: input.event,
    title: copy.title,
    body: copy.body(input),
    related: { bonoId: input.bonoId },
    navigation: { route: "bono", params: { bonoId: input.bonoId } },
    channels: input.historyOnly
      ? { push: false }
      : {
        push: true,
        email: customerEmail(input.customerEmail, input.customerName, "bono_customer", rendered, [input.event]),
      },
  };
}

// ---------------------------------------------------------------- chat

export function buildSupportMessageNotice(input: {
  uid: string;
  conversationId: string;
  messageId: string;
}): CustomerNotification {
  return {
    uid: input.uid,
    dedupeKey: `chat:${input.conversationId}:${input.messageId}`,
    category: "support_message",
    event: "support_message",
    title: "Nuevo mensaje de Focus Club",
    body: "Tienes una nueva respuesta en el chat.",
    related: { conversationId: input.conversationId },
    navigation: { route: "chat", params: { conversationId: input.conversationId } },
    channels: { push: true },
  };
}
