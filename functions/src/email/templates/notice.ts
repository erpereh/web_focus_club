import type { RenderedEmail } from "../types.js";
import { COLORS, type DetailRow, detailsTable, escapeHtml, FONT_STACK, paragraph, textDetails } from "./components.js";
import { renderLayout, renderTextLayout } from "./layout.js";

export interface CustomerNoticeInput {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  intro: string;
  rows?: DetailRow[];
  listTitle?: string;
  listItems?: string[];
  footerNote: string;
}

function listBlock(title: string, items: string[]): string {
  const rows = items.map((item) => `<tr><td style="padding:6px 0;font-family:${FONT_STACK};font-size:15px;line-height:22px;color:${COLORS.ink};border-bottom:1px solid ${COLORS.border};">${escapeHtml(item)}</td></tr>`).join("");
  return `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${COLORS.subtle};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;">${rows}</table>`;
}

/** Informational customer email on the shared layout (no CTA). */
export function customerNoticeEmail(input: CustomerNoticeInput): RenderedEmail {
  const rows = input.rows ?? [];
  const items = input.listItems ?? [];
  const bodyHtml = [
    paragraph(input.intro),
    rows.length ? detailsTable(rows) : "",
    items.length && input.listTitle ? listBlock(input.listTitle, items) : "",
  ].filter(Boolean).join("\n");
  const textBody = [
    input.intro,
    ...(rows.length ? ["", textDetails(rows)] : []),
    ...(items.length && input.listTitle ? ["", `${input.listTitle}:`, ...items.map((item) => `- ${item}`)] : []),
  ].join("\n");

  return {
    subject: input.subject,
    html: renderLayout({
      preheader: input.preheader,
      eyebrow: input.eyebrow,
      heading: input.heading,
      bodyHtml,
      footerNote: input.footerNote,
    }),
    text: renderTextLayout({ heading: input.heading, body: textBody, footerNote: input.footerNote }),
  };
}
