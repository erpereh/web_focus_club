import { COLORS, escapeHtml, FONT_STACK, SITE_URL } from "./components.js";

export interface LayoutInput {
  /** Hidden inbox preview text. */
  preheader: string;
  /** Small label above the heading, e.g. "Reservas". */
  eyebrow?: string;
  heading: string;
  /** Pre-rendered, already-escaped HTML for the body. */
  bodyHtml: string;
  /** Short footer note explaining why the recipient got this email. */
  footerNote?: string;
}

export interface TextLayoutInput {
  heading: string;
  body: string;
  footerNote?: string;
}

const FOOTER_TAGLINE = "Focus Club · Entrenamiento personal";

/**
 * Shared shell for every Focus Club email. Table-based, inline styles and a
 * 600px fluid container so it renders in Gmail, Outlook (desktop + web) and
 * mobile clients; the <style> block only adds progressive enhancements.
 */
export function renderLayout({ preheader, eyebrow, heading, bodyHtml, footerNote }: LayoutInput): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table,td,p,a,h1{font-family:Arial,sans-serif !important;}</style>
<![endif]-->
<style>
body{margin:0;padding:0;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
a{color:${COLORS.brand};}
@media only screen and (max-width:620px){
  .fc-container{width:100% !important;}
  .fc-pad{padding-left:24px !important;padding-right:24px !important;}
  .fc-heading{font-size:22px !important;line-height:30px !important;}
  .fc-detail-label,.fc-detail-value{display:block !important;width:100% !important;box-sizing:border-box;}
  .fc-detail-label{padding-bottom:0 !important;border-bottom:0 !important;}
  .fc-button{display:block !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.canvas};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.canvas};opacity:0;">${escapeHtml(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.canvas}" style="width:100%;background-color:${COLORS.canvas};">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="fc-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td bgcolor="${COLORS.header}" class="fc-pad" style="background-color:${COLORS.header};padding:24px 40px;border-radius:12px 12px 0 0;">
<span style="font-family:${FONT_STACK};font-size:16px;line-height:20px;font-weight:700;letter-spacing:0.28em;color:#ffffff;">FOCUS&nbsp;CLUB</span>
</td></tr>
<tr><td bgcolor="${COLORS.accent}" height="3" style="background-color:${COLORS.accent};height:3px;line-height:3px;font-size:3px;">&nbsp;</td></tr>
<tr><td bgcolor="${COLORS.surface}" class="fc-pad" style="background-color:${COLORS.surface};padding:40px 40px 16px;">
${eyebrow ? `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:12px;line-height:18px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${COLORS.brand};">${escapeHtml(eyebrow)}</p>` : ""}
<h1 class="fc-heading" style="margin:0 0 20px;font-family:${FONT_STACK};font-size:26px;line-height:34px;font-weight:700;color:${COLORS.ink};">${escapeHtml(heading)}</h1>
${bodyHtml}
</td></tr>
<tr><td bgcolor="${COLORS.surface}" class="fc-pad" style="background-color:${COLORS.surface};padding:0 40px 32px;border-radius:0 0 12px 12px;">
<p style="margin:0;padding-top:20px;border-top:1px solid ${COLORS.border};font-family:${FONT_STACK};font-size:14px;line-height:22px;color:${COLORS.muted};">Un saludo,<br><strong style="color:${COLORS.ink};">Equipo Focus Club</strong></p>
</td></tr>
<tr><td class="fc-pad" align="center" style="padding:24px 40px 0;">
${footerNote ? `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${COLORS.subtle};">${escapeHtml(footerNote)}</p>` : ""}
<p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${COLORS.subtle};">${FOOTER_TAGLINE} · <a href="${SITE_URL}" target="_blank" style="color:${COLORS.subtle};text-decoration:underline;">focusclub.es</a> · &copy; ${year}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

export function renderTextLayout({ heading, body, footerNote }: TextLayoutInput): string {
  return [
    "FOCUS CLUB",
    "",
    heading,
    "=".repeat(Math.min(heading.length, 60)),
    "",
    body.trim(),
    "",
    "Un saludo,",
    "Equipo Focus Club",
    "",
    "--",
    ...(footerNote ? [footerNote] : []),
    `${FOOTER_TAGLINE} · ${SITE_URL}`,
  ].join("\n");
}
