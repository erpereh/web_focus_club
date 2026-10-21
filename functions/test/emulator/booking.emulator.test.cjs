// Runs against the Firestore EMULATOR only, with the real Admin SDK and the
// real handlers (no fakes): `createAppointment` exactly as deployed
// (customerBooking.ts) and the admin booking callables.
//
//   npm --prefix functions run test:emulator
//
// The project id must be a `demo-*` id: the emulator then never talks to any
// real Firebase project, and this file refuses to run otherwise.
const assert = require("node:assert/strict");
const test = require("node:test");

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
if (!host || !projectId.startsWith("demo-")) {
  throw new Error("Emulator tests need FIRESTORE_EMULATOR_HOST and a demo-* project (use npm run test:emulator).");
}

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createAdminAppointmentStatusHandlers } = require("../../lib/adminAppointmentStatus.js");
const { createCustomerBookingHandlers } = require("../../lib/customerBooking.js");
const { getMadridDateKey } = require("../../lib/appointmentLifecycle.js");

initializeApp({ projectId });
const db = getFirestore();

const getNowDate = () => new Date();
const admin = createAdminAppointmentStatusHandlers({ db, requireAdmin: async () => undefined, getNowDate });
const booking = createCustomerBookingHandlers({ db, getNowDate });

/** A date 10 days ahead (Madrid), so notice/same-day rules never interfere. */
const DAY = getMadridDateKey(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));

function callable(uid, data) {
  return { auth: { uid, token: { email_verified: true, email: `${uid}@example.com` } }, data };
}

async function resetDatabase() {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true, "emulator reset failed");
}

async function seed(documents) {
  const batch = db.batch();
  for (const [path, data] of Object.entries(documents)) batch.set(db.doc(path), data);
  await batch.commit();
}

function baseDocuments(extra = {}) {
  return {
    "site_config/main": {
      startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4, minBookingNoticeHours: 0, blockSameDayBooking: false,
    },
    "users/user-1": { uid: "user-1", name: "Cliente Uno", email: "uno@example.com", phone: "" },
    "users/user-2": { uid: "user-2", name: "Cliente Dos", email: "dos@example.com", phone: "" },
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 480, estado: "activo",
      fechaExpiracion: "2099-12-31T22:59:59.000Z", historial: [],
    },
    "bonos/bono-2": {
      userId: "user-2", tamano: 480, minutosTotales: 480, minutosRestantes: 480, estado: "activo",
      fechaExpiracion: "2099-12-31T22:59:59.000Z", historial: [],
    },
    ...extra,
  };
}

async function docData(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? snap.data() : undefined;
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, reason: error?.details?.reason ?? error?.code ?? String(error?.message ?? error) };
  }
}

test.beforeEach(resetDatabase);

test("real queries find every overlapping appointment shape (array-contains-any, approvedSlot.date, date)", async () => {
  await seed(baseDocuments({
    // Customer request as createAppointment writes it: preferredSlots only (keys in another order).
    "appointments/customer": {
      userId: "user-1", status: "pending", duration: "30", preferredSlots: [{ time: "10:30", date: DAY }],
    },
    // Old browser approval: approvedSlot only, stale top-level date.
    "appointments/oldApproval": {
      userId: "user-2", status: "approved", duration: "60", date: "2001-01-01", time: "08:00",
      approvedSlot: { date: DAY, time: "09:15" }, preferredSlots: [{ date: "2001-01-01", time: "08:00" }],
    },
    // Legacy document: top-level date/time only.
    "appointments/legacy": { userId: "user-2", status: "approved", duration: "45", date: DAY, time: "10:45" },
    // Pending with a leftover approvedSlot inside the block: it is really at 15:00.
    "appointments/stalePending": {
      userId: "user-1", status: "pending", duration: "60",
      approvedSlot: { date: DAY, time: "10:00" }, preferredSlots: [{ date: DAY, time: "15:00" }],
    },
    "appointments/cancelled": { userId: "user-1", status: "cancelled", duration: "30", preferredSlots: [{ date: DAY, time: "10:00" }] },
    "appointments/otherDay": { userId: "user-1", status: "pending", duration: "30", preferredSlots: [{ date: "2099-01-01", time: "10:00" }] },
  }));
  const request = { date: DAY, startTimes: ["10:00", "10:30"], groupDurationMinutes: 30, deleteAppointmentIds: [] };
  const refused = await settle(admin.blockSlotsFromAdmin(callable("admin", request)));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "appointments_changed");
  const blocksAfterRefusal = await db.collection("blocked_slots").get();
  assert.equal(blocksAfterRefusal.size, 0, "nothing written on refusal");

  const changed = await admin.blockSlotsFromAdmin(callable("admin", { ...request, deleteAppointmentIds: ["customer"] }))
    .catch((error) => error);
  assert.deepEqual(changed.details.unexpectedIds, ["legacy", "oldApproval"]);

  const result = await admin.blockSlotsFromAdmin(callable("admin", {
    ...request, deleteAppointmentIds: ["customer", "legacy", "oldApproval"],
  }));
  assert.deepEqual([...result.deletedIds].sort(), ["customer", "legacy", "oldApproval"]);
  assert.equal(result.blockedSlotIds.length, 4);
  assert.ok(await docData("appointments/stalePending"), "the stale pending one is at 15:00 and stays");
  assert.ok(await docData("appointment_deletions/customer"));
});

test("real concurrency: a booking racing a block never ends inside the blocked slot", async () => {
  const iterations = 12;
  const outcomes = { blockWon: 0, bookingWon: 0 };
  for (let index = 0; index < iterations; index += 1) {
    await resetDatabase();
    await seed(baseDocuments());
    const time = "11:00";
    const [block, book] = await Promise.all([
      settle(admin.blockSlotsFromAdmin(callable("admin", {
        date: DAY, startTimes: [time], groupDurationMinutes: 30, deleteAppointmentIds: [],
      }))),
      settle(booking.createAppointment(callable("user-1", {
        duration: "30", preferredSlot: { date: DAY, time }, reason: "", appointmentType: "training",
      }))),
    ]);
    assert.ok(!(block.ok && book.ok), `iteration ${index}: both committed (block + booking in the same slot)`);
    const blocks = (await db.collection("blocked_slots").get()).size;
    const appointments = (await db.collection("appointments").get()).docs.map((doc) => doc.data());
    const bono = await docData("bonos/bono-1");
    if (block.ok) {
      outcomes.blockWon += 1;
      assert.equal(blocks, 2);
      assert.equal(appointments.length, 0, "booking must be refused once the slot is blocked");
      assert.equal(book.reason, "slot_blocked");
      assert.equal(bono.minutosRestantes, 480, "a refused booking debits nothing");
    } else if (book.ok) {
      outcomes.bookingWon += 1;
      assert.equal(block.reason, "appointments_changed");
      assert.equal(blocks, 0, "a refused block writes nothing");
      assert.equal(appointments.length, 1);
      assert.equal(bono.minutosRestantes, 450);
    } else {
      // Both aborted (contention): nothing may be left half-written.
      assert.equal(blocks, 0);
      assert.equal(appointments.length, 0);
      assert.equal(bono.minutosRestantes, 480);
    }
  }
  console.log("[emulator] block vs booking outcomes", outcomes);
  assert.ok(outcomes.blockWon + outcomes.bookingWon > 0);
});

test("real concurrency: a double approval counts one seat and createAppointment then sees the slot full", async () => {
  await seed(baseDocuments({
    "site_config/main": {
      startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 1, minBookingNoticeHours: 0, blockSameDayBooking: false,
    },
    "appointments/request": {
      userId: "user-2", name: "Cliente Dos", email: "dos@example.com", phone: "", serviceType: "Bono", status: "pending",
      duration: "30", preferredSlots: [{ date: DAY, time: "12:00" }], reason: "", bonoId: "bono-2",
      minutesDeducted: true, minutesDeductedAmount: 30, minutesDeductedAt: new Date().toISOString(), minutesRefundedAt: null,
      createdAt: new Date().toISOString(),
    },
  }));
  const results = await Promise.all([
    settle(admin.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "request", status: "approved", expectedStatus: "pending" }))),
    settle(admin.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "request", status: "approved", expectedStatus: "pending" }))),
  ]);
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.deepEqual(results.map((result) => result.value.changed).sort(), [false, true]);
  const counter = await docData(`slot_occupancy/${DAY}_12:00`);
  assert.equal(counter.count, 1, "a repeated approval counts one seat");
  // createAppointment does not consume seats (pending), but the full slot is refused.
  const full = await settle(booking.createAppointment(callable("user-1", {
    duration: "30", preferredSlot: { date: DAY, time: "12:00" }, reason: "",
  })));
  assert.equal(full.reason, "slot_full");
  assert.equal((await docData("bonos/bono-1")).minutosRestantes, 480);
});

test("real concurrency: two deletions of the same appointment refund and record once", async () => {
  await seed(baseDocuments({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 420, estado: "activo",
      fechaExpiracion: "2099-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": {
      userId: "user-1", status: "approved", duration: "60", serviceType: "Bono",
      approvedSlot: { date: DAY, time: "13:00" }, preferredSlots: [{ date: DAY, time: "13:00" }],
      bonoId: "bono-1", minutesDeducted: true, minutesDeductedAmount: 60,
      minutesDeductedAt: new Date().toISOString(), minutesRefundedAt: null,
    },
    [`slot_occupancy/${DAY}_13:00`]: { date: DAY, time: "13:00", count: 1 },
    [`slot_occupancy/${DAY}_13:15`]: { date: DAY, time: "13:15", count: 1 },
    [`slot_occupancy/${DAY}_13:30`]: { date: DAY, time: "13:30", count: 1 },
    [`slot_occupancy/${DAY}_13:45`]: { date: DAY, time: "13:45", count: 1 },
  }));
  const results = await Promise.all([1, 2].map(() => settle(admin.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] })))));
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  const bono = await docData("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 480);
  assert.equal(bono.historial.filter((entry) => entry.accion === "devolucion_cita").length, 1);
  assert.equal((await docData(`slot_occupancy/${DAY}_13:00`)).count, 0);
  const record = await docData("appointment_deletions/a1");
  assert.equal(record.finance.refundStatus, "refunded");
  assert.ok(record.expiresAt?.toDate() > new Date(), "TTL field stored as a real Timestamp");
});

// ------------------------------------------------- forced interleaving

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Same real Firestore client, but the first transactional read of each
 * transaction attempt runs `onFirstRead` (once per test). Used to start the
 * competing operation while this transaction is open and has already read,
 * which is the window a real race needs. Nothing about Firestore is simulated.
 */
function interleavingDb(onFirstRead) {
  let fired = false;
  return new Proxy(db, {
    get(target, property) {
      if (property === "runTransaction") {
        return (callback, options) => target.runTransaction(async (transaction) => {
          const proxied = new Proxy(transaction, {
            get(tx, key) {
              if (key === "get") {
                return async (...args) => {
                  const result = await tx.get(...args);
                  if (!fired) {
                    fired = true;
                    await onFirstRead();
                  }
                  return result;
                };
              }
              const value = Reflect.get(tx, key, tx);
              return typeof value === "function" ? value.bind(tx) : value;
            },
          });
          return callback(proxied);
        }, options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function assertBlockBookingInvariant(block, book, label) {
  assert.ok(!(block.ok && book.ok), `${label}: block and booking both committed in the same slot`);
  const blocks = (await db.collection("blocked_slots").get()).size;
  const appointments = (await db.collection("appointments").get()).docs.map((doc) => doc.data());
  const bono = await docData("bonos/bono-1");
  if (block.ok) {
    assert.equal(blocks, 2, label);
    assert.equal(appointments.length, 0, `${label}: booking inside a blocked slot`);
    assert.equal(bono.minutosRestantes, 480, `${label}: refused booking debited minutes`);
    return "block";
  }
  if (book.ok) {
    assert.equal(blocks, 0, `${label}: refused block left blocks`);
    assert.equal(appointments.length, 1, label);
    assert.equal(bono.minutosRestantes, 450, label);
    return "booking";
  }
  assert.equal(blocks, 0, label);
  assert.equal(appointments.length, 0, label);
  assert.equal(bono.minutosRestantes, 480, label);
  return "both_refused";
}

const blockRequest = { date: DAY, startTimes: ["11:00"], groupDurationMinutes: 30, deleteAppointmentIds: [] };
const bookingRequest = { duration: "30", preferredSlot: { date: DAY, time: "11:00" }, reason: "", appointmentType: "training" };

test("forced interleaving: booking starts while the block transaction is open", async () => {
  const outcomes = {};
  for (let index = 0; index < 5; index += 1) {
    await resetDatabase();
    await seed(baseDocuments());
    let bookingPromise;
    const blockingAdmin = createAdminAppointmentStatusHandlers({
      db: interleavingDb(async () => {
        bookingPromise = settle(booking.createAppointment(callable("user-1", bookingRequest)));
        await sleep(300);
      }),
      requireAdmin: async () => undefined,
      getNowDate,
    });
    const block = await settle(blockingAdmin.blockSlotsFromAdmin(callable("admin", blockRequest)));
    const book = await bookingPromise;
    const outcome = await assertBlockBookingInvariant(block, book, `block-first #${index}`);
    outcomes[`${outcome}:${block.ok ? "ok" : block.reason}/${book.ok ? "ok" : book.reason}`] = (outcomes[`${outcome}:${block.ok ? "ok" : block.reason}/${book.ok ? "ok" : book.reason}`] ?? 0) + 1;
  }
  console.log("[emulator] booking during open block transaction", outcomes);
});

test("forced interleaving: block starts while the booking transaction is open", async () => {
  const outcomes = {};
  for (let index = 0; index < 5; index += 1) {
    await resetDatabase();
    await seed(baseDocuments());
    let blockPromise;
    const interleavedBooking = createCustomerBookingHandlers({
      db: interleavingDb(async () => {
        blockPromise = settle(admin.blockSlotsFromAdmin(callable("admin", blockRequest)));
        await sleep(300);
      }),
      getNowDate,
    });
    const book = await settle(interleavedBooking.createAppointment(callable("user-1", bookingRequest)));
    const block = await blockPromise;
    const outcome = await assertBlockBookingInvariant(block, book, `booking-first #${index}`);
    outcomes[`${outcome}:${block.ok ? "ok" : block.reason}/${book.ok ? "ok" : book.reason}`] = (outcomes[`${outcome}:${block.ok ? "ok" : block.reason}/${book.ok ? "ok" : book.reason}`] ?? 0) + 1;
  }
  console.log("[emulator] block during open booking transaction", outcomes);
});

// ------------------------------------------------------------ admin overrides

const { createAdminAppointmentCreateHandlers } = require("../../lib/adminAppointmentCreate.js");
const adminCreate = createAdminAppointmentCreateHandlers({ db, requireAdmin: async () => undefined, getNowDate });

function overrideRequest(extra = {}) {
  return {
    userId: "user-1", date: DAY, time: "10:00", durationMinutes: 60, serviceType: "Bono Mensual de Entrenamiento",
    assignedTrainer: "trainer-1", status: "approved", comment: "", requestId: `emulator-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...extra,
  };
}

async function seedFullHour() {
  const occupancy = {};
  for (const minutes of ["00", "15", "30", "45"]) {
    occupancy[`slot_occupancy/${DAY}_10:${minutes}`] = { date: DAY, time: `10:${minutes}`, count: 4 };
  }
  await seed(baseDocuments({
    ...occupancy,
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "services/svc-1": { title: "Bono Mensual de Entrenamiento", active: true },
  }));
}

test("admin override: a full slot needs confirmation, then is created over capacity exactly once", async () => {
  await resetDatabase();
  await seedFullHour();
  const data = overrideRequest();
  const prompt = await adminCreate.createAppointmentFromAdmin(callable("admin", data)).then(
    () => assert.fail("expected a confirmation request"),
    (error) => error,
  );
  assert.equal(prompt.details.reason, "admin_override_required");
  assert.equal((await db.collection("appointments").get()).size, 0);

  const fingerprint = prompt.details.fingerprint;
  // Double click: both confirmations race with the same request id.
  const results = await Promise.all([
    adminCreate.createAppointmentFromAdmin(callable("admin", { ...data, acknowledgedRestrictions: fingerprint })),
    adminCreate.createAppointmentFromAdmin(callable("admin", { ...data, acknowledgedRestrictions: fingerprint })),
  ]);
  assert.equal(results[0].appointmentId, results[1].appointmentId);
  const appointments = await db.collection("appointments").get();
  assert.equal(appointments.size, 1);
  assert.equal(appointments.docs[0].data().adminOverride.restrictions[0].reason, "slot_full");
  assert.equal((await db.doc(`slot_occupancy/${DAY}_10:00`).get()).data().count, 5);
  assert.equal((await db.doc("bonos/bono-1").get()).data().minutosRestantes, 420);
});

// ------------------------------------------------------------ cancellations with charge

/** Customer books through the real callable, the admin approves: minutes reserved, seat taken. */
async function bookAndApprove(time) {
  const booked = await booking.createAppointment(callable("user-1", {
    duration: "60", preferredSlot: { date: DAY, time }, reason: "", appointmentType: "training",
  }));
  const appointmentId = booked.appointmentId ?? booked.id;
  await admin.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId, status: "approved", expectedStatus: "pending" }));
  return appointmentId;
}

const cancelAs = (appointmentId, cancellationCharge, expectedStatus = "approved") => admin.updateAppointmentStatusFromAdmin(callable("admin", {
  appointmentId, status: "cancelled", expectedStatus, cancellationCharge,
}));

test("charged cancellation: seat released, minutes kept, and a later deletion refunds nothing", async () => {
  await resetDatabase();
  await seed(baseDocuments());
  const id = await bookAndApprove("16:00");
  assert.equal((await docData("bonos/bono-1")).minutosRestantes, 420);
  assert.equal((await docData(`slot_occupancy/${DAY}_16:45`)).count, 1);

  const result = await cancelAs(id, "charged");
  assert.equal(result.chargedMinutes, 60);
  const stored = await docData(`appointments/${id}`);
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancellationCharge, "charged");
  assert.equal(stored.cancellationChargedMinutes, 60);
  assert.equal(stored.cancellationChargeDecidedBy, "admin");
  for (const time of ["16:00", "16:15", "16:30", "16:45"]) {
    assert.equal((await docData(`slot_occupancy/${DAY}_${time}`)).count, 0, time);
  }
  assert.equal((await docData("bonos/bono-1")).minutosRestantes, 420);

  const deleted = await admin.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: [id] }));
  assert.deepEqual(deleted.refundedIds, []);
  const bono = await docData("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 420);
  assert.equal(bono.historial.filter((entry) => entry.accion === "devolucion_cita").length, 0);
  const record = await docData(`appointment_deletions/${id}`);
  assert.equal(record.finance.refundReason, "cancelled_with_charge");
  assert.equal(record.finance.cancellationChargedMinutes, 60);
});

test("real concurrency: cancelling with and without charge at once decides once, refunds at most once", async () => {
  const outcomes = { charged: 0, not_charged: 0 };
  for (let index = 0; index < 6; index += 1) {
    await resetDatabase();
    await seed(baseDocuments());
    const id = await bookAndApprove("17:00");
    const [first, second] = await Promise.all([settle(cancelAs(id, "charged")), settle(cancelAs(id, "not_charged"))]);
    assert.equal([first, second].filter((result) => result.ok).length, 1, `iteration ${index}: exactly one decision`);
    assert.equal([first, second].find((result) => !result.ok).reason, "already_cancelled");
    const stored = await docData(`appointments/${id}`);
    outcomes[stored.cancellationCharge] += 1;
    const bono = await docData("bonos/bono-1");
    const refunds = bono.historial.filter((entry) => entry.accion === "devolucion_cita").length;
    assert.equal(bono.minutosRestantes, stored.cancellationCharge === "charged" ? 420 : 480);
    assert.equal(refunds, stored.cancellationCharge === "charged" ? 0 : 1);
    assert.equal((await docData(`slot_occupancy/${DAY}_17:00`)).count, 0);
  }
  console.log("[emulator] charged vs not charged race outcomes", outcomes);
});

test("real concurrency: repeated cancellations without charge refund exactly once", async () => {
  await resetDatabase();
  await seed(baseDocuments());
  const id = await bookAndApprove("19:00");
  const results = await Promise.all([1, 2, 3].map(() => settle(cancelAs(id, "not_charged"))));
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.deepEqual(results.map((result) => result.value.changed).sort(), [false, false, true]);
  const bono = await docData("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 480);
  assert.equal(bono.historial.filter((entry) => entry.accion === "devolucion_cita").length, 1);
});

test("a pending customer request cancelled with charge keeps its reserved minutes and no seat", async () => {
  await resetDatabase();
  await seed(baseDocuments());
  const booked = await booking.createAppointment(callable("user-1", {
    duration: "30", preferredSlot: { date: DAY, time: "20:00" }, reason: "", appointmentType: "training",
  }));
  const id = booked.appointmentId ?? booked.id;
  const result = await cancelAs(id, "charged", "pending");
  assert.equal(result.chargedMinutes, 30);
  assert.equal((await docData("bonos/bono-1")).minutosRestantes, 450);
  assert.equal(await docData(`slot_occupancy/${DAY}_20:00`), undefined, "a pending request never held a seat");
});
