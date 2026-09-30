export const SITE_URL = "https://focusclub.es";
export const PORTAL_URL = `${SITE_URL}/portal`;

export const COLORS = {
  ink: "#111412",
  muted: "#5b625e",
  subtle: "#8a918d",
  border: "#e4e7e5",
  canvas: "#f3f4f3",
  surface: "#ffffff",
  header: "#080808",
  brand: "#2D6A4F",
  accent: "#52b788",
  panel: "#f7f8f7",
} as const;

export const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escapes text and keeps the author's line breaks. */
export function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export type DetailRow = [label: string, value: string];

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${COLORS.muted};">${escapeHtml(text)}</p>`;
}

export function detailsTable(rows: DetailRow[]): string {
  const visible = rows.filter(([, value]) => value.trim() !== "");
  const htmlRows = visible.map(([label, value], index) => {
    const border = index < visible.length - 1 ? `border-bottom:1px solid ${COLORS.border};` : "";
    return `<tr>
<td class="fc-detail-label" width="38%" valign="top" style="padding:12px 16px;${border}font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${COLORS.subtle};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</td>
<td class="fc-detail-value" valign="top" style="padding:12px 16px;${border}font-family:${FONT_STACK};font-size:15px;line-height:22px;color:${COLORS.ink};font-weight:600;word-break:break-word;">${escapeHtml(value)}</td>
</tr>`;
  }).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.panel}" style="width:100%;border-collapse:separate;background-color:${COLORS.panel};border:1px solid ${COLORS.border};border-radius:10px;margin:0 0 24px;">${htmlRows}</table>`;
}

export function messageBlock(title: string, text: string): string {
  return `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${COLORS.subtle};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;">
<tr><td style="padding:16px 18px;border-left:3px solid ${COLORS.accent};background-color:${COLORS.panel};font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${COLORS.ink};word-break:break-word;">${escapeMultiline(text)}</td></tr>
</table>`;
}

/** Bulletproof button: VML for Outlook desktop, styled link elsewhere. */
export function button(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr><td align="left">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="18%" stroke="f" fillcolor="${COLORS.brand}">
<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- --><a href="${safeUrl}" target="_blank" class="fc-button" style="display:inline-block;background-color:${COLORS.brand};color:#ffffff;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:46px;text-align:center;text-decoration:none;padding:0 28px;border-radius:8px;mso-hide:all;">${safeLabel}</a><!--<![endif]-->
</td></tr>
</table>`;
}

export function textDetails(rows: DetailRow[]): string {
  return rows
    .filter(([, value]) => value.trim() !== "")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function formatDisplayDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const formatted = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}
