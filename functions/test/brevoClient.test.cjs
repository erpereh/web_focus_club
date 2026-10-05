const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BREVO_SMTP_EMAIL_URL,
  BrevoApiError,
  createBrevoClient,
  sanitizeEmailError,
} = require("../lib/email/brevo.js");

const API_KEY = "xkeysib-test-secret-123";
const IDEMPOTENCY_KEY = "4f9b2c1a-1111-4222-8333-444455556666";

function message(overrides = {}) {
  return {
    category: "contact",
    to: [{ email: "admin@example.com", name: "Admin" }],
    replyTo: { email: "cliente@example.com", name: "Cliente" },
    subject: "Asunto",
    html: "<p>Hola</p>",
    text: "Hola",
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

function client(fetchImpl, overrides = {}) {
  return createBrevoClient({ apiKey: API_KEY, fetchImpl, sleep: async () => {}, ...overrides });
}

test("posts a Brevo transactional payload with sender, replyTo, text and idempotency key", async () => {
  const { calls, fetchImpl } = recordingFetch([jsonResponse(201, { messageId: "<abc@smtp-relay.brevo.com>" })]);

  const result = await client(fetchImpl).send(message({ tags: ["extra"] }), { idempotencyKey: IDEMPOTENCY_KEY });

  assert.deepEqual(result, { messageId: "<abc@smtp-relay.brevo.com>" });
  assert.equal(calls.length, 1);
  const [{ url, init, body }] = calls;
  assert.equal(url, BREVO_SMTP_EMAIL_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["api-key"], API_KEY);
  assert.equal(init.headers["Idempotency-Key"], IDEMPOTENCY_KEY);
  assert.ok(init.signal, "request must have a timeout signal");
  assert.deepEqual(body, {
    sender: { email: "info@focusclub.es", name: "Focus Club" },
    to: [{ email: "admin@example.com", name: "Admin" }],
    replyTo: { email: "cliente@example.com", name: "Cliente" },
    subject: "Asunto",
    htmlContent: "<p>Hola</p>",
    textContent: "Hola",
    tags: ["contact", "extra"],
    headers: { idempotencyKey: IDEMPOTENCY_KEY },
  });
});

test("omits replyTo when the message has none", async () => {
  const { calls, fetchImpl } = recordingFetch([jsonResponse(201, { messageId: "id-1" })]);
  await client(fetchImpl).send(message({ replyTo: undefined }), { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal("replyTo" in calls[0].body, false);
});

test("retries 429, 5xx and network timeouts reusing exactly the same idempotency key", async () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const { calls, fetchImpl } = recordingFetch([
    jsonResponse(429, { code: "too_many_requests", message: "slow down" }),
    timeout,
    jsonResponse(201, { messageId: "id-after-retry" }),
  ]);

  const result = await client(fetchImpl).send(message(), { idempotencyKey: IDEMPOTENCY_KEY });

  assert.equal(result.messageId, "id-after-retry");
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.init.headers["Idempotency-Key"], IDEMPOTENCY_KEY);
    assert.equal(call.body.headers.idempotencyKey, IDEMPOTENCY_KEY);
  }
});

test("gives up after maxRetries on persistent 5xx", async () => {
  const { calls, fetchImpl } = recordingFetch([
    jsonResponse(503, { message: "unavailable" }),
    jsonResponse(503, { message: "unavailable" }),
    jsonResponse(503, { message: "unavailable" }),
  ]);

  await assert.rejects(
    () => client(fetchImpl).send(message(), { idempotencyKey: IDEMPOTENCY_KEY }),
    (error) => error instanceof BrevoApiError && error.status === 503 && error.retryable === true,
  );
  assert.equal(calls.length, 3);
});

test("does not retry 4xx errors and never leaks the API key", async () => {
  const { calls, fetchImpl } = recordingFetch([
    jsonResponse(401, { code: "unauthorized", message: `Key not found: ${API_KEY}` }),
  ]);

  await assert.rejects(
    () => client(fetchImpl).send(message(), { idempotencyKey: IDEMPOTENCY_KEY }),
    (error) => {
      assert.ok(error instanceof BrevoApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("rejects missing API key, idempotency key or recipients before calling Brevo", async () => {
  const { calls, fetchImpl } = recordingFetch([]);
  await assert.rejects(
    () => createBrevoClient({ apiKey: " ", fetchImpl }).send(message(), { idempotencyKey: IDEMPOTENCY_KEY }),
    /BREVO_API_KEY is not configured/,
  );
  await assert.rejects(() => client(fetchImpl).send(message(), { idempotencyKey: "" }), /idempotency key/);
  await assert.rejects(() => client(fetchImpl).send(message({ to: [] }), { idempotencyKey: IDEMPOTENCY_KEY }), /no recipients/);
  assert.equal(calls.length, 0);
});

test("sanitizeEmailError redacts keys and URLs and truncates", () => {
  const sanitized = sanitizeEmailError(new Error(`boom ${API_KEY} at https://hooks.example.test/secret ${"x".repeat(300)}`));
  assert.equal(sanitized.includes(API_KEY), false);
  assert.equal(sanitized.includes("hooks.example.test"), false);
  assert.ok(sanitized.length <= 180);
  assert.equal(sanitizeEmailError(undefined, "fallback"), "fallback");
});
