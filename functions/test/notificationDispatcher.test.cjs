const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DELIVERY_MAX_ATTEMPTS,
  NOTIFICATION_DELIVERY_COLLECTION,
  buildPushContent,
  deliveryBackoffMs,
  notificationIdFor,
  notifyCustomer,
  retryDueDeliveries,
} = require("../lib/notifications/dispatcher.js");
const { sendPushOnce } = require("../lib/notifications/push.js");
const { buildAppointmentNotice, buildSupportMessageNotice } = require("../lib/notifications/builders.js");
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

function appointmentNotice(overrides = {}) {
  return buildAppointmentNotice({
    uid: "user-1",
    dedupeKey: "appt:evt-1",
    event: "appointment_confirmed",
    appointmentId: "apt-1",
    status: "approved",
    customerName: "Lucía Pérez",
    customerEmail: "lucia@example.com",
    slot: { date: "2026-10-05", time: "10:15" },
    sessionType: "Entrenamiento",
    trainerName: "Carlos",
    ...overrides,
  });
}

function deps(db, { messaging = createFakeMessaging(), email = createFakeEmailClient(), now = 1_000_000 } = {}) {
  let clock = now;
  return {
    messaging,
    email,
    tick: (ms) => { clock += ms; },
    deps: { db, messaging, getEmailClient: () => email, now: () => clock },
  };
}

test("delivers history, push and email with the same type/event contract", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const { deps: d, messaging, email } = deps(db);
  const notice = appointmentNotice();

  const outcome = await notifyCustomer(d, notice);

  const id = notificationIdFor("appt:evt-1");
  assert.equal(outcome.status, "complete");
  assert.deepEqual(Object.keys(outcome.channels).sort(), ["email", "history", "push"]);

  const history = documents.get(`users/user-1/notifications/${id}`);
  assert.equal(history.type, "appointment_status");
  assert.equal(history.event, "appointment_confirmed");
  assert.equal(history.read, false);
  assert.equal(history.appointmentId, "apt-1");
  assert.equal(history.status, "approved");
  assert.deepEqual(history.navigation, { route: "appointment", params: { appointmentId: "apt-1" } });
  assert.equal(typeof history.createdAt.toMillis, "function");

  assert.equal(messaging.calls.length, 1);
  const data = messaging.calls[0].data;
  assert.deepEqual(data, {
    type: "appointment_status",
    event: "appointment_confirmed",
    notificationId: id,
    route: "appointment",
    appointmentId: "apt-1",
    status: "approved",
  });
  assert.ok(Object.values(data).every((value) => typeof value === "string"));
  assert.equal(history.title, messaging.calls[0].notification.title);

  assert.equal(email.calls.length, 1);
  assert.deepEqual(email.calls[0].message.to, [{ email: "lucia@example.com", name: "Lucía Pérez" }]);

  const delivery = documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`);
  assert.equal(delivery.status, "complete");
  assert.equal(delivery.channels.email.messageId, "brevo-1");
});

test("same dedupe key never duplicates history, push or email", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const { deps: d, messaging, email } = deps(db);
  await notifyCustomer(d, appointmentNotice());
  await notifyCustomer(d, appointmentNotice());
  assert.equal(messaging.calls.length, 1);
  assert.equal(email.calls.length, 1);
  const histories = [...documents.keys()].filter((key) => key.startsWith("users/user-1/notifications/"));
  assert.equal(histories.length, 1);
});

test("push respects pushNotificationsEnabled but history and email still go out", async () => {
  const { db, documents } = createFakeFirestore(customerDocs("user-1", { pushNotificationsEnabled: false }));
  const { deps: d, messaging, email } = deps(db);
  const outcome = await notifyCustomer(d, appointmentNotice());
  assert.equal(outcome.status, "complete");
  assert.equal(outcome.channels.push.status, "skipped");
  assert.equal(messaging.calls.length, 0);
  assert.equal(email.calls.length, 1);
  assert.ok([...documents.keys()].some((key) => key.startsWith("users/user-1/notifications/")));
});

test("support message: push + history only, legacy type kept", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const { deps: d, messaging, email } = deps(db);
  const outcome = await notifyCustomer(d, buildSupportMessageNotice({ uid: "user-1", conversationId: "conv-1", messageId: "msg-1" }));
  assert.equal(outcome.status, "complete");
  assert.equal(email.calls.length, 0);
  assert.equal(messaging.calls[0].data.type, "support_message");
  assert.equal(messaging.calls[0].data.event, "support_message");
  assert.equal(messaging.calls[0].data.conversationId, "conv-1");
  assert.equal(messaging.calls[0].notification.title, "Nuevo mensaje de Focus Club");
  const history = [...documents.entries()].find(([key]) => key.startsWith("users/user-1/notifications/"))[1];
  assert.equal(history.type, "support_message");
  assert.equal(history.conversationId, "conv-1");
});

test("a failed channel is persisted and retried later without repeating successful channels", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  let emailFails = true;
  const email = createFakeEmailClient(async () => {
    if (emailFails) throw new Error("Brevo API error 503 xkeysib-secret");
    return { messageId: "brevo-ok" };
  });
  const { deps: d, messaging, tick } = deps(db, { email });

  const first = await notifyCustomer(d, appointmentNotice());
  const id = notificationIdFor("appt:evt-1");
  assert.equal(first.status, "retrying");
  assert.equal(first.channels.push.status, "sent");
  assert.equal(first.channels.email.status, "failed");
  const stored = documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`);
  assert.equal(stored.status, "retrying");
  assert.equal(stored.channels.email.lastError.includes("xkeysib"), false);
  assert.equal(stored.nextAttemptAtMillis, 1_000_000 + deliveryBackoffMs(1));

  // Not due yet.
  assert.equal(await retryDueDeliveries(d), 0);

  tick(deliveryBackoffMs(1));
  emailFails = false;
  assert.equal(await retryDueDeliveries(d), 1);
  const after = documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`);
  assert.equal(after.status, "complete");
  assert.equal(after.channels.email.status, "sent");
  assert.equal(messaging.calls.length, 1, "push must not be repeated");
  assert.equal(email.calls.length, 2);
  // Same Brevo idempotency key on the retry.
  assert.equal(email.calls[0].options.idempotencyKey, email.calls[1].options.idempotencyKey);
  const histories = [...documents.keys()].filter((key) => key.startsWith("users/user-1/notifications/"));
  assert.equal(histories.length, 1);
});

test("FCM failure on every device is retried; email already sent is not", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  let fcmFails = true;
  const messaging = createFakeMessaging(async (message) => (fcmFails
    ? { successCount: 0, failureCount: 1, responses: message.tokens.map(() => ({ success: false, error: { code: "messaging/internal-error" } })) }
    : { successCount: 1, failureCount: 0, responses: [{ success: true }] }));
  const { deps: d, email, tick } = deps(db, { messaging });

  const first = await notifyCustomer(d, appointmentNotice());
  assert.equal(first.channels.push.status, "failed");
  assert.equal(first.channels.email.status, "sent");

  fcmFails = false;
  tick(deliveryBackoffMs(1));
  await retryDueDeliveries(d);
  const id = notificationIdFor("appt:evt-1");
  assert.equal(documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`).status, "complete");
  assert.equal(messaging.calls.length, 2);
  assert.equal(email.calls.length, 1);
});

test("gives up after the maximum attempts and backs off exponentially", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const email = createFakeEmailClient(async () => { throw new Error("down"); });
  const { deps: d, tick } = deps(db, { email });
  await notifyCustomer(d, appointmentNotice());
  for (let attempt = 1; attempt < DELIVERY_MAX_ATTEMPTS; attempt += 1) {
    tick(deliveryBackoffMs(attempt));
    await retryDueDeliveries(d);
  }
  const delivery = documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${notificationIdFor("appt:evt-1")}`);
  assert.equal(delivery.status, "failed");
  assert.equal(delivery.attempts, DELIVERY_MAX_ATTEMPTS);
  assert.equal(delivery.nextAttemptAtMillis, null);
  assert.ok(deliveryBackoffMs(2) > deliveryBackoffMs(1));
});

test("a delivery stuck in pending (crash) is picked up by the retry sweep", async () => {
  const { db, documents } = createFakeFirestore(customerDocs());
  const { deps: d, messaging, tick } = deps(db);
  const notice = appointmentNotice();
  const id = notificationIdFor(notice.dedupeKey);
  documents.set(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`, {
    uid: "user-1",
    dedupeKey: notice.dedupeKey,
    type: notice.category,
    event: notice.event,
    status: "pending",
    attempts: 0,
    nextAttemptAtMillis: 1_000_000 + 60_000,
    notification: JSON.parse(JSON.stringify(notice)),
    push: buildPushContent(notice, id),
    channels: { history: { status: "pending" }, push: { status: "pending" }, email: { status: "pending" } },
  });
  assert.equal(await retryDueDeliveries(d), 0);
  tick(60_000);
  assert.equal(await retryDueDeliveries(d), 1);
  assert.equal(documents.get(`${NOTIFICATION_DELIVERY_COLLECTION}/${id}`).status, "complete");
  assert.equal(messaging.calls.length, 1);
});

test("sendPushOnce prunes invalid tokens and never resends a sent push", async () => {
  const { db, documents } = createFakeFirestore({
    ...customerDocs(),
    "users/user-1/fcmTokens/token-2": { token: "token-2", platform: "ios" },
  });
  const messaging = createFakeMessaging(async (message) => ({
    successCount: 1,
    failureCount: 1,
    responses: message.tokens.map((token) => (token === "token-2"
      ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
      : { success: true })),
  }));
  const content = { notification: { title: "t", body: "b" }, data: { type: "bono_status", event: "bono_assigned" } };
  const first = await sendPushOnce({ db, messaging, uid: "user-1", dedupeKey: "k", content });
  assert.deepEqual(first, { status: "sent", successCount: 1 });
  assert.equal(documents.has("users/user-1/fcmTokens/token-2"), false);
  const second = await sendPushOnce({ db, messaging, uid: "user-1", dedupeKey: "k", content });
  assert.deepEqual(second, { status: "skipped", reason: "already_sent" });
  assert.equal(messaging.calls.length, 1);
});

test("sendPushOnce skips users without push enabled or without devices", async () => {
  const content = { notification: { title: "t", body: "b" }, data: { type: "x" } };
  const disabled = createFakeFirestore(customerDocs("user-1", { pushNotificationsEnabled: false }));
  assert.deepEqual(
    await sendPushOnce({ db: disabled.db, messaging: createFakeMessaging(), uid: "user-1", dedupeKey: "k", content }),
    { status: "skipped", reason: "push_disabled" },
  );
  const noDevices = createFakeFirestore({ "users/user-1": { pushNotificationsEnabled: true } });
  assert.deepEqual(
    await sendPushOnce({ db: noDevices.db, messaging: createFakeMessaging(), uid: "user-1", dedupeKey: "k", content }),
    { status: "skipped", reason: "no_tokens" },
  );
});
