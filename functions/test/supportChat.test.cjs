const assert = require("node:assert/strict");

const {
  createSupportChatHandlers,
  getSupportCustomerIdentity,
  normalizeSupportMessageText,
  normalizeSupportSubject,
  assertSupportConversationOpen,
} = require("../lib/supportChat.js");
const { Timestamp } = require("firebase-admin/firestore");

assert.equal(normalizeSupportSubject("  Consulta sobre mi bono  "), "Consulta sobre mi bono");
assert.throws(() => normalizeSupportSubject("ab"), /asunto/i);
assert.throws(() => normalizeSupportSubject(" "), /asunto/i);
assert.throws(() => normalizeSupportSubject("x".repeat(121)), /asunto/i);

assert.equal(normalizeSupportMessageText("  Hola, necesito ayuda.  "), "Hola, necesito ayuda.");
assert.throws(() => normalizeSupportMessageText("   "), /mensaje/i);
assert.throws(() => normalizeSupportMessageText("x".repeat(3001)), /mensaje/i);

assert.deepEqual(
  getSupportCustomerIdentity({
    uid: "customer-without-profile",
    tokenEmail: "cliente@example.com",
    tokenName: "Cliente Token",
    profile: undefined,
  }),
  {
    uid: "customer-without-profile",
    email: "cliente@example.com",
    name: "Cliente Token",
  },
);

assert.deepEqual(
  getSupportCustomerIdentity({
    uid: "customer-profile",
    tokenEmail: "cliente@example.com",
    tokenName: "",
    profile: { name: "  Cliente Perfil  ", email: "perfil@example.com", role: "customer" },
  }),
  {
    uid: "customer-profile",
    email: "perfil@example.com",
    name: "Cliente Perfil",
  },
);

assert.throws(
  () => getSupportCustomerIdentity({
    uid: "admin",
    tokenEmail: "admin@example.com",
    tokenName: "",
    profile: { role: "admin" },
  }),
  /cliente/i,
);

assert.throws(
  () => getSupportCustomerIdentity({
    uid: "unknown-role",
    tokenEmail: "customer@example.com",
    tokenName: "",
    profile: { role: "trainer" },
  }),
  /cliente/i,
);

assert.throws(
  () => getSupportCustomerIdentity({
    uid: "missing-email",
    tokenEmail: "",
    tokenName: "",
    profile: undefined,
  }),
  /email/i,
);

assert.doesNotThrow(() => assertSupportConversationOpen({ status: "open" }));
assert.throws(
  () => assertSupportConversationOpen({ status: "closed" }),
  (error) => error && error.code === "failed-precondition" && /cerrada/i.test(error.message),
);

function snapshot(data) {
  return {
    exists: Boolean(data),
    data: () => data,
  };
}

function createHideConversationFixture({ role = "admin", conversation } = {}) {
  const updates = [];
  const messages = [{ id: "message-1", text: "Mensaje que debe permanecer" }];
  const conversationRef = { id: "conversation-1", collection: () => ({}) };

  const db = {
    collection(name) {
      if (name === "users") {
        return {
          doc: () => ({
            get: async () => snapshot(role ? { role } : undefined),
          }),
        };
      }

      if (name === "support_conversations") {
        return {
          doc: () => conversationRef,
        };
      }

      throw new Error(`Colección inesperada: ${name}`);
    },
    runTransaction: async (callback) => callback({
      get: async (reference) => {
        assert.equal(reference, conversationRef);
        return snapshot(conversation);
      },
      update: (reference, data) => updates.push({ reference, data }),
    }),
  };

  return { db, updates, messages, conversationRef };
}

async function testAdminCanHideConversationWithoutDeletingMessages() {
  const fixture = createHideConversationFixture({
    conversation: { userId: "customer-uid", status: "open" },
  });
  const handlers = createSupportChatHandlers(fixture.db);

  const result = await handlers.adminHideSupportConversation({
    auth: { uid: "admin-uid" },
    data: { conversationId: "conversation-1" },
  });

  assert.deepEqual(result, { success: true, conversationId: "conversation-1" });
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.updates[0].reference, fixture.conversationRef);
  assert.equal(fixture.updates[0].data.adminHidden, true);
  assert.ok(fixture.updates[0].data.adminHiddenAt instanceof Timestamp);
  assert.equal(fixture.updates[0].data.adminHiddenBy, "admin-uid");
  assert.ok(fixture.updates[0].data.updatedAt instanceof Timestamp);
  assert.deepEqual(fixture.messages, [{ id: "message-1", text: "Mensaje que debe permanecer" }]);
}

async function testNonAdminCannotHideConversation() {
  const fixture = createHideConversationFixture({
    role: "user",
    conversation: { userId: "customer-uid", status: "open" },
  });
  const handlers = createSupportChatHandlers(fixture.db);

  await assert.rejects(
    () => handlers.adminHideSupportConversation({
      auth: { uid: "customer-uid" },
      data: { conversationId: "conversation-1" },
    }),
    (error) => error && error.code === "permission-denied",
  );
  assert.equal(fixture.updates.length, 0);
}

async function testHidingUnknownConversationReturnsNotFound() {
  const fixture = createHideConversationFixture({ conversation: undefined });
  const handlers = createSupportChatHandlers(fixture.db);

  await assert.rejects(
    () => handlers.adminHideSupportConversation({
      auth: { uid: "admin-uid" },
      data: { conversationId: "conversation-1" },
    }),
    (error) => error && error.code === "not-found",
  );
}

void (async () => {
  await testAdminCanHideConversationWithoutDeletingMessages();
  await testNonAdminCannotHideConversation();
  await testHidingUnknownConversationReturnsNotFound();
  console.log("support chat contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
