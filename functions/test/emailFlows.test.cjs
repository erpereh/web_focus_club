const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EMAIL_DISPATCH_COLLECTION,
  EMAIL_DISPATCH_LEASE_MS,
  emailDispatchId,
  emailIdempotencyKey,
  sendEmailOnce,
  sendEmailOnceSafely,
} = require("../lib/email/dispatch.js");
const {
  ADMIN_NOTIFICATION_EMAIL,
  SUGGESTIONS_RECIPIENT_EMAIL,
  buildAppointmentEmailMessage,
  sendAppointmentEmailSafely,
  sendContactEmail,
  sendCustomerSuggestionEmail,
  sendWelcomeEmail,
} = require("../lib/email/notifications.js");
const { createBrevoClient } = require("../lib/email/brevo.js");

function createFirestoreFixture(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path) });
  const merge = (path, data, options) => {
    documents.set(path, options?.merge ? { ...(documents.get(path) || {}), ...data } : data);
  };
  const reference = (path) => ({
    id: path.split("/").at(-1),
    path,
    async get() { return snapshot(path); },
    async set(data, options) { merge(path, data, options); },
  });
  const db = {
    collection(name) {
      return { doc: (id) => reference(`${name}/${id}`) };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) { return snapshot(ref.path); },
        set(ref, data, options) { merge(ref.path, data, options); },
      });
    },
  };
  return { db, documents };
}

function fakeClient(behaviour = async () => ({ messageId: "msg-1" })) {
  const calls = [];
  return {
    calls,
    async send(message, options) {
      calls.push({ message, options });
      return behaviour(message, options, calls.length);
    },
  };
}

const message = {
  category: "welcome",
  to: [{ email: "cliente@example.com" }],
  subject: "Hola",
  html: "<p>Hola</p>",
  text: "Hola",
};

function dispatchPath(dedupeKey) {
  return `${EMAIL_DISPATCH_COLLECTION}/${emailDispatchId(dedupeKey)}`;
}

test("idempotency key is deterministic and UUID shaped", () => {
  const key = emailIdempotencyKey("event-1:admin");
  assert.equal(key, emailIdempotencyKey("event-1:admin"));
  assert.notEqual(key, emailIdempotencyKey("event-1:customer"));
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("sends once, stores messageId and never re-sends a sent dispatch", async () => {
  const { db, documents } = createFirestoreFixture();
  const client = fakeClient();
  const now = () => 1_000;

  const first = await sendEmailOnce({ db, client, dedupeKey: "k1", message, context: { relatedId: "u1" }, now });
  assert.equal(first.status, "sent");
  assert.equal(first.messageId, "msg-1");
  const stored = documents.get(dispatchPath("k1"));
  assert.equal(stored.status, "sent");
  assert.equal(stored.messageId, "msg-1");
  assert.equal(stored.leaseUntilMillis, null);
  assert.equal(stored.attempts, 1);
  assert.equal(stored.relatedId, "u1");
  assert.equal("html" in stored, false, "ledger must not store email content");
  assert.equal(client.calls[0].options.idempotencyKey, emailIdempotencyKey("k1"));

  const second = await sendEmailOnce({ db, client, dedupeKey: "k1", message, now: () => 10_000_000 });
  assert.deepEqual(second, { status: "skipped", reason: "already_sent", dispatchId: emailDispatchId("k1") });
  assert.equal(client.calls.length, 1);
});

test("skips while another attempt holds a live lease", async () => {
  const { db } = createFirestoreFixture({
    [dispatchPath("k2")]: { status: "sending", leaseUntilMillis: 5_000, attempts: 1 },
  });
  const client = fakeClient();

  const outcome = await sendEmailOnce({ db, client, dedupeKey: "k2", message, now: () => 4_999 });

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "in_progress");
  assert.equal(client.calls.length, 0);
});

test("reclaims an expired sending lease and retries with the same idempotency key", async () => {
  const { db, documents } = createFirestoreFixture({
    [dispatchPath("k3")]: { status: "sending", leaseUntilMillis: 5_000, attempts: 1 },
  });
  const client = fakeClient();

  const outcome = await sendEmailOnce({ db, client, dedupeKey: "k3", message, now: () => 5_001 });

  assert.equal(outcome.status, "sent");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].options.idempotencyKey, emailIdempotencyKey("k3"));
  assert.equal(documents.get(dispatchPath("k3")).attempts, 2);
});

test("claim sets a lease; failure is stored sanitized and can be retried", async () => {
  const { db, documents } = createFirestoreFixture();
  let leaseDuringSend;
  const failing = fakeClient(async () => {
    leaseDuringSend = { ...documents.get(dispatchPath("k4")) };
    throw new Error("Brevo down xkeysib-secret-value");
  });

  await assert.rejects(
    () => sendEmailOnce({ db, client: failing, dedupeKey: "k4", message, now: () => 1_000 }),
    (error) => !error.message.includes("xkeysib-secret-value"),
  );
  assert.equal(leaseDuringSend.status, "sending");
  assert.equal(leaseDuringSend.leaseUntilMillis, 1_000 + EMAIL_DISPATCH_LEASE_MS);
  const failed = documents.get(dispatchPath("k4"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError.includes("xkeysib"), false);

  const ok = fakeClient();
  const retry = await sendEmailOnce({ db, client: ok, dedupeKey: "k4", message, now: () => 2_000 });
  assert.equal(retry.status, "sent");
  assert.equal(ok.calls[0].options.idempotencyKey, failing.calls[0].options.idempotencyKey);
  assert.equal(documents.get(dispatchPath("k4")).attempts, 2);
});

test("sendEmailOnceSafely swallows errors", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient(async () => { throw new Error("boom"); });
  assert.equal(await sendEmailOnceSafely({ db, client, dedupeKey: "k5", message }), undefined);
});

test("end to end with the Brevo client: timeout retry reuses the idempotency key", async () => {
  const { db } = createFirestoreFixture();
  const requests = [];
  const client = createBrevoClient({
    apiKey: "xkeysib-test",
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      requests.push(init);
      if (requests.length === 1) throw new DOMException("timeout", "TimeoutError");
      return new Response(JSON.stringify({ messageId: "brevo-1" }), { status: 201 });
    },
  });

  const outcome = await sendEmailOnce({ db, client, dedupeKey: "e2e", message });

  assert.equal(outcome.messageId, "brevo-1");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  assert.equal(requests[0].headers["Idempotency-Key"], emailIdempotencyKey("e2e"));
});

const appointmentData = {
  action: "confirmed",
  status: "approved",
  appointmentId: "apt-1",
  customerName: "Lucía",
  customerEmail: "lucia@example.com",
  customerPhone: "600",
  date: "2026-10-05",
  time: "10:00",
  sessionType: "Sesión",
  trainerName: "Carlos",
};

test("appointment flow sends to customer and admin with separate dedupe keys", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient();
  const deps = { db, client };

  await Promise.all([
    sendAppointmentEmailSafely(deps, { dedupeKey: "evt-1:customer", data: appointmentData, recipientType: "customer", recipientEmail: "lucia@example.com" }),
    sendAppointmentEmailSafely(deps, { dedupeKey: "evt-1:admin", data: appointmentData, recipientType: "admin", recipientEmail: ADMIN_NOTIFICATION_EMAIL }),
  ]);
  // Redelivery of the same trigger event is a no-op.
  await sendAppointmentEmailSafely(deps, { dedupeKey: "evt-1:admin", data: appointmentData, recipientType: "admin", recipientEmail: ADMIN_NOTIFICATION_EMAIL });

  assert.equal(client.calls.length, 2);
  const [customer, admin] = client.calls.map((call) => call.message);
  assert.equal(customer.category, "appointment_customer");
  assert.deepEqual(customer.to, [{ email: "lucia@example.com", name: "Lucía" }]);
  assert.equal(customer.replyTo, undefined);
  assert.equal(admin.category, "appointment_admin");
  assert.deepEqual(admin.to, [{ email: "infofocusclub2026@gmail.com" }]);
  assert.deepEqual(admin.replyTo, { email: "lucia@example.com", name: "Lucía" });
});

test("appointment flow skips a missing recipient without throwing", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient();
  assert.equal(await sendAppointmentEmailSafely({ db, client }, {
    dedupeKey: "evt-2:customer", data: appointmentData, recipientType: "customer", recipientEmail: "",
  }), undefined);
  assert.equal(client.calls.length, 0);
});

test("buildAppointmentEmailMessage tags action and status", () => {
  const built = buildAppointmentEmailMessage({ ...appointmentData, action: "deleted", status: "cancelled" }, "customer", "lucia@example.com");
  assert.deepEqual(built.tags, ["appointment_deleted", "status_cancelled"]);
});

test("welcome flow dedupes per uid", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient();
  const deps = { db, client };
  const input = { uid: "uid-1", customerName: "Lucía", customerEmail: "lucia@example.com" };

  assert.equal((await sendWelcomeEmail(deps, input)).status, "sent");
  assert.equal((await sendWelcomeEmail(deps, input)).status, "skipped");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].message.category, "welcome");
  assert.deepEqual(client.calls[0].message.to, [{ email: "lucia@example.com", name: "Lucía" }]);
});

test("customer suggestion goes to info@focusclub.es with replyTo the customer", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient();
  const event = {
    event: "customer_suggestion",
    suggestionId: "s-1",
    userId: "u-1",
    userName: "Cliente",
    userEmail: "cliente@example.com",
    subject: "Idea",
    message: "Más clases",
    createdAt: "2026-07-16T10:30:00.000Z",
  };

  await sendCustomerSuggestionEmail({ db, client }, event);
  await sendCustomerSuggestionEmail({ db, client }, event);

  assert.equal(SUGGESTIONS_RECIPIENT_EMAIL, "info@focusclub.es");
  assert.equal(client.calls.length, 1);
  const sent = client.calls[0].message;
  assert.deepEqual(sent.to, [{ email: "info@focusclub.es", name: "Focus Club" }]);
  assert.deepEqual(sent.replyTo, { email: "cliente@example.com", name: "Cliente" });
});

test("contact form uses replyTo with the customer email and returns the Brevo messageId", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient(async () => ({ messageId: "brevo-contact" }));

  const outcome = await sendContactEmail({ db, client }, {
    submissionId: "sub-1",
    recipientEmail: "recepcion@example.com",
    data: {
      name: "Ana",
      email: "ana@example.com",
      phone: "",
      subject: "Horarios",
      message: "Hola",
      submittedAt: new Date("2026-09-30T10:00:00.000Z"),
    },
  });

  assert.equal(outcome.messageId, "brevo-contact");
  const sent = client.calls[0].message;
  assert.equal(sent.category, "contact");
  assert.deepEqual(sent.to, [{ email: "recepcion@example.com" }]);
  assert.deepEqual(sent.replyTo, { email: "ana@example.com", name: "Ana" });
});

test("contact form surfaces Brevo failures to the caller", async () => {
  const { db } = createFirestoreFixture();
  const client = fakeClient(async () => { throw new Error("Brevo API error 400"); });
  await assert.rejects(() => sendContactEmail({ db, client }, {
    submissionId: "sub-2",
    recipientEmail: "recepcion@example.com",
    data: { name: "Ana", email: "ana@example.com", phone: "", subject: "x", message: "y", submittedAt: new Date() },
  }), /Brevo API error 400/);
});
