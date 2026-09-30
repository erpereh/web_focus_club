const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appointmentAdminEmail,
  appointmentCustomerEmail,
  contactEmail,
  customerSuggestionEmail,
  escapeHtml,
  formatDisplayDate,
  renderLayout,
  welcomeEmail,
} = require("../lib/email/templates/index.js");

const XSS = "<script>alert('x')</script>";

function appointment(overrides = {}) {
  return {
    action: "confirmed",
    status: "approved",
    appointmentId: "apt-1",
    customerName: "Lucía Pérez",
    customerEmail: "lucia@example.com",
    customerPhone: "600000000",
    date: "2026-10-05",
    time: "10:15",
    sessionType: "Entrenamiento personal",
    trainerName: "Carlos",
    duration: "45",
    serviceType: "Bono Mensual de Entrenamiento",
    ...overrides,
  };
}

function assertWellFormed(email) {
  assert.ok(email.subject.length > 0);
  assert.match(email.html, /^<!DOCTYPE html>/);
  assert.match(email.html, /max-width:600px/);
  assert.match(email.html, /<!--\[if mso\]>/);
  assert.match(email.html, /@media only screen and \(max-width:620px\)/);
  assert.match(email.html, /role="presentation"/);
  assert.match(email.html, /FOCUS&nbsp;CLUB/);
  assert.ok(email.text.startsWith("FOCUS CLUB"));
  assert.doesNotMatch(email.text, /<[a-z][^>]*>/i, "plain text must not contain HTML tags");
  assert.equal(email.html.includes("<script>"), false);
}

test("layout renders a hidden preheader and escapes heading", () => {
  const html = renderLayout({ preheader: "Vista previa", heading: `Hola ${XSS}`, bodyHtml: "<p>x</p>" });
  assert.match(html, /display:none;max-height:0;overflow:hidden;mso-hide:all/);
  assert.match(html, /Vista previa/);
  assert.equal(html.includes(XSS), false);
  assert.match(html, /Hola &lt;script&gt;/);
});

test("escapeHtml and date formatting helpers", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;");
  assert.equal(formatDisplayDate("2026-10-05"), "Lunes, 5 de octubre de 2026");
  assert.equal(formatDisplayDate("not-a-date"), "not-a-date");
});

test("customer appointment email covers confirmed, rejected and cancelled/deleted", () => {
  const confirmed = appointmentCustomerEmail(appointment());
  assertWellFormed(confirmed);
  assert.equal(confirmed.subject, "Tu cita está confirmada · Focus Club");
  assert.match(confirmed.html, /Lunes, 5 de octubre de 2026/);
  assert.match(confirmed.html, /10:15/);
  assert.match(confirmed.html, /Carlos/);
  assert.match(confirmed.text, /Hora: 10:15/);
  assert.equal(confirmed.html.includes("600000000"), false, "customer email must not expose admin-only data");

  const rejected = appointmentCustomerEmail(appointment({ action: "deleted", status: "rejected" }));
  assertWellFormed(rejected);
  assert.match(rejected.subject, /No hemos podido confirmar/);

  for (const status of ["cancelled", "deleted"]) {
    const cancelled = appointmentCustomerEmail(appointment({ action: "deleted", status }));
    assertWellFormed(cancelled);
    assert.equal(cancelled.subject, "Tu cita ha sido cancelada · Focus Club");
  }
});

test("appointment emails are informational only: no CTA button or portal link", () => {
  const variants = [
    { action: "confirmed", status: "pending" },
    { action: "confirmed", status: "approved" },
    { action: "deleted", status: "rejected" },
    { action: "deleted", status: "cancelled" },
    { action: "deleted", status: "deleted" },
  ];
  for (const variant of variants) {
    for (const email of [appointmentCustomerEmail(appointment(variant)), appointmentAdminEmail(appointment(variant))]) {
      assert.equal(email.html.includes('class="fc-button"'), false);
      assert.equal(email.html.includes("v:roundrect"), false);
      assert.equal(email.html.includes("/portal"), false);
      assert.equal(email.text.includes("/portal"), false);
      assert.doesNotMatch(email.html, /Ver mis citas|Elegir otro horario/);
      assert.doesNotMatch(email.text, /Ver mis citas|Elegir otro horario/);
    }
  }
});

test("admin appointment email includes client details and status wording", () => {
  const pending = appointmentAdminEmail(appointment({ status: "pending" }));
  assertWellFormed(pending);
  assert.match(pending.subject, /^Nueva solicitud de cita · Lucía Pérez · /);
  for (const expected of ["lucia@example.com", "600000000", "45 min", "Bono Mensual de Entrenamiento", "apt-1", "Pendiente de aprobación"]) {
    assert.ok(pending.html.includes(expected), `missing ${expected}`);
    assert.ok(pending.text.includes(expected), `text missing ${expected}`);
  }

  assert.match(appointmentAdminEmail(appointment()).subject, /^Cita confirmada/);
  assert.match(appointmentAdminEmail(appointment({ action: "deleted", status: "cancelled" })).subject, /^Cita cancelada/);
  assert.match(appointmentAdminEmail(appointment({ action: "deleted", status: "rejected" })).subject, /^Cita rechazada/);
  assert.match(appointmentAdminEmail(appointment({ action: "deleted", status: "deleted" })).subject, /^Cita eliminada/);
});

test("appointment templates escape user-provided values", () => {
  const email = appointmentAdminEmail(appointment({ customerName: XSS, sessionType: XSS }));
  assert.equal(email.html.includes("<script>"), false);
  assert.match(email.html, /&lt;script&gt;/);
  // Plain text is never rendered as HTML, so values are kept verbatim.
  assert.match(email.text, /Cliente: <script>/);
});

test("welcome email", () => {
  const email = welcomeEmail({ customerName: "Lucía" });
  assertWellFormed(email);
  assert.equal(email.subject, "Bienvenido a Focus Club");
  assert.match(email.html, /Ir a mi portal/);
  assert.match(email.text, /Ir a mi portal: https:\/\/focusclub\.es\/portal/);
});

test("contact email keeps the message, escapes it and preserves line breaks", () => {
  const input = {
    name: "Ana",
    email: "ana@example.com",
    phone: "",
    subject: "Horarios",
    message: "Hola\n¿Abrís los sábados?",
    submittedAt: new Date("2026-09-30T10:00:00.000Z"),
  };
  const email = contactEmail(input);
  assertWellFormed(email);
  assert.equal(email.subject, "Nuevo mensaje de contacto - Focus Club - Horarios");
  assert.match(email.html, /Hola<br>¿Abrís los sábados\?/);
  assert.match(email.html, /No indicado/);
  assert.match(email.text, /Mensaje:\nHola\n¿Abrís los sábados\?/);
  assert.match(email.text, /Email: ana@example\.com/);

  const malicious = contactEmail({ ...input, message: `Hola\n${XSS}` });
  assert.equal(malicious.html.includes("<script>"), false);
  assert.match(malicious.html, /Hola<br>&lt;script&gt;/);
});

test("customer suggestion email", () => {
  const email = customerSuggestionEmail({
    suggestionId: "s-1",
    userName: "Cliente",
    userEmail: "cliente@example.com",
    subject: null,
    message: "Más horarios por la tarde",
    createdAt: "2026-07-16T10:30:00.000Z",
  });
  assertWellFormed(email);
  assert.equal(email.subject, "Nueva sugerencia de cliente · Cliente · Sin asunto");
  assert.match(email.html, /Más horarios por la tarde/);
  assert.match(email.text, /Sugerencia:\nMás horarios por la tarde/);
});
