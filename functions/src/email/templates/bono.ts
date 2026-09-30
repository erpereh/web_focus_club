import type { RenderedEmail } from "../types.js";
import type { DetailRow } from "./components.js";
import { formatDisplayDate } from "./components.js";
import { customerNoticeEmail } from "./notice.js";

export type BonoEmailEvent =
  | "bono_assigned"
  | "bono_renewed"
  | "bono_exhausted"
  | "bono_expired"
  | "bono_validity_changed"
  | "bono_expiring_7d"
  | "bono_expiring_2d";

export interface BonoEmailData {
  customerName: string;
  totalMinutes: number;
  remainingMinutes: number;
  /** Civil dates (YYYY-MM-DD) in Europe/Madrid. */
  startDate?: string;
  expiryDate?: string;
}

function dateLabel(value?: string): string {
  return value ? formatDisplayDate(value) : "";
}

const COPY: Record<BonoEmailEvent, { subject: string; heading: string; intro: (d: BonoEmailData) => string }> = {
  bono_assigned: {
    subject: "Tu bono ya está activo · Focus Club",
    heading: "Tu bono ya está activo",
    intro: (d) => `ya tienes un bono de ${d.totalMinutes} minutos disponible para reservar tus sesiones.`,
  },
  bono_renewed: {
    subject: "Tu bono se ha renovado · Focus Club",
    heading: "Tu bono se ha renovado",
    intro: (d) => `hemos renovado tu bono. Tienes ${d.totalMinutes} minutos disponibles para reservar tus sesiones.`,
  },
  bono_exhausted: {
    subject: "Tu bono se ha agotado · Focus Club",
    heading: "Tu bono se ha agotado",
    intro: () => "ya no te quedan minutos disponibles para nuevas reservas. Tus sesiones ya reservadas se mantienen. Si quieres seguir entrenando, habla con nosotros para renovarlo.",
  },
  bono_expired: {
    subject: "Tu bono ha caducado · Focus Club",
    heading: "Tu bono ha caducado",
    intro: () => "tu bono ha llegado a su fecha de caducidad y ya no puede usarse para nuevas reservas. Si quieres seguir entrenando, habla con nosotros para renovarlo.",
  },
  bono_validity_changed: {
    subject: "Hemos actualizado la validez de tu bono · Focus Club",
    heading: "Validez del bono actualizada",
    intro: () => "hemos actualizado las fechas de validez de tu bono. Estos son los datos actuales.",
  },
  bono_expiring_7d: {
    subject: "Tu bono caduca en 7 días · Focus Club",
    heading: "Tu bono caduca en 7 días",
    intro: (d) => `te recordamos que tu bono caduca el ${dateLabel(d.expiryDate)}. Aprovecha los minutos que te quedan.`,
  },
  bono_expiring_2d: {
    subject: "Tu bono caduca en 2 días · Focus Club",
    heading: "Tu bono caduca en 2 días",
    intro: (d) => `te recordamos que tu bono caduca el ${dateLabel(d.expiryDate)}. Aprovecha los minutos que te quedan.`,
  },
};

export function bonoEmail(event: BonoEmailEvent, data: BonoEmailData): RenderedEmail {
  const copy = COPY[event];
  const firstName = data.customerName.trim().split(/\s+/)[0] || data.customerName;
  const rows: DetailRow[] = [
    ["Minutos del bono", `${data.totalMinutes} min`],
    ["Minutos disponibles", `${data.remainingMinutes} min`],
    ["Válido desde", dateLabel(data.startDate)],
    ["Válido hasta", dateLabel(data.expiryDate)],
  ];
  return customerNoticeEmail({
    subject: copy.subject,
    preheader: copy.heading,
    eyebrow: "Tu bono",
    heading: copy.heading,
    intro: `Hola ${firstName}, ${copy.intro(data)}`,
    rows,
    footerNote: "Recibes este email porque tienes un bono en Focus Club.",
  });
}
