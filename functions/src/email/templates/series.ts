import type { RenderedEmail } from "../types.js";
import { formatDisplayDate } from "./components.js";
import { customerNoticeEmail } from "./notice.js";

export type SeriesEmailEvent =
  | "appointment_series_requested"
  | "appointment_series_confirmed"
  | "appointment_series_rejected"
  | "appointment_series_cancelled"
  | "appointment_series_rescheduled"
  | "appointment_series_returned_to_pending";

export interface SeriesEmailData {
  customerName: string;
  /** Affected sessions, sorted, as civil date + time. */
  sessions: Array<{ date: string; time: string }>;
  /** Sessions cancelled by the same operation (schedule reductions). */
  cancelledSessions?: Array<{ date: string; time: string }>;
  /** Minutes verifiably returned to the bono by this operation. */
  refundedMinutes?: number;
}

const COPY: Record<SeriesEmailEvent, { subject: string; heading: string; intro: (n: number) => string; list: string }> = {
  appointment_series_requested: {
    subject: "Hemos recibido tu solicitud de citas recurrentes · Focus Club",
    heading: "Solicitud de citas recurrentes recibida",
    intro: (n) => `hemos recibido tu solicitud de ${n} ${n === 1 ? "sesión" : "sesiones"}. Te avisaremos en cuanto la revisemos.`,
    list: "Sesiones solicitadas",
  },
  appointment_series_confirmed: {
    subject: "Tus citas recurrentes están confirmadas · Focus Club",
    heading: "Citas recurrentes confirmadas",
    intro: (n) => `se han confirmado ${n} ${n === 1 ? "sesión" : "sesiones"}. Te esperamos.`,
    list: "Sesiones confirmadas",
  },
  appointment_series_rejected: {
    subject: "No hemos podido confirmar tus citas recurrentes · Focus Club",
    heading: "No hemos podido confirmar tus citas recurrentes",
    intro: (n) => `lamentamos no poder confirmar tu solicitud de ${n} ${n === 1 ? "sesión" : "sesiones"}.`,
    list: "Sesiones no confirmadas",
  },
  appointment_series_cancelled: {
    subject: "Tus citas recurrentes han sido canceladas · Focus Club",
    heading: "Citas recurrentes canceladas",
    intro: (n) => `te confirmamos la cancelación de ${n} ${n === 1 ? "sesión" : "sesiones"}.`,
    list: "Sesiones canceladas",
  },
  appointment_series_rescheduled: {
    subject: "Tus citas recurrentes han cambiado · Focus Club",
    heading: "Tus citas recurrentes han cambiado",
    intro: (n) => `se han actualizado ${n} ${n === 1 ? "sesión" : "sesiones"} de tu serie. Estos son los nuevos horarios.`,
    list: "Nuevos horarios",
  },
  appointment_series_returned_to_pending: {
    subject: "Tus citas recurrentes están pendientes de confirmación · Focus Club",
    heading: "Citas recurrentes pendientes de confirmación",
    intro: (n) => `${n} ${n === 1 ? "sesión" : "sesiones"} de tu serie vuelven a estar pendientes de confirmación. Te avisaremos en cuanto las revisemos.`,
    list: "Sesiones pendientes",
  },
};

export function formatSessionLabel(session: { date: string; time: string }): string {
  return `${formatDisplayDate(session.date)} · ${session.time}`;
}

export function appointmentSeriesEmail(event: SeriesEmailEvent, data: SeriesEmailData): RenderedEmail {
  const copy = COPY[event];
  const firstName = data.customerName.trim().split(/\s+/)[0] || data.customerName;
  const count = data.sessions.length;
  const cancelled = data.cancelledSessions ?? [];
  const listItems = data.sessions.map(formatSessionLabel);
  if (cancelled.length) {
    listItems.push(...cancelled.map((session) => `Cancelada: ${formatSessionLabel(session)}`));
  }
  return customerNoticeEmail({
    subject: copy.subject,
    preheader: copy.heading,
    eyebrow: "Tus citas recurrentes",
    heading: copy.heading,
    intro: `Hola ${firstName}, ${copy.intro(count)}${(data.refundedMinutes ?? 0) > 0
      ? ` Se han devuelto ${data.refundedMinutes} minutos reservados a tu bono.`
      : ""}`,
    listTitle: copy.list,
    listItems,
    footerNote: "Recibes este email porque tienes citas en Focus Club.",
  });
}
