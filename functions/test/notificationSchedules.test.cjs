const assert = require("node:assert/strict");
const test = require("node:test");

const {
  madridDaysUntil,
  planAppointmentReminders,
  planBonoExpiryWarnings,
  planOverdueBonos,
} = require("../lib/notifications/schedules.js");
const { createNotificationHandlers } = require("../lib/notifications/handlers.js");
const {
  createFakeEmailClient,
  createFakeFirestore,
  createFakeMessaging,
  customerDocs,
  silenceConsole,
} = require("./helpers/notificationFakes.cjs");

let restoreConsole;
test.beforeEach(() => { restoreConsole = silenceConsole(); });
test.afterEach(() => restoreConsole());

const NOW = new Date("2026-10-01T08:00:00.000Z"); // Thu 10:00 Madrid (CEST)

function bono(overrides = {}) {
  return {
    userId: "user-1",
    estado: "activo",
    tamano: 240,
    minutosTotales: 240,
    minutosRestantes: 90,
    fechaAsignacion: "2026-07-01T00:00:00.000Z",
    fechaExpiracion: "2026-10-08T21:59:59.999Z", // end of 8 Oct in Madrid
    ...overrides,
  };
}

test("madridDaysUntil counts civil days in Europe/Madrid, including across the DST change", () => {
  assert.equal(madridDaysUntil("2026-10-08", NOW), 7);
  // 23:30 Madrid on 1 Oct vs 00:30 Madrid on 2 Oct.
  assert.equal(madridDaysUntil("2026-10-08", new Date("2026-10-01T21:30:00.000Z")), 7);
  assert.equal(madridDaysUntil("2026-10-08", new Date("2026-10-01T22:30:00.000Z")), 6);
  // 25 Oct 2026 is the CEST -> CET switch.
  assert.equal(madridDaysUntil("2026-11-01", new Date("2026-10-24T22:30:00.000Z")), 7);
});

test("expiry warnings fire at exactly 7 and 2 days with a date-scoped dedupe key", () => {
  const warnings = planBonoExpiryWarnings([
    { id: "b7", data: bono() },
    { id: "b2", data: bono({ fechaExpiracion: "2026-10-03T21:59:59.999Z" }) },
    { id: "b5", data: bono({ fechaExpiracion: "2026-10-06T21:59:59.999Z" }) },
    { id: "empty", data: bono({ minutosRestantes: 0 }) },
    { id: "agotado", data: bono({ estado: "agotado" }) },
    { id: "dateOnly", data: bono({ fechaExpiracion: "2026-10-08" }) },
  ], NOW);
  assert.deepEqual(warnings.map((w) => [w.bonoId, w.event, w.dedupeKey]), [
    ["b7", "bono_expiring_7d", "bono:b7:bono_expiring_7d:2026-10-08"],
    ["b2", "bono_expiring_2d", "bono:b2:bono_expiring_2d:2026-10-03"],
    ["dateOnly", "bono_expiring_7d", "bono:dateOnly:bono_expiring_7d:2026-10-08"],
  ]);
  // Moving the expiry re-arms the warning with a new key.
  const moved = planBonoExpiryWarnings([{ id: "b7", data: bono({ fechaExpiracion: "2026-10-03T21:59:59.999Z" }) }], NOW);
  assert.equal(moved[0].dedupeKey, "bono:b7:bono_expiring_2d:2026-10-03");
});

test("overdue bonos are active/exhausted ones past their expiry instant", () => {
  const overdue = planOverdueBonos([
    { id: "past", data: bono({ fechaExpiracion: "2026-09-30T21:59:59.999Z" }) },
    { id: "pastAgotado", data: bono({ estado: "agotado", fechaExpiracion: "2026-09-30T21:59:59.999Z" }) },
    { id: "future", data: bono() },
    { id: "alreadyExpired", data: bono({ estado: "expirado", fechaExpiracion: "2026-09-30T21:59:59.999Z" }) },
    { id: "deleted", data: bono({ estado: "eliminado", fechaExpiracion: "2026-09-30T21:59:59.999Z" }) },
  ], NOW);
  assert.deepEqual(overdue, ["past", "pastAgotado"]);
});

function appointment(overrides = {}) {
  return {
    userId: "user-1",
    status: "approved",
    approvedSlot: { date: "2026-10-02", time: "09:00" },
    ...overrides,
  };
}

test("reminders cover approved sessions starting within (now + 2 h, now + 24 h]", () => {
  const reminders = planAppointmentReminders([
    { id: "in23h", data: appointment() },
    { id: "exactly24h", data: appointment({ approvedSlot: { date: "2026-10-02", time: "10:00" } }) },
    { id: "in25h", data: appointment({ approvedSlot: { date: "2026-10-02", time: "11:00" } }) },
    { id: "in1h", data: appointment({ approvedSlot: { date: "2026-10-01", time: "11:00" } }) },
    { id: "pending", data: appointment({ status: "pending" }) },
    { id: "legacy", data: { userId: "user-1", status: "approved", date: "2026-10-01", time: "20:00" } },
    { id: "in23h", data: appointment() },
  ], NOW);
  assert.deepEqual(reminders.map((r) => r.appointmentId), ["in23h", "exactly24h", "legacy"]);
});

function handlers(initial) {
  const fixture = createFakeFirestore({ ...customerDocs(), ...initial });
  const messaging = createFakeMessaging();
  const email = createFakeEmailClient();
  const h = createNotificationHandlers({
    db: fixture.db,
    messaging,
    getEmailClient: () => email,
    now: () => NOW.getTime(),
    nowDate: () => NOW,
  });
  return { ...fixture, messaging, email, h };
}

test("bono expiry warning scheduler: email + push + history, once per bono and expiry date", async () => {
  const { h, messaging, email, documents } = handlers({ "bonos/b7": bono() });
  assert.equal(await h.runBonoExpiryWarnings(), 1);
  assert.equal(await h.runBonoExpiryWarnings(), 1);
  assert.equal(messaging.calls.length, 1);
  assert.equal(email.calls.length, 1);
  assert.deepEqual(messaging.calls[0].data, {
    type: "bono_status",
    event: "bono_expiring_7d",
    notificationId: messaging.calls[0].data.notificationId,
    route: "bono",
    bonoId: "b7",
  });
  assert.equal(email.calls[0].message.subject, "Tu bono caduca en 7 días · Focus Club");
  const history = [...documents.entries()].filter(([key]) => key.startsWith("users/user-1/notifications/"));
  assert.equal(history.length, 1);
  assert.equal(history[0][1].type, "bono_status");
  assert.equal(history[0][1].event, "bono_expiring_7d");
  assert.equal(history[0][1].bonoId, "b7");
});

test("expiry scheduler marks overdue bonos expired; the bono trigger then notifies once", async () => {
  const { h, documents, messaging, email } = handlers({
    "bonos/old": bono({ fechaExpiracion: "2026-09-30T21:59:59.999Z" }),
  });
  const before = { ...documents.get("bonos/old") };
  assert.equal(await h.runExpireOverdueBonos(), 1);
  const after = documents.get("bonos/old");
  assert.equal(after.estado, "expirado");
  assert.equal(after.expiredBy, "scheduler");

  await h.onBonoWritten({ eventId: "e1", bonoId: "old", before, after });
  await h.onBonoWritten({ eventId: "e2", bonoId: "old", before, after });
  assert.equal(messaging.calls.length, 1);
  assert.equal(messaging.calls[0].data.event, "bono_expired");
  assert.equal(email.calls.length, 1);
});

test("appointment reminder scheduler: push + history only, neutral wording, once per slot", async () => {
  const { h, messaging, email, documents } = handlers({
    "appointments/apt-1": appointment(),
    "appointments/apt-far": appointment({ approvedSlot: { date: "2026-10-03", time: "09:00" } }),
  });
  assert.equal(await h.runAppointmentReminders(), 1);
  assert.equal(await h.runAppointmentReminders(), 1);
  assert.equal(messaging.calls.length, 1);
  assert.equal(email.calls.length, 0);
  const push = messaging.calls[0];
  assert.equal(push.notification.title, "Recordatorio de tu cita");
  assert.doesNotMatch(push.notification.body, /24|horas|mañana/);
  assert.match(push.notification.body, /2 de octubre a las 09:00/);
  assert.equal(push.data.type, "appointment_status");
  assert.equal(push.data.event, "appointment_reminder");
  assert.equal(push.data.appointmentId, "apt-1");

  // Moving the session re-arms the reminder.
  documents.set("appointments/apt-1", appointment({ approvedSlot: { date: "2026-10-02", time: "09:30" } }));
  await h.runAppointmentReminders();
  assert.equal(messaging.calls.length, 2);
});

test("bono trigger: renewal notifies renewed for the new bono and nothing for the replaced one", async () => {
  const { h, messaging } = handlers({
    "bonos/old": bono({ minutosRestantes: 60, estado: "agotado" }),
    "bonos/new": bono({ minutosRestantes: 240 }),
  });
  await h.onBonoWritten({ eventId: "e1", bonoId: "old", before: bono({ minutosRestantes: 60 }), after: bono({ minutosRestantes: 60, estado: "agotado" }) });
  await h.onBonoWritten({ eventId: "e2", bonoId: "new", after: bono({ minutosRestantes: 240 }) });
  assert.equal(messaging.calls.length, 1);
  assert.equal(messaging.calls[0].data.event, "bono_renewed");
});

test("bono trigger: first bono is assigned", async () => {
  const { h, messaging, email } = handlers({ "bonos/first": bono() });
  await h.onBonoWritten({ eventId: "e1", bonoId: "first", after: bono() });
  assert.equal(messaging.calls[0].data.event, "bono_assigned");
  assert.equal(email.calls[0].message.category, "bono_customer");
});

test("appointment trigger resolves trainer name and dedupes per event id", async () => {
  const { h, messaging, email } = handlers({ "trainers/t1": { name: "Carlos" } });
  const before = { userId: "user-1", name: "Lucía", email: "lucia@example.com", status: "approved", approvedSlot: { date: "2026-10-05", time: "10:00" }, assignedTrainer: "t1" };
  const after = { ...before, approvedSlot: { date: "2026-10-06", time: "10:00" } };
  await h.onAppointmentWritten({ eventId: "evt-1", appointmentId: "apt-1", before, after });
  await h.onAppointmentWritten({ eventId: "evt-1", appointmentId: "apt-1", before, after });
  assert.equal(messaging.calls.length, 1);
  assert.equal(messaging.calls[0].data.event, "appointment_rescheduled");
  assert.match(messaging.calls[0].notification.body, /con Carlos/);
  assert.match(email.calls[0].message.html, /Antes/);
});

test("support chat handler: push + history, idempotent per message", async () => {
  const { h, messaging } = handlers({});
  await h.notifySupportMessage({ userId: "user-1", conversationId: "c1", messageId: "m1" });
  await h.notifySupportMessage({ userId: "user-1", conversationId: "c1", messageId: "m1" });
  await h.notifySupportMessage({ userId: "user-1", conversationId: "c1", messageId: "m2" });
  assert.equal(messaging.calls.length, 2);
});
