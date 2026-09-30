const assert = require("node:assert/strict");
const test = require("node:test");

const { createNotificationHandlers } = require("../lib/notifications/handlers.js");
const { buildSeriesNotice } = require("../lib/notifications/builders.js");
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

function outboxEntry(overrides = {}) {
  return {
    userId: "user-1",
    event: "appointment_series_rescheduled",
    seriesId: "series-1",
    appointmentIds: ["a1", "a2", "a3"],
    sessions: [
      { date: "2026-10-12", time: "10:00" },
      { date: "2026-10-05", time: "10:00" },
    ],
    cancelledSessions: [{ date: "2026-10-19", time: "10:00" }],
    customerName: "Lucía Pérez",
    customerEmail: "lucia@example.com",
    actor: "admin",
    createdAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const fixture = createFakeFirestore(customerDocs());
  const messaging = createFakeMessaging();
  const email = createFakeEmailClient();
  const handlers = createNotificationHandlers({
    db: fixture.db,
    messaging,
    getEmailClient: () => email,
    now: () => Date.parse("2026-10-01T08:00:00.000Z"),
  });
  return { ...fixture, messaging, email, handlers };
}

test("one outbox entry produces exactly one push, one email and one history entry", async () => {
  const { handlers, messaging, email, documents } = setup();
  await handlers.onOutboxCreated({ operationId: "op-1", entry: outboxEntry() });
  // Trigger redelivery of the same outbox document.
  await handlers.onOutboxCreated({ operationId: "op-1", entry: outboxEntry() });

  assert.equal(messaging.calls.length, 1);
  assert.equal(email.calls.length, 1);
  const history = [...documents.entries()].filter(([key]) => key.startsWith("users/user-1/notifications/"));
  assert.equal(history.length, 1);

  const data = messaging.calls[0].data;
  assert.equal(data.type, "appointment_status");
  assert.equal(data.event, "appointment_series_rescheduled");
  assert.equal(data.seriesId, "series-1");
  assert.equal(data.appointmentIds, "a1,a2,a3");
  assert.equal(data.appointmentId, "a1");
  assert.equal(data.route, "appointments");
  assert.equal(history[0][1].type, "appointment_status");
  assert.equal(history[0][1].event, "appointment_series_rescheduled");
  assert.deepEqual(history[0][1].appointmentIds, ["a1", "a2", "a3"]);
  assert.deepEqual(history[0][1].navigation, { route: "appointments", params: { seriesId: "series-1" } });

  const message = email.calls[0].message;
  assert.equal(message.category, "appointment_series_customer");
  assert.equal(message.subject, "Tus citas recurrentes han cambiado · Focus Club");
  // Sessions are sorted and cancelled ones listed.
  assert.ok(message.text.indexOf("5 de octubre") < message.text.indexOf("12 de octubre"));
  assert.match(message.text, /Cancelada: .*19 de octubre/);
});

test("different operations on the same series are separate notices", async () => {
  const { handlers, messaging } = setup();
  await handlers.onOutboxCreated({ operationId: "op-1", entry: outboxEntry() });
  await handlers.onOutboxCreated({ operationId: "op-2", entry: outboxEntry({ event: "appointment_series_confirmed" }) });
  assert.deepEqual(messaging.calls.map((call) => call.data.event), [
    "appointment_series_rescheduled",
    "appointment_series_confirmed",
  ]);
});

test("missing customer identity on the outbox falls back to the user profile", async () => {
  const { handlers, email } = setup();
  await handlers.onOutboxCreated({
    operationId: "op-3",
    entry: outboxEntry({ customerName: "", customerEmail: "" }),
  });
  assert.deepEqual(email.calls[0].message.to, [{ email: "lucia@example.com", name: "Lucía Pérez" }]);
});

test("series notice copy per event with singular/plural and status", () => {
  const base = {
    uid: "user-1",
    operationId: "op",
    seriesId: "s",
    appointmentIds: ["a1"],
    sessions: [{ date: "2026-10-05", time: "10:00" }],
    customerName: "Lucía",
    customerEmail: "lucia@example.com",
  };
  const expected = {
    appointment_series_requested: ["pending", /1 sesión/],
    appointment_series_confirmed: ["approved", /Se han confirmado 1 sesión/],
    appointment_series_rejected: ["rejected", /1 sesión/],
    appointment_series_cancelled: ["cancelled", /1 sesión/],
    appointment_series_rescheduled: ["approved", /1 sesión/],
    appointment_series_returned_to_pending: ["pending", /1 sesión vuelve/],
  };
  for (const [event, [status, body]] of Object.entries(expected)) {
    const notice = buildSeriesNotice({ ...base, event });
    assert.equal(notice.category, "appointment_status");
    assert.equal(notice.event, event);
    assert.equal(notice.related.status, status);
    assert.equal(notice.dedupeKey, "op:op");
    assert.match(notice.body, body);
    assert.ok(notice.channels.email);
  }
});
