import type { RenderedEmail } from "../types.js";
import { type DetailRow, detailsTable, formatDateTime, messageBlock, paragraph, textDetails } from "./components.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export interface ContactEmailData {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  submittedAt: Date;
}

export function contactEmail(data: ContactEmailData): RenderedEmail {
  const subject = `Nuevo mensaje de contacto - Focus Club - ${data.subject}`;
  const intro = `${data.name} ha escrito desde el formulario de contacto de la web. Responde a este email para contestarle directamente.`;
  const rows: DetailRow[] = [
    ["Nombre", data.name],
    ["Email", data.email],
    ["Teléfono", data.phone || "No indicado"],
    ["Asunto", data.subject],
    ["Fecha", formatDateTime(data.submittedAt)],
  ];
  const footerNote = "Mensaje enviado desde el formulario de focusclub.es.";

  const html = renderLayout({
    preheader: `${data.name}: ${data.subject}`,
    eyebrow: "Formulario de contacto",
    heading: "Nuevo mensaje de contacto",
    bodyHtml: [paragraph(intro), detailsTable(rows), messageBlock("Mensaje", data.message)].join("\n"),
    footerNote,
  });
  const text = renderTextLayout({
    heading: "Nuevo mensaje de contacto",
    body: [intro, "", textDetails(rows), "", "Mensaje:", data.message].join("\n"),
    footerNote,
  });
  return { subject, html, text };
}
