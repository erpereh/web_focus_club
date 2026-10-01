import type { RenderedEmail } from "../types.js";
import {
  type DetailRow,
  detailsTable,
  formatDisplayDate,
  paragraph,
  textDetails,
} from "./components.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export type AppointmentEmailAction = "confirmed" | "deleted";
export type AppointmentEmailStatus = "pending" | "approved" | "rejected" | "cancelled" | "deleted";

export interface AppointmentEmailData {
  action: AppointmentEmailAction;
  status: AppointmentEmailStatus;
  appointmentId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  date: string;
  time: string;
  sessionType: string;
  trainerName: string;
  duration?: string;
  serviceType?: string;
  /** Customer copy mentions a refund only when this is true. */
  minutesRefunded?: boolean;
}

interface Copy {
  subject: string;
  heading: string;
  intro: string;
  preheader: string;
}

const STATUS_LABELS: Record<AppointmentEmailStatus, string> = {
  pending: "Pendiente de aprobación",
  approved: "Confirmada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  deleted: "Eliminada",
};

function whenLabel(data: AppointmentEmailData): string {
  const date = data.date ? formatDisplayDate(data.date) : "";
  return [date, data.time].filter(Boolean).join(" · ");
}

function sessionRows(data: AppointmentEmailData): DetailRow[] {
  return [
    ["Fecha", data.date ? formatDisplayDate(data.date) : ""],
    ["Hora", data.time],
    ["Sesión", data.sessionType],
    ["Entrenador", data.trainerName],
  ];
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export type CustomerAppointmentEvent =
  | "appointment_requested"
  | "appointment_confirmed"
  | "appointment_rescheduled"
  | "appointment_rejected"
  | "appointment_cancelled"
  | "appointment_deleted";

function refundNote(data: AppointmentEmailData): string {
  return data.minutesRefunded ? " Los minutos reservados se han devuelto a tu bono." : "";
}

function customerEventCopy(event: CustomerAppointmentEvent, data: AppointmentEmailData): Copy {
  const when = whenLabel(data);
  const hi = `Hola ${firstName(data.customerName)},`;
  switch (event) {
    case "appointment_requested":
      return {
        subject: "Hemos recibido tu solicitud de cita · Focus Club",
        heading: "Solicitud recibida",
        intro: `${hi} hemos recibido tu solicitud de cita. Te avisaremos en cuanto la revisemos.`,
        preheader: `Solicitud de cita para ${when}.`,
      };
    case "appointment_confirmed":
      return {
        subject: "Tu cita está confirmada · Focus Club",
        heading: "Tu cita está confirmada",
        intro: `${hi} tu sesión ha quedado confirmada. Te esperamos.`,
        preheader: `Sesión confirmada: ${when}.`,
      };
    case "appointment_rescheduled":
      return data.status === "pending"
        ? {
          subject: "Tu cita ha cambiado · Focus Club",
          heading: "Tu cita ha cambiado",
          intro: `${hi} hemos registrado el cambio de tu cita. Queda pendiente de confirmación y te avisaremos en cuanto la revisemos.`,
          preheader: `Nuevo horario pendiente de confirmar: ${when}.`,
        }
        : {
          subject: "Tu cita ha cambiado · Focus Club",
          heading: "Tu cita ha cambiado",
          intro: `${hi} estos son los nuevos datos de tu sesión.`,
          preheader: `Nuevos datos de tu sesión: ${when}.`,
        };
    case "appointment_rejected":
      return {
        subject: "No hemos podido confirmar tu cita · Focus Club",
        heading: "No hemos podido confirmar tu cita",
        intro: `${hi} lamentamos no poder confirmar tu solicitud para esta fecha. Puedes elegir otro horario desde tu portal.`,
        preheader: `Tu solicitud para ${when} no ha podido confirmarse.`,
      };
    case "appointment_deleted":
      return {
        subject: "Tu cita ha sido eliminada · Focus Club",
        heading: "Tu cita ha sido eliminada",
        intro: `${hi} la siguiente sesión se ha eliminado de tu agenda.${refundNote(data)}`,
        preheader: `Sesión eliminada: ${when}.`,
      };
    case "appointment_cancelled":
    default:
      return {
        subject: "Tu cita ha sido cancelada · Focus Club",
        heading: "Tu cita ha sido cancelada",
        intro: `${hi} te confirmamos que la siguiente sesión ha sido cancelada.${refundNote(data)}`,
        preheader: `Sesión cancelada: ${when}.`,
      };
  }
}

function legacyCustomerEvent(data: AppointmentEmailData): CustomerAppointmentEvent {
  if (data.action === "confirmed") {
    return data.status === "pending" ? "appointment_requested" : "appointment_confirmed";
  }
  return data.status === "rejected" ? "appointment_rejected" : "appointment_cancelled";
}

function adminCopy(data: AppointmentEmailData): Copy {
  const when = whenLabel(data);
  const who = data.customerName;
  if (data.action === "confirmed") {
    if (data.status === "pending") {
      return {
        subject: `Nueva solicitud de cita · ${who} · ${when}`,
        heading: "Nueva solicitud de cita",
        intro: `${who} ha solicitado una sesión. Revísala en el panel de administración.`,
        preheader: `${who} solicita una sesión para ${when}.`,
      };
    }
    return {
      subject: `Cita confirmada · ${who} · ${when}`,
      heading: "Cita confirmada",
      intro: `La sesión de ${who} ha quedado confirmada.`,
      preheader: `Sesión confirmada de ${who} para ${when}.`,
    };
  }
  const label = STATUS_LABELS[data.status].toLowerCase();
  return {
    subject: `Cita ${label} · ${who} · ${when}`,
    heading: `Cita ${label}`,
    intro: `La sesión de ${who} ha sido ${label}.`,
    preheader: `Sesión ${label} de ${who} para ${when}.`,
  };
}

export function appointmentCustomerEmail(data: AppointmentEmailData): RenderedEmail {
  return appointmentCustomerEventEmail(legacyCustomerEvent(data), data);
}

/** Customer email for a concrete appointment event (informational, no CTA). */
export function appointmentCustomerEventEmail(
  event: CustomerAppointmentEvent,
  data: AppointmentEmailData,
  previousSlot?: { date: string; time: string },
): RenderedEmail {
  const copy = customerEventCopy(event, data);
  const rows = sessionRows(data);
  if (event === "appointment_rescheduled") {
    if (previousSlot && `${previousSlot.date}T${previousSlot.time}` !== `${data.date}T${data.time}`) {
      rows.push(["Antes", [formatDisplayDate(previousSlot.date), previousSlot.time].join(" · ")]);
    }
    rows.push(["Estado", STATUS_LABELS[data.status]]);
  }
  const footerNote = "Recibes este email porque tienes una cita en Focus Club.";

  const html = renderLayout({
    preheader: copy.preheader,
    eyebrow: "Tu cita",
    heading: copy.heading,
    bodyHtml: [paragraph(copy.intro), detailsTable(rows)].join("\n"),
    footerNote,
  });
  const text = renderTextLayout({
    heading: copy.heading,
    body: [copy.intro, "", textDetails(rows)].join("\n"),
    footerNote,
  });
  return { subject: copy.subject, html, text };
}

export function appointmentAdminEmail(data: AppointmentEmailData): RenderedEmail {
  const copy = adminCopy(data);
  const rows: DetailRow[] = [
    ["Cliente", data.customerName],
    ["Email", data.customerEmail],
    ["Teléfono", data.customerPhone ?? ""],
    ...sessionRows(data),
    ["Duración", data.duration ? `${data.duration} min` : ""],
    ["Servicio", data.serviceType ?? ""],
    ["Estado", STATUS_LABELS[data.status]],
    ["ID de cita", data.appointmentId],
  ];
  const footerNote = "Aviso interno de reservas de Focus Club.";

  const html = renderLayout({
    preheader: copy.preheader,
    eyebrow: "Reservas",
    heading: copy.heading,
    bodyHtml: [paragraph(copy.intro), detailsTable(rows)].join("\n"),
    footerNote,
  });
  const text = renderTextLayout({
    heading: copy.heading,
    body: [copy.intro, "", textDetails(rows)].join("\n"),
    footerNote,
  });
  return { subject: copy.subject, html, text };
}
