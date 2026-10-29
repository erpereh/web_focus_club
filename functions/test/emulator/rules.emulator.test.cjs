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
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, setDoc, updateDoc, where,
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

test("recurring occurrences only leave their series through Cloud Functions", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const occurrence = (status) => ({
      userId: "user-1", status, duration: "60", date: DAY, time: "10:00",
      preferredSlots: [{ date: DAY, time: "10:00" }], recurrenceSeriesId: "series-1", recurrenceIndex: 0,
      bonoId: "b1", minutesDeducted: true, minutesDeductedAmount: 60, createdAt: "2026-10-01T10:00:00.000Z",
    });
    await Promise.all([
      setDoc(doc(db, "appointments/r-approved"), { ...occurrence("approved"), approvedSlot: { date: DAY, time: "10:00" } }),
      setDoc(doc(db, "appointments/r-pending"), occurrence("pending")),
    ]);
  });
  const admin = verified("admin");
  // These writes used to desync occurrenceCount/totalMinutes of the series.
  await assertFails(updateDoc(doc(admin, "appointments/r-approved"), { status: "cancelled" }));
  await assertFails(updateDoc(doc(admin, "appointments/r-pending"), { status: "rejected" }));
  await assertFails(updateDoc(doc(admin, "appointments/r-approved"), { duration: "30" }));
  await assertFails(deleteDoc(doc(admin, "appointments/r-approved")));
  await assertFails(deleteDoc(doc(admin, "appointments/r-pending")));
  // Notes and non-recurring appointments keep working as before.
  await assertSucceeds(updateDoc(doc(admin, "appointments/r-approved"), { approvalNotes: "ok" }));
  await assertSucceeds(updateDoc(doc(verified("coach"), "appointments/a1"), { trainerNotes: "bien", updatedAt: "x" }));
  await assertSucceeds(deleteDoc(doc(admin, "appointments/a2")));
});

test("backend audit records stay closed, even to admins", async () => {
  await assertFails(getDoc(doc(verified("admin"), "appointment_deletions/x")));
});

test("capacity exceptions: verified users read them, nobody writes them from a client", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `capacity_exceptions/${DAY}`), { date: DAY, maxCapacity: 2 });
  });
  const user = verified("user-1");
  await assertSucceeds(getDoc(doc(user, `capacity_exceptions/${DAY}`)));
  await assertSucceeds(getDocs(query(collection(user, "capacity_exceptions"), where("date", ">=", "2026-10-01"))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `capacity_exceptions/${DAY}`)));
  const unverified = env.authenticatedContext("user-1", { email: "u1@example.com", email_verified: false }).firestore();
  await assertFails(getDoc(doc(unverified, `capacity_exceptions/${DAY}`)));
  await assertFails(setDoc(doc(user, "capacity_exceptions/2026-10-20"), { date: "2026-10-20", maxCapacity: 9 }));
  const admin = verified("admin");
  await assertFails(setDoc(doc(admin, "capacity_exceptions/2026-10-20"), { date: "2026-10-20", maxCapacity: 3 }));
  await assertFails(updateDoc(doc(admin, `capacity_exceptions/${DAY}`), { maxCapacity: 5 }));
  await assertFails(deleteDoc(doc(admin, `capacity_exceptions/${DAY}`)));
});

test("site config: admins edit it, but capacity only changes through Cloud Functions", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "site_config/main"), {
      startHour: 8, endHour: 20, maxCapacity: 4, capacityExceptionsEnabled: false,
    });
  });
  const admin = verified("admin");
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "site_config/main")));
  await assertSucceeds(setDoc(doc(admin, "site_config/main"), { endHour: 21 }, { merge: true }));
  // Re-sending the unchanged value is not a change.
  await assertSucceeds(setDoc(doc(admin, "site_config/main"), { maxCapacity: 4, minBookingNoticeHours: 2 }, { merge: true }));
  await assertFails(setDoc(doc(admin, "site_config/main"), { maxCapacity: 2 }, { merge: true }));
  await assertFails(updateDoc(doc(admin, "site_config/main"), { capacityExceptionsEnabled: true }));
  await assertFails(deleteDoc(doc(admin, "site_config/main")));
  await assertFails(setDoc(doc(verified("user-1"), "site_config/main"), { endHour: 22 }, { merge: true }));
});
