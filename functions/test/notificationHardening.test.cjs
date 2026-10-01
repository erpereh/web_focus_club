// Regression tests for the production-readiness audit of customer notifications.
const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyBonoChange } = require("../lib/notifications/bonoEvents.js");
const {
  NOTIFICATION_DELIVERY_COLLECTION,
  notificationIdFor,
  notifyCustomer,
  purgeCustomerDeliveries,
  retryDueDeliveries,
} = require("../lib/notifications/dispatcher.js");
const {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  sendPushOnce,
} = require("../lib/notifications/push.js");
const {
  buildAppointmentNotice,
  buildSeriesNotice,
  buildSupportMessageNotice,
} = require("../lib/notifications/builders.js");
const { createNotificationHandlers } = require("../lib/notifications/handlers.js");
const {
  REMINDER_MIN_GAP_AFTER_NOTICE_MS,
  hasRecentScheduleNotice,
} = require("../lib/notifications/schedules.js");
const {
  FCM_TOKEN_STALE_MS,
  claimFcmTokenForUser,
  pruneStaleFcmTokens,
  tokenOwnerUid,
} = require("../lib/notifications/tokens.js");
const { appointmentSeriesEmail } = require("../lib/email/templates/series.js");
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
    fechaExpiracion: "2026-10-08T21:59:59.999Z",
    ...overrides,
  };
}

function handlers(initial = {}, { now = NOW } = {}) {
  const fixture = createFakeFirestore({ ...customerDocs(), ...initial });
  const messaging = createFakeMessaging();
  const email = createFakeEmailClient();
  let clock = now.getTime();
  const h = createNotificationHandlers({
    db: fixture.db,
    messaging,
    getEmailClient: () => email,
    now: () => clock,
    nowDate: () => new Date(clock),
  });
  return { ...fixture, messaging, email, h, advance: (ms) => { clock += ms; } };
}

function historyEntries(documents, uid = "user-1") {
  return [...documents.entries()].filter(([key]) => key.startsWith(`users/${uid}/notifications/`));
}

// ------------------------------------------------- 1. replaced / exhausted bonos

test("bono_expired is only sent for an active bono that still had minutes", () => {
  const event = (before, after) => classifyBonoChange(before, after, { hadPreviousBono: false })?.event ?? null;
  assert.equal(event(bono(), bono({ estado: "expirado" })), "bono_expired");
  // Replaced on renewal (agotado with minutes left).
  assert.equal(event(bono({ estado: "agotado", minutosRestantes: 60 }), bono({ estado: "expirado", minutosRestantes: 60 })), null);
  // Exhausted naturally: the customer already got bono_exhausted.
  assert.equal(event(bono({ estado: "agotado", minutosRestantes: 0 }), bono({ estado: "expirado", minutosRestantes: 0 })), null);
  // Active but with no minutes left.
  assert.equal(event(bono({ minutosRestantes: 0 }), bono({ estado: "expirado", minutosRestantes: 0 })), null);
});

test("validity changes are only announced for the active bono", () => {
  const event = (before, after) => classifyBonoChange(before, after, { hadPreviousBono: false })?.event ?? null;
  const moved = { fechaExpiracion: "2026-10-20T21:59:59.999Z" };
  assert.equal(event(bono(), bono(moved)), "bono_validity_changed");
  assert.equal(event(bono({ estado: "agotado", minutosRestantes: 60 }), bono({ estado: "agotado", minutosRestantes: 60, ...moved })), null);
});

test("scheduler expiring a replaced bono marks it expired without notifying the customer", async () => {
  const { h, documents, messaging, email } = handlers({
    "bonos/old": bono({ estado: "agotado", minutosRestantes: 60, fechaExpiracion: "2026-09-30T21:59:59.999Z" }),
    "bonos/new": bono({ minutosRestantes: 240, fechaExpiracion: "2026-12-31T22:59:59.999Z" }),
  });
  const before = { ...documents.get("bonos/old") };
  assert.equal(await h.runExpireOverdueBonos(), 1);
  const after = documents.get("bonos/old");
  assert.equal(after.estado, "expirado");
  await h.onBonoWritten({ eventId: "e1", bonoId: "old", before, after });
  assert.equal(messaging.calls.length, 0);
  assert.equal(email.calls.length, 0);
  assert.equal(historyEntries(documents).length, 0);
});

// ------------------------------------------------- 2. bulk administrative changes

test("a bulk recalculation is recorded in the history only: no push and no email", async () => {
  const { h, documents, messaging, email } = handlers({ "bonos/b1": bono() });
  const before = bono();
  const after = bono({ fechaExpiracion: "2026-11-30T22:59:59.999Z", notificationBulkOperationId: "bulk-1" });
  await h.onBonoWritten({ eventId: "e1", bonoId: "b1", before, after });
  assert.equal(messaging.calls.length, 0);
  assert.equal(email.calls.length, 0);
  const history = historyEntries(documents);
  assert.equal(history.length, 1);
  assert.equal(history[0][1].event, "bono_validity_changed");

  // A bulk run that expires a bono is quiet too.
  await h.onBonoWritten({
    eventId: "e2",
    bonoId: "b1",
    before: after,
    after: { ...after, estado: "expirado", notificationBulkOperationId: "bulk-2" },
  });
  assert.equal(messaging.calls.length, 0);
  assert.equal(email.calls.length, 0);
});

test("a later individual change on a bulk-stamped bono notifies normally", async () => {
  const { h, messaging, email } = handlers({ "bonos/b1": bono() });
  const stamped = bono({ notificationBulkOperationId: "bulk-1" });
  await h.onBonoWritten({
    eventId: "e1",
    bonoId: "b1",
    before: stamped,
    after: { ...stamped, fechaExpiracion: "2026-10-25T21:59:59.999Z" },
  });
  assert.equal(messaging.calls.length, 1);
  assert.equal(email.calls.length, 1);
});

// ------------------------------------------------- 3. FCM token lifecycle

test("a device token belongs only to the last account that registered it", async () => {
  const { db, documents } = createFakeFirestore({
    ...customerDocs("user-a"),
    ...customerDocs("user-b"),
    "users/user-a/fcmTokens/shared": { token: "shared", platform: "android" },
    "users/user-b/fcmTokens/shared": { token: "shared", platform: "android" },
  });
  assert.equal(await claimFcmTokenForUser(db, "user-b", "shared"), 1);
  assert.equal(documents.has("users/user-a/fcmTokens/shared"), false);
  assert.equal(documents.has("users/user-b/fcmTokens/shared"), true);
  // Other tokens of the previous owner are untouched.
  assert.equal(documents.has("users/user-a/fcmTokens/token-1"), true);
  assert.equal(await claimFcmTokenForUser(db, "user-b", "shared"), 0);
});

test("after a token moves, the previous customer's notices no longer reach that device", async () => {
  const { db } = createFakeFirestore({
    ...customerDocs("user-a"),
    "users/user-a/fcmTokens/token-1": { token: "shared-phone", platform: "ios" },
    "users/user-b": { uid: "user-b", pushNotificationsEnabled: true },
    "users/user-b/fcmTokens/shared-phone": { token: "shared-phone", platform: "ios" },
  });
  await claimFcmTokenForUser(db, "user-b", "shared-phone");
  const messaging = createFakeMessaging();
  const outcome = await sendPushOnce({
    db,
    messaging,
    uid: "user-a",
    dedupeKey: "k1",
    content: { notification: { title: "t", body: "b" }, data: { type: "appointment_status" } },
  });
  assert.deepEqual(outcome, { status: "skipped", reason: "no_tokens" });
  assert.equal(messaging.calls.length, 0);
});

test("stale device registrations are pruned after 270 days without refresh", async () => {
  const old = new Date(NOW.getTime() - FCM_TOKEN_STALE_MS - 1000);
  const recent = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  const { db, documents } = createFakeFirestore({
    "users/u1/fcmTokens/old": { token: "old", updatedAt: old },
    "users/u1/fcmTokens/recent": { token: "recent", updatedAt: recent },
  });
  assert.equal(await pruneStaleFcmTokens(db, NOW), 1);
  assert.equal(documents.has("users/u1/fcmTokens/old"), false);
  assert.equal(documents.has("users/u1/fcmTokens/recent"), true);
  assert.equal(tokenOwnerUid("users/u1/fcmTokens/old"), "u1");
  assert.equal(tokenOwnerUid("other/u1/fcmTokens/old"), undefined);
});

// ------------------------------------------------- 4. production push options

test("every push carries the Android channel, high priority and an APNs sound", async () => {
  const { db } = createFakeFirestore(customerDocs());
  const messaging = createFakeMessaging();
  await notifyCustomer(
    { db, messaging, getEmailClient: () => createFakeEmailClient(), now: () => NOW.getTime() },
    buildSupportMessageNotice({ uid: "user-1", conversationId: "c1", messageId: "m1" }),
  );
  const [message] = messaging.calls;
  assert.equal(ANDROID_NOTIFICATION_CHANNEL_ID, "focus_club_default");
  assert.equal(message.android.priority, "high");
  assert.equal(message.android.notification.channelId, "focus_club_default");
  assert.equal(message.apns.payload.aps.sound, "default");
  assert.equal(message.apns.headers["apns-push-type"], "alert");
  // The shared data contract is unchanged.
  assert.deepEqual(Object.keys(message.data).sort(), ["conversationId", "event", "notificationId", "route", "type"]);
});

// ------------------------------------------------- 5. refund wording

function cancelledNotice(overrides = {}) {
  return buildAppointmentNotice({
    uid: "user-1",
    dedupeKey: "appt:e1",
    event: "appointment_cancelled",
    appointmentId: "apt-1",
    status: "cancelled",
    customerName: "Lucía Pérez",
    customerEmail: "lucia@example.com",
    slot: { date: "2026-10-05", time: "10:15" },
    sessionType: "Entrenamiento",
    trainerName: "",
    ...overrides,
  });
}

test("cancel and delete notices never claim a refund that is not recorded", () => {
  for (const event of ["appointment_cancelled", "appointment_deleted"]) {
    const notice = cancelledNotice({ event, status: event === "appointment_deleted" ? "deleted" : "cancelled" });
    assert.doesNotMatch(notice.body, /devuelto/);
    assert.doesNotMatch(notice.channels.email.text, /devuelto/);
    assert.doesNotMatch(notice.channels.email.html, /devuelto/);
  }
  const refunded = cancelledNotice({ minutesRefunded: true });
  assert.match(refunded.body, /Los minutos reservados se han devuelto a tu bono\./);
  assert.match(refunded.channels.email.text, /se han devuelto a tu bono/);
});

test("appointment trigger mentions the refund only when minutesRefundedAt is set", async () => {
  const { h, messaging } = handlers();
  const before = { userId: "user-1", name: "Lucía", email: "lucia@example.com", status: "approved", approvedSlot: { date: "2026-10-05", time: "10:00" } };
  await h.onAppointmentWritten({ eventId: "e1", appointmentId: "a1", before, after: { ...before, status: "cancelled" } });
  await h.onAppointmentWritten({
    eventId: "e2",
    appointmentId: "a2",
    before,
    after: { ...before, status: "cancelled", minutesRefundedAt: "2026-10-01T08:00:00.000Z" },
  });
  assert.doesNotMatch(messaging.calls[0].notification.body, /devuelto/);
  assert.match(messaging.calls[1].notification.body, /devuelto/);
});

test("series rejection and cancellation only claim refunds the operation recorded", () => {
  const base = {
    uid: "user-1",
    operationId: "op-1",
    seriesId: "s1",
    appointmentIds: ["a1", "a2"],
    sessions: [{ date: "2026-10-05", time: "10:00" }, { date: "2026-10-12", time: "10:00" }],
    customerName: "Lucía Pérez",
    customerEmail: "lucia@example.com",
  };
  for (const event of ["appointment_series_rejected", "appointment_series_cancelled"]) {
    const silent = buildSeriesNotice({ ...base, event });
    assert.doesNotMatch(silent.body, /devuelto/);
    assert.doesNotMatch(silent.channels.email.text, /devuelto/);
    const refunded = buildSeriesNotice({ ...base, event, refundedMinutes: 120 });
    assert.match(refunded.body, /devuelto/);
    assert.match(refunded.channels.email.text, /Se han devuelto 120 minutos reservados a tu bono\./);
  }
  assert.doesNotMatch(appointmentSeriesEmail("appointment_series_cancelled", { customerName: "Lucía", sessions: [] }).text, /devuelto/);
});

test("outbox refundedMinutes reaches the grouped series notice", async () => {
  const { h, messaging, email } = handlers();
  await h.onOutboxCreated({
    operationId: "op-1",
    entry: {
      userId: "user-1",
      event: "appointment_series_cancelled",
      seriesId: "s1",
      appointmentIds: ["a1"],
      sessions: [{ date: "2026-10-05", time: "10:00" }],
      cancelledSessions: [],
      customerName: "Lucía Pérez",
      customerEmail: "lucia@example.com",
      actor: "customer",
      createdAt: NOW.toISOString(),
      refundedMinutes: 60,
    },
  });
  assert.match(messaging.calls[0].notification.body, /devuelto/);
  assert.match(email.calls[0].message.text, /60 minutos/);
});

// ------------------------------------------------- 6. retry queue

test("retry sweep reads due deliveries first even behind many future ones", async () => {
  const initial = { ...customerDocs() };
  for (let index = 0; index < 250; index += 1) {
    initial[`${NOTIFICATION_DELIVERY_COLLECTION}/future-${index}`] = {
      uid: "user-1",
      status: "retrying",
      nextAttemptAtMillis: NOW.getTime() + 60 * 60 * 1000 + index,
    };
  }
  initial[`${NOTIFICATION_DELIVERY_COLLECTION}/done`] = { uid: "user-1", status: "complete", nextAttemptAtMillis: null };
  const { db, documents } = createFakeFirestore(initial);
  const messaging = createFakeMessaging();
  const d = { db, messaging, getEmailClient: () => createFakeEmailClient(), now: () => NOW.getTime() };
  const notice = buildSupportMessageNotice({ uid: "user-1", conversationId: "c1", messageId: "m1" });
  const id = notificationIdFor(notice.dedupeKey);
  documents.set(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`, {
    uid: "user-1",
    dedupeKey: notice.dedupeKey,
    type: notice.category,
    event: notice.event,
    status: "retrying",
    attempts: 1,
    nextAttemptAtMillis: NOW.getTime() - 1,
    notification: JSON.parse(JSON.stringify(notice)),
    push: null,
    channels: { history: { status: "sent" }, push: { status: "failed" } },
  });
  assert.equal(await retryDueDeliveries(d, 100), 1);
  assert.equal(documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`).status, "complete");
  assert.equal(messaging.calls.length, 1);
});

test("deliveries record their appointments and creation time for later lookups", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const notice = cancelledNotice({ event: "appointment_confirmed", status: "approved" });
  await notifyCustomer({ db, messaging: createFakeMessaging(), getEmailClient: () => createFakeEmailClient(), now: () => 42 }, notice);
  const delivery = documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${notificationIdFor(notice.dedupeKey)}`);
  assert.deepEqual(delivery.appointmentIds, ["apt-1"]);
  assert.equal(delivery.createdAtMillis, 42);
  assert.equal(delivery.nextAttemptAtMillis, null);
});

// ------------------------------------------------- 7. reminders after confirmations

test("hasRecentScheduleNotice only counts confirmations and changes inside the gap", () => {
  const at = (ms) => NOW.getTime() - ms;
  assert.equal(hasRecentScheduleNotice([{ event: "appointment_confirmed", createdAtMillis: at(60_000) }], NOW), true);
  assert.equal(hasRecentScheduleNotice([{ event: "appointment_series_rescheduled", createdAtMillis: at(60_000) }], NOW), true);
  assert.equal(hasRecentScheduleNotice([{ event: "appointment_confirmed", createdAtMillis: at(REMINDER_MIN_GAP_AFTER_NOTICE_MS) }], NOW), false);
  assert.equal(hasRecentScheduleNotice([{ event: "appointment_requested", createdAtMillis: at(60_000) }], NOW), false);
  assert.equal(hasRecentScheduleNotice([{ event: "appointment_confirmed" }], NOW), false);
});

test("no reminder right after a confirmation; it goes out once the gap has passed", async () => {
  const appointment = {
    userId: "user-1",
    name: "Lucía",
    email: "lucia@example.com",
    status: "approved",
    approvedSlot: { date: "2026-10-02", time: "09:00" }, // 23 h ahead
  };
  const { h, messaging, advance } = handlers({ "appointments/apt-1": appointment });
  await h.onAppointmentWritten({ eventId: "e1", appointmentId: "apt-1", before: { ...appointment, status: "pending" }, after: appointment });
  assert.equal(messaging.calls.length, 1);
  assert.equal(messaging.calls[0].data.event, "appointment_confirmed");

  assert.equal(await h.runAppointmentReminders(), 0);
  advance(REMINDER_MIN_GAP_AFTER_NOTICE_MS - 15 * 60 * 1000);
  assert.equal(await h.runAppointmentReminders(), 0);
  advance(15 * 60 * 1000);
  assert.equal(await h.runAppointmentReminders(), 1);
  assert.equal(messaging.calls.at(-1).data.event, "appointment_reminder");
});

test("a grouped series confirmation also holds back the reminder", async () => {
  const appointment = { userId: "user-1", status: "approved", approvedSlot: { date: "2026-10-02", time: "09:00" } };
  const { h, messaging } = handlers({ "appointments/a1": appointment });
  await h.onOutboxCreated({
    operationId: "op-1",
    entry: {
      userId: "user-1",
      event: "appointment_series_confirmed",
      seriesId: "s1",
      appointmentIds: ["a1", "a2"],
      sessions: [{ date: "2026-10-02", time: "09:00" }],
      cancelledSessions: [],
      customerName: "Lucía Pérez",
      customerEmail: "lucia@example.com",
      actor: "admin",
      createdAt: NOW.toISOString(),
    },
  });
  assert.equal(await h.runAppointmentReminders(), 0);
  assert.equal(messaging.calls.length, 1);
});

// ------------------------------------------------- 9. deleted customers

test("no notice is created for a customer whose account was deleted", async () => {
  const { db, documents } = createFakeFirestore({});
  const messaging = createFakeMessaging();
  const email = createFakeEmailClient();
  const outcome = await notifyCustomer(
    { db, messaging, getEmailClient: () => email, now: () => NOW.getTime() },
    cancelledNotice(),
  );
  assert.equal(outcome.status, "complete");
  assert.equal(outcome.channels.history.status, "skipped");
  assert.equal(messaging.calls.length, 0);
  assert.equal(email.calls.length, 0);
  assert.equal(documents.size, 0);
});

test("a queued delivery whose customer was deleted never recreates the history", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const notice = cancelledNotice();
  const failingEmail = createFakeEmailClient(() => { throw new Error("Brevo down"); });
  const messaging = createFakeMessaging(() => { throw new Error("FCM down"); });
  let clock = NOW.getTime();
  const d = { db, messaging, getEmailClient: () => failingEmail, now: () => clock };
  // History is written, push and email fail and are queued for retry.
  await notifyCustomer(d, notice);
  const id = notificationIdFor(notice.dedupeKey);
  assert.equal(documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`).status, "retrying");

  // The admin deletes the customer.
  await db.recursiveDelete(db.collection("users").doc("user-1"));
  clock += 24 * 60 * 60 * 1000;
  const email = createFakeEmailClient();
  await retryDueDeliveries({ ...d, getEmailClient: () => email });
  assert.equal(email.calls.length, 0);
  assert.equal(historyEntries(documents).length, 0);
  assert.equal([...documents.keys()].some((key) => key.startsWith("users/user-1")), false);
  assert.equal(documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`).status, "complete");
});

test("purgeCustomerDeliveries removes only that customer's ledger", async () => {
  const { db, documents } = createFakeFirestore({
    [`${NOTIFICATION_DELIVERY_COLLECTION}/a`]: { uid: "user-1", status: "retrying" },
    [`${NOTIFICATION_DELIVERY_COLLECTION}/b`]: { uid: "user-1", status: "complete" },
    [`${NOTIFICATION_DELIVERY_COLLECTION}/c`]: { uid: "user-2", status: "retrying" },
  });
  assert.equal(await purgeCustomerDeliveries(db, "user-1"), 2);
  assert.deepEqual([...documents.keys()], [`${NOTIFICATION_DELIVERY_COLLECTION}/c`]);
});
