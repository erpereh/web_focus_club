const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCustomerSuggestionMakeEvent,
  createCustomerSuggestionHandlers,
  normalizeCustomerSuggestionPayload,
  notifyCustomerSuggestionCreatedSafely,
} = require("../lib/customerSuggestions.js");
const { Timestamp } = require("firebase-admin/firestore");

function snapshot(data) {
  return { exists: data !== undefined, data: () => data };
}

function createFirestoreFixture(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const writes = [];
  let nextId = 1;

  function reference(path) {
    return {
      id: path.split("/").at(-1),
      path,
      collection(name) {
        return collection(`${path}/${name}`);
      },
      async get() {
        return snapshot(documents.get(path));
      },
    };
  }

  function collection(path) {
    return {
      doc(id = `generated-${nextId++}`) {
        return reference(`${path}/${id}`);
      },
    };
  }

  const db = {
    collection,
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          return snapshot(documents.get(ref.path));
        },
        create(ref, data) {
          if (documents.has(ref.path)) throw new Error("already exists");
          documents.set(ref.path, data);
          writes.push({ operation: "create", path: ref.path, data });
        },
        set(ref, data, options) {
          documents.set(ref.path, { ...(documents.get(ref.path) || {}), ...data });
          writes.push({ operation: "set", path: ref.path, data, options });
        },
        update(ref, data) {
          if (!documents.has(ref.path)) throw new Error("missing document");
          documents.set(ref.path, { ...documents.get(ref.path), ...data });
          writes.push({ operation: "update", path: ref.path, data });
        },
      });
    },
  };

  return { db, documents, writes };
}

function customerRequest(data, overrides = {}) {
  return {
    auth: {
      uid: "customer-1",
      token: { email: "token@example.com", name: "Token Name" },
      ...overrides.auth,
    },
    data,
  };
}

function adminRequest(data, overrides = {}) {
  return {
    auth: {
      uid: "admin-1",
      token: { email: "token-admin@example.com" },
      ...overrides.auth,
    },
    data,
  };
}

const serverTimestamp = { __type: "serverTimestamp" };

test("normalizes the callable payload and rejects invalid lengths", () => {
  assert.deepEqual(
    normalizeCustomerSuggestionPayload({ subject: "  Horarios  ", message: "  Abrir antes  " }),
    { subject: "Horarios", message: "Abrir antes" },
  );
  assert.deepEqual(
    normalizeCustomerSuggestionPayload({ subject: "   ", message: " Bien " }),
    { subject: null, message: "Bien" },
  );
  assert.throws(() => normalizeCustomerSuggestionPayload({ message: "  " }), { code: "invalid-argument" });
  assert.throws(() => normalizeCustomerSuggestionPayload({ message: "ab" }), { code: "invalid-argument" });
  assert.throws(() => normalizeCustomerSuggestionPayload({ message: "x".repeat(2001) }), { code: "invalid-argument" });
  assert.throws(() => normalizeCustomerSuggestionPayload({ subject: "x".repeat(121), message: "válido" }), { code: "invalid-argument" });
  assert.throws(() => normalizeCustomerSuggestionPayload({ subject: 42, message: "válido" }), { code: "invalid-argument" });
});

test("requires authentication and stores profile identity instead of spoofed payload fields", async () => {
  const fixture = createFirestoreFixture({
    "users/customer-1": { name: "  Cliente Real  ", email: "REAL@EXAMPLE.COM", role: "user" },
  });
  const handlers = createCustomerSuggestionHandlers(fixture.db, {
    now: () => 1_000_000,
    serverTimestamp: () => serverTimestamp,
  });

  await assert.rejects(
    () => handlers.submitCustomerSuggestion({ auth: undefined, data: { message: "Mensaje válido" } }),
    { code: "unauthenticated" },
  );

  const result = await handlers.submitCustomerSuggestion(customerRequest({
    subject: "  Idea  ",
    message: "  Mensaje válido  ",
    userId: "attacker",
    userName: "Nombre falso",
    userEmail: "fake@example.com",
    status: "archived",
  }));

  assert.deepEqual(result, { success: true, suggestionId: "generated-1" });
  assert.deepEqual(fixture.documents.get("customer_suggestions/generated-1"), {
    userId: "customer-1",
    userName: "Cliente Real",
    userEmail: "real@example.com",
    subject: "Idea",
    message: "Mensaje válido",
    status: "new",
    createdAt: serverTimestamp,
    updatedAt: serverTimestamp,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByEmail: null,
    archivedAt: null,
    archivedBy: null,
    archivedByEmail: null,
  });
});

test("enforces five submissions per ten minutes and exact duplicate cooldown", async () => {
  let now = 10_000;
  const fixture = createFirestoreFixture({
    "users/customer-1": { name: "Cliente", email: "cliente@example.com", role: "user" },
  });
  const handlers = createCustomerSuggestionHandlers(fixture.db, {
    now: () => now,
    serverTimestamp: () => serverTimestamp,
  });

  await handlers.submitCustomerSuggestion(customerRequest({ subject: "A", message: "Primera idea" }));
  now += 30_000;
  await assert.rejects(
    () => handlers.submitCustomerSuggestion(customerRequest({ subject: " A ", message: " Primera idea " })),
    { code: "resource-exhausted" },
  );

  for (let index = 2; index <= 5; index += 1) {
    now += 61_000;
    await handlers.submitCustomerSuggestion(customerRequest({ message: `Idea número ${index}` }));
  }
  now += 61_000;
  await assert.rejects(
    () => handlers.submitCustomerSuggestion(customerRequest({ message: "Sexta idea" })),
    { code: "resource-exhausted" },
  );

  now = 10_000 + (10 * 60 * 1000);
  await assert.doesNotReject(
    () => handlers.submitCustomerSuggestion(customerRequest({ message: "Nueva ventana" })),
  );
});

test("admin transitions are authorized, audited and idempotent", async () => {
  const fixture = createFirestoreFixture({
    "users/admin-1": { role: "admin", email: "admin@example.com" },
    "users/customer-1": { role: "user", email: "customer@example.com" },
    "customer_suggestions/suggestion-1": {
      userId: "customer-1",
      status: "new",
      reviewedAt: null,
      reviewedBy: null,
      reviewedByEmail: null,
      archivedAt: null,
      archivedBy: null,
      archivedByEmail: null,
    },
  });
  const handlers = createCustomerSuggestionHandlers(fixture.db, {
    now: () => 1_000_000,
    serverTimestamp: () => serverTimestamp,
  });

  await assert.rejects(
    () => handlers.adminMarkSuggestionReviewed(customerRequest({ suggestionId: "suggestion-1" })),
    { code: "permission-denied" },
  );

  await handlers.adminMarkSuggestionReviewed(adminRequest({ suggestionId: "suggestion-1" }));
  const reviewed = fixture.documents.get("customer_suggestions/suggestion-1");
  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.reviewedBy, "admin-1");
  assert.equal(reviewed.reviewedByEmail, "admin@example.com");
  assert.equal(reviewed.reviewedAt, serverTimestamp);

  const writesAfterReview = fixture.writes.length;
  await handlers.adminMarkSuggestionReviewed(adminRequest({ suggestionId: "suggestion-1" }));
  assert.equal(fixture.writes.length, writesAfterReview);

  await handlers.adminArchiveSuggestion(adminRequest({ suggestionId: "suggestion-1" }));
  const archived = fixture.documents.get("customer_suggestions/suggestion-1");
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedBy, "admin-1");
  assert.equal(archived.archivedByEmail, "admin@example.com");

  await handlers.adminRestoreSuggestion(adminRequest({ suggestionId: "suggestion-1" }));
  const restored = fixture.documents.get("customer_suggestions/suggestion-1");
  assert.equal(restored.status, "reviewed");
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.archivedBy, null);
  assert.equal(restored.archivedByEmail, null);
  assert.equal(restored.reviewedBy, "admin-1");

  const writesAfterRestore = fixture.writes.length;
  await handlers.adminRestoreSuggestion(adminRequest({ suggestionId: "suggestion-1" }));
  assert.equal(fixture.writes.length, writesAfterRestore);
});

test("restoring an unreviewed archive creates review audit", async () => {
  const fixture = createFirestoreFixture({
    "users/admin-1": { role: "admin", email: "admin@example.com" },
    "customer_suggestions/suggestion-2": {
      userId: "customer-1",
      status: "archived",
      reviewedAt: null,
      reviewedBy: null,
      reviewedByEmail: null,
      archivedAt: serverTimestamp,
      archivedBy: "admin-old",
      archivedByEmail: "old@example.com",
    },
  });
  const handlers = createCustomerSuggestionHandlers(fixture.db, {
    serverTimestamp: () => serverTimestamp,
  });

  await handlers.adminRestoreSuggestion(adminRequest({ suggestionId: "suggestion-2" }));
  const restored = fixture.documents.get("customer_suggestions/suggestion-2");
  assert.equal(restored.status, "reviewed");
  assert.equal(restored.reviewedAt, serverTimestamp);
  assert.equal(restored.reviewedBy, "admin-1");
  assert.equal(restored.reviewedByEmail, "admin@example.com");
});

test("builds the Make event from the persisted Timestamp and absorbs webhook failures", async () => {
  const createdAt = Timestamp.fromDate(new Date("2026-07-16T10:30:00.000Z"));
  const data = {
    userId: "customer-1",
    userName: "Cliente",
    userEmail: "cliente@example.com",
    subject: null,
    message: "Una idea",
    createdAt,
  };

  assert.deepEqual(buildCustomerSuggestionMakeEvent("suggestion-1", data), {
    event: "customer_suggestion",
    suggestionId: "suggestion-1",
    userId: "customer-1",
    userName: "Cliente",
    userEmail: "cliente@example.com",
    subject: null,
    message: "Una idea",
    createdAt: "2026-07-16T10:30:00.000Z",
  });

  const errors = [];
  await assert.doesNotReject(() => notifyCustomerSuggestionCreatedSafely(
    "suggestion-1",
    data,
    async () => { throw new Error("Make unavailable"); },
    (message) => errors.push(message),
  ));
  assert.equal(errors.length, 1);
});
