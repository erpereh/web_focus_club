import type { RenderedEmail } from "../types.js";
import { button, paragraph, PORTAL_URL } from "./components.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export interface WelcomeEmailData {
  customerName: string;
}

export function welcomeEmail({ customerName }: WelcomeEmailData): RenderedEmail {
  const subject = "Bienvenido a Focus Club";
  const heading = `Te damos la bienvenida, ${customerName}`;
  const paragraphs = [
    "Tu cuenta de Focus Club ya está lista.",
    "Desde tu portal puedes reservar sesiones, consultar tus citas y revisar los minutos disponibles de tu bono.",
    "Si tienes cualquier duda, responde a este email y te ayudaremos.",
  ];
  const footerNote = "Recibes este email porque te has registrado en Focus Club.";

  const html = renderLayout({
    preheader: "Tu cuenta ya está lista. Reserva tu primera sesión desde el portal.",
    eyebrow: "Bienvenida",
    heading,
    bodyHtml: [...paragraphs.map(paragraph), button(PORTAL_URL, "Ir a mi portal")].join("\n"),
    footerNote,
  });
  const text = renderTextLayout({
    heading,
    body: [...paragraphs, `Ir a mi portal: ${PORTAL_URL}`].join("\n\n"),
    footerNote,
  });
  return { subject, html, text };
}
