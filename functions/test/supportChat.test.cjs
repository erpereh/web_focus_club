const assert = require("node:assert/strict");

const {
  getSupportCustomerIdentity,
  normalizeSupportMessageText,
  normalizeSupportSubject,
} = require("../lib/supportChat.js");

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

console.log("support chat contract tests passed");
