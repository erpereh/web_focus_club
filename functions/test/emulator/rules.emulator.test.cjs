// Runs the real firestore.rules in the Firestore EMULATOR with client SDK
// contexts (no Admin SDK): the admin-only statistics reads and the
// Functions-only charge fields are enforced by the backend, not by the UI.
//
//   npm --prefix functions run test:emulator
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
if (!host || !projectId.startsWith("demo-")) {
  throw new Error("Emulator tests need FIRESTORE_EMULATOR_HOST and a demo-* project (use npm run test:emulator).");
}

const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const {
  collection, doc, getCountFromServer, getDoc, getDocs, query, setDoc, updateDoc, where,
} = require("firebase/firestore");

const [hostName, port] = host.split(":");
const DAY = "2026-10-14";

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: hostName,
      port: Number(port),
      rules: fs.readFileSync(path.join(__dirname, "..", "..", "..", "firestore.rules"), "utf8"),
    },
  });
});

test.after(async () => {
  await env?.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const appointment = (userId, extra = {}) => ({
      userId, status: "approved", duration: "60", date: DAY, time: "10:00",
      preferredSlots: [{ date: DAY, time: "10:00" }], approvedSlot: { date: DAY, time: "10:00" },
      assignedTrainer: "trainer-1", createdAt: "2026-10-01T10:00:00.000Z", ...extra,
    });
    await Promise.all([
      setDoc(doc(db, "users/admin"), { uid: "admin", role: "admin", email: "admin@example.com" }),
      setDoc(doc(db, "users/user-1"), { uid: "user-1", role: "user", email: "u1@example.com", createdAt: "2026-10-01T10:00:00.000Z" }),
      setDoc(doc(db, "users/user-2"), { uid: "user-2", role: "user", email: "u2@example.com", createdAt: "2026-10-02T10:00:00.000Z" }),
      setDoc(doc(db, "users/coach"), { uid: "coach", role: "trainer", email: "coach@example.com" }),
      setDoc(doc(db, "trainers/trainer-1"), { uid: "coach", name: "Ana", active: true }),
      setDoc(doc(db, "appointments/a1"), appointment("user-1")),
      setDoc(doc(db, "appointments/a2"), appointment("user-2", { assignedTrainer: "trainer-2" })),
      setDoc(doc(db, "appointments/charged"), appointment("user-1", {
        status: "cancelled", cancellationCharge: "charged", cancellationChargedMinutes: 60,
      })),
      setDoc(doc(db, "bonos/b1"), { userId: "user-1", estado: "activo", fechaExpiracion: "2026-12-31T22:59:59.000Z" }),
      setDoc(doc(db, "bonos/b2"), { userId: "user-2", estado: "activo", fechaExpiracion: "2026-12-31T22:59:59.000Z" }),
      setDoc(doc(db, "appointment_deletions/x"), { userId: "user-1" }),
    ]);
  });
});

const verified = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const rangeQuery = (db) => query(collection(db, "appointments"), where("date", ">=", "2026-10-01"), where("date", "<=", "2026-10-31"));

test("statistics reads: only an admin can list appointments, bonos and users by range", async () => {
  const admin = verified("admin");
  const snapshot = await assertSucceeds(getDocs(rangeQuery(admin)));
  assert.equal(snapshot.size, 3);
  await assertSucceeds(getDocs(query(collection(admin, "bonos"), where("fechaExpiracion", ">=", "2026-10-01"))));
  const users = await assertSucceeds(getCountFromServer(query(collection(admin, "users"), where("role", "==", "user"))));
  assert.equal(users.data().count, 2);
  await assertSucceeds(getCountFromServer(query(collection(admin, "appointments"), where("status", "==", "pending"))));

  for (const uid of ["user-1", "coach"]) {
    const db = verified(uid);
    await assertFails(getDocs(rangeQuery(db)));
    await assertFails(getDocs(collection(db, "bonos")));
    await assertFails(getDocs(query(collection(db, "users"), where("role", "==", "user"))));
    await assertFails(getCountFromServer(query(collection(db, "appointments"), where("status", "==", "pending"))));
  }
  await assertFails(getDocs(rangeQuery(env.unauthenticatedContext().firestore())));
  // An admin with an unverified email is not an admin for the rules.
  await assertFails(getDocs(rangeQuery(env.authenticatedContext("admin", { email_verified: false }).firestore())));
});

test("the charge decision can only be written by Cloud Functions", async () => {
  const admin = verified("admin");
  await assertFails(updateDoc(doc(admin, "appointments/a1"), { cancellationCharge: "charged" }));
  await assertFails(updateDoc(doc(admin, "appointments/charged"), { cancellationCharge: "not_charged" }));
  await assertFails(updateDoc(doc(admin, "appointments/charged"), { cancellationChargedMinutes: 0 }));
  await assertFails(setDoc(doc(admin, "appointments/new"), {
    userId: "user-1", status: "cancelled", cancellationCharge: "charged",
  }));
  // Other admin edits keep working as before.
  await assertSucceeds(updateDoc(doc(admin, "appointments/a1"), { approvalNotes: "ok", updatedAt: "2026-10-14T08:00:00.000Z" }));
  await assertSucceeds(updateDoc(doc(admin, "appointments/charged"), { approvalNotes: "nota" }));

  const coach = verified("coach");
  await assertFails(updateDoc(doc(coach, "appointments/a1"), { cancellationCharge: "charged" }));
  await assertSucceeds(updateDoc(doc(coach, "appointments/a1"), { trainerNotes: "bien", updatedAt: "x" }));
  await assertFails(updateDoc(doc(verified("user-1"), "appointments/a1"), { cancellationCharge: "charged" }));
});

test("backend audit records stay closed, even to admins", async () => {
  await assertFails(getDoc(doc(verified("admin"), "appointment_deletions/x")));
});
