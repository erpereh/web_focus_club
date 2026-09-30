import type { RenderedEmail } from "../types.js";
import { type DetailRow, detailsTable, formatDateTime, messageBlock, paragraph, textDetails } from "./components.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export interface CustomerSuggestionEmailData {
  suggestionId: string;
  userName: string;
  userEmail: string;
  subject: string | null;
  message: string;
  createdAt: string;
}

export function customerSuggestionEmail(data: CustomerSuggestionEmailData): RenderedEmail {
  const topic = data.subject || "Sin asunto";
  const subject = `Nueva sugerencia de cliente · ${data.userName} · ${topic}`;
  const intro = `${data.userName} ha enviado una sugerencia desde su portal. Responde a este email para contestarle directamente.`;
  const createdAt = new Date(data.createdAt);
  const rows: DetailRow[] = [
    ["Cliente", data.userName],
    ["Email", data.userEmail],
    ["Asunto", topic],
    ["Fecha", Number.isNaN(createdAt.getTime()) ? data.createdAt : formatDateTime(createdAt)],
    ["ID", data.suggestionId],
  ];
  const footerNote = "Aviso interno de sugerencias de clientes de Focus Club.";

  const html = renderLayout({
    preheader: `${data.userName}: ${topic}`,
    eyebrow: "Sugerencias",
    heading: "Nueva sugerencia de cliente",
    bodyHtml: [paragraph(intro), detailsTable(rows), messageBlock("Sugerencia", data.message)].join("\n"),
    footerNote,
  });
  const text = renderTextLayout({
    heading: "Nueva sugerencia de cliente",
    body: [intro, "", textDetails(rows), "", "Sugerencia:", data.message].join("\n"),
    footerNote,
  });
  return { subject, html, text };
}
