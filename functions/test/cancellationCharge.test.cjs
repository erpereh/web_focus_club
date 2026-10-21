// Cancellations with and without charge: the admin decides, in one
// transaction, whether the consumed minutes stay consumed. A charge must never
// be undone later by the trigger, a deletion or a retry.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createAdminAppointmentStatusHandlers } = require("../lib/adminAppointmentStatus.js");
const { readFinanceContext, refundAppointmentMinutesInTransaction } = require("../lib/appointmentFinance.js");
const { chargeableMinutesOf, isChargedCancellation } = require("../lib/cancellationCharge.js");
const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");
const { buildAppointmentNotice } = require("../lib/notifications/builders.js");
const { buildPendingSeriesOccurrencePatch } = require("../lib/recurringAppointments.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Wednesday 14 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-14T08:00:00.000Z");
const DAY = "2026-10-14";
const SLOT = { date: DAY, time: "18:00" };

function appointment(overrides = {}) {
  return {
    userId: "user-1",
    name: "Lucía",
    email: "lucia@example.com",
    serviceType: "Bono Mensual de Entrenamiento",
    duration: "60",
    preferredSlots: [SLOT],
    date: SLOT.date,
    time: SLOT.time,
    status: "approved",
    approvedSlot: SLOT,
    assignedTrainer: "trainer-1",
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-10-10T09:00:00.000Z",
    minutesRefundedAt: null,
    createdAt: "2026-10-10T09:00:00.000Z",
    ...overrides,
  };
}

function occupancy(count) {
  return Object.fromEntries(["18:00", "18:15", "18:30", "18:45"].map((time) => [
    `slot_occupancy/${DAY}_${time}`, { date: DAY, time, count },
  ]));
}

function setup(extra = {}) {
  const db = new FakeFirestore({
    "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 },
    "users/admin": { role: "admin", email: "admin@example.com" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 420, estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    ...extra,
  });
  const handlers = createAdminAppointmentStatusHandlers({
    db,
    requireAdmin: async (uid) => {
      if (uid !== "admin") throw new Error("not admin");
    },
    getNowDate: () => NOW,
  });
  return { db, handlers };
}

const cancel = (handlers, id, cancellationCharge, expectedStatus = "approved") => handlers.updateAppointmentStatusFromAdmin(callable("admin", {
  appointmentId: id,
  status: "cancelled",
  expectedStatus,
  ...(cancellationCharge === undefined ? {} : { cancellationCharge }),
}));

function refunds(db) {
  return db.doc("bonos/bono-1").historial.filter((entry) => entry.accion === "devolucion_cita").length;
}

function logs(db, action) {
  return [...db.documents].filter(([key, data]) => key.startsWith("activity_logs/") && data.action === action).map(([, data]) => data);
}

function counts(db) {
  return ["18:00", "18:15", "18:30", "18:45"].map((time) => db.doc(`slot_occupancy/${DAY}_${time}`)?.count ?? 0);
}

test("with charge: frees the seat, keeps the minutes consumed and records who decided", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(2) });
  const result = await cancel(handlers, "a1", "charged");
  assert.equal(result.changed, true);
  assert.equal(result.cancellationCharge, "charged");
  assert.equal(result.chargedMinutes, 60);
  assert.deepEqual(counts(db), [1, 1, 1, 1]);

  const stored = db.doc("appointments/a1");
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancelledBy, "admin");
  assert.equal(stored.cancelledAt, NOW.toISOString());
  assert.equal(stored.cancellationCharge, "charged");
  assert.equal(stored.cancellationChargedMinutes, 60);
  assert.equal(stored.cancellationChargeDecidedBy, "admin");
  assert.equal(stored.cancellationChargeDecidedByUid, "admin");
  assert.equal(stored.cancellationChargeDecidedAt, NOW.toISOString());
  assert.equal(stored.minutesRefundedAt, null, "no refund marker");
  assert.equal(stored.minutesDeductedAmount, 60, "the original debit is untouched");

  const bono = db.doc("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 420);
  assert.equal(bono.historial.length, 0, "a charge never writes a new bono movement");
  const [log] = logs(db, "appointment_cancelled");
  assert.equal(log.cancellationCharge, "charged");
  assert.equal(log.chargedMinutes, 60);
});

test("without charge: refunds exactly once and records the decision", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", "not_charged");
  await cancel(handlers, "a1", "not_charged");
  const stored = db.doc("appointments/a1");
  assert.equal(stored.cancellationCharge, "not_charged");
  assert.equal(stored.cancellationChargedMinutes, 0);
  assert.ok(stored.minutesRefundedAt);
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 480);
  assert.equal(refunds(db), 1);
  assert.deepEqual(counts(db), [0, 0, 0, 0]);
  assert.equal(logs(db, "appointment_cancelled").length, 1);
});

test("an admin tab opened before the change (no modality sent) keeps the old behaviour: without charge", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", undefined);
  assert.equal(db.doc("appointments/a1").cancellationCharge, "not_charged");
  assert.equal(refunds(db), 1);
});

test("an unknown modality is refused without writing", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await rejectsWithReason(cancel(handlers, "a1", "maybe"), "invalid_request");
  assert.equal(db.doc("appointments/a1").status, "approved");
});

test("repeating a cancellation never refunds or charges again; the other modality is refused", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", "charged");
  const writes = db.writes.length;
  const again = await cancel(handlers, "a1", "charged");
  assert.equal(again.changed, false);
  assert.equal(again.cancellationCharge, "charged");
  assert.equal(db.writes.length, writes, "an idempotent repeat writes nothing");

  await rejectsWithReason(cancel(handlers, "a1", "not_charged"), "already_cancelled");
  const retryWithoutModality = await cancel(handlers, "a1", undefined);
  assert.equal(retryWithoutModality.changed, false);
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  assert.equal(refunds(db), 0);
});

test("two admins cancelling at once with different modalities: one decision wins, the other is refused", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  const outcomes = await Promise.allSettled([cancel(handlers, "a1", "charged"), cancel(handlers, "a1", "not_charged")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const refused = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(refused.reason.details.reason, "already_cancelled");
  const stored = db.doc("appointments/a1");
  const expectedBalance = stored.cancellationCharge === "charged" ? 420 : 480;
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, expectedBalance);
  assert.equal(refunds(db), stored.cancellationCharge === "charged" ? 0 : 1);
  assert.deepEqual(counts(db), [0, 0, 0, 0]);
});

test("historical cancellations are never reclassified", async () => {
  const { db, handlers } = setup({
    "appointments/old": appointment({ status: "cancelled", cancelledBy: "admin", minutesRefundedAt: "2026-09-01T10:00:00.000Z" }),
  });
  const result = await cancel(handlers, "old", "charged");
  assert.equal(result.changed, false);
  assert.equal(result.cancellationCharge, null);
  assert.equal(db.doc("appointments/old").cancellationCharge, undefined);
});

test("a pending customer request (minutes reserved at booking) can be cancelled with charge, without touching capacity", async () => {
  const { db, handlers } = setup({
    "appointments/p1": appointment({ status: "pending", approvedSlot: undefined }),
    ...occupancy(1),
  });
  const result = await cancel(handlers, "p1", "charged", "pending");
  assert.equal(result.chargedMinutes, 60);
  assert.deepEqual(counts(db), [1, 1, 1, 1], "a pending request never held a seat");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  assert.equal(db.doc("appointments/p1").cancellationCharge, "charged");
});

test("a pending request without charge refunds its reserved minutes", async () => {
  const { db, handlers } = setup({ "appointments/p1": appointment({ status: "pending", approvedSlot: undefined }) });
  await cancel(handlers, "p1", "not_charged", "pending");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 480);
  assert.equal(refunds(db), 1);
});

test("nothing consumed yet (admin-created pending, no bono, nutrition): a charge debits nothing", async () => {
  const { db, handlers } = setup({
    "appointments/admin-pending": appointment({ status: "pending", approvedSlot: undefined, minutesDeducted: false, minutesDeductedAmount: undefined, minutesDeductedAt: null }),
    "appointments/no-bono": appointment({ bonoId: undefined, minutesDeducted: false, minutesDeductedAt: null }),
    "appointments/nutrition": appointment({ appointmentType: "nutrition", bonoId: undefined, minutesDeducted: false }),
    ...occupancy(2),
  });
  for (const [id, expected] of [["admin-pending", "pending"], ["no-bono", "approved"], ["nutrition", "approved"]]) {
    const result = await cancel(handlers, id, "charged", expected);
    assert.equal(result.chargedMinutes, 0, id);
    assert.equal(db.doc(`appointments/${id}`).cancellationChargedMinutes, 0, id);
  }
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  assert.equal(db.doc("bonos/bono-1").historial.length, 0);
});

test("minutes already refunded are never counted as charged", () => {
  assert.equal(chargeableMinutesOf(appointment({ minutesRefundedAt: "2026-10-11T10:00:00.000Z" })), 0);
  assert.equal(chargeableMinutesOf(appointment({ minutesDeductedAmount: 45 })), 45);
  assert.equal(chargeableMinutesOf(appointment({ minutesDeducted: false })), 0);
  assert.equal(chargeableMinutesOf(appointment({ minutesDeductedAmount: "x" })), 0);
  assert.equal(isChargedCancellation({ cancellationCharge: "charged" }), true);
  assert.equal(isChargedCancellation({ cancellationCharge: "not_charged" }), false);
  assert.equal(isChargedCancellation({}), false);
});

test("pending recurring occurrences are still handled as a series", async () => {
  const { handlers } = setup({ "appointments/r1": appointment({ status: "pending", recurrenceSeriesId: "s1" }) });
  await rejectsWithReason(cancel(handlers, "r1", "charged", "pending"), "recurring_series_action");
});

test("charging one approved occurrence keeps the series metadata consistent", async () => {
  const occurrence = (id, date, index) => ({
    [`appointments/${id}`]: appointment({
      preferredSlots: [{ date, time: "18:00" }], date, approvedSlot: { date, time: "18:00" },
      recurrenceSeriesId: "s1", recurrenceIndex: index,
    }),
  });
  const { db, handlers } = setup({
    ...occurrence("o1", "2026-10-14", 0),
    ...occurrence("o2", "2026-10-21", 1),
    "appointment_recurrences/s1": {
      userId: "user-1", duration: "60", status: "approved", occurrenceCount: 2, totalMinutes: 120, bonoId: "bono-1",
      startDate: "2026-10-14", startTime: "18:00", intervalDays: 7, endDate: "2026-10-21", origin: "admin",
    },
    ...occupancy(1),
  });
  await cancel(handlers, "o1", "charged");
  const series = db.doc("appointment_recurrences/s1");
  assert.equal(series.occurrenceCount, 1);
  assert.equal(series.totalMinutes, 60);
  assert.equal(series.status, "approved");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
});

test("the trigger's reconciliation (same refund helper) never refunds a charge", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", "charged");
  const ref = db.collection("appointments").doc("a1");
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();
    const context = await readFinanceContext(transaction, db, data);
    return refundAppointmentMinutesInTransaction(transaction, ref, data, context, NOW.toISOString());
  });
  assert.equal(result.refunded, false);
  assert.deepEqual(result.outcome, { kind: "charged", amount: 60 });
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  assert.equal(db.doc("appointments/a1").minutesRefundPendingReview, undefined, "a charge is never a pending refund");
});

test("deleting a charged cancellation keeps the charge and says so in the audit record", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", "charged");
  const result = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.deepEqual(result.deletedIds, ["a1"]);
  assert.deepEqual(result.refundedIds, []);
  assert.deepEqual(result.pendingRefunds, []);
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  const record = db.doc("appointment_deletions/a1");
  assert.equal(record.finance.refundStatus, "not_refundable");
  assert.equal(record.finance.refundReason, "cancelled_with_charge");
  assert.equal(record.finance.cancellationCharge, "charged");
  assert.equal(record.finance.cancellationChargedMinutes, 60);
  assert.equal(record.finance.pendingRefundMinutes, 0);
  assert.ok(record.expiresAt, "nothing pending: normal retention");
  const [log] = logs(db, "appointment_deleted");
  assert.equal(log.cancellationCharge, "charged");
  assert.equal(log.minutesRefunded, false);
});

test("deleting a cancellation without charge does not refund twice", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy(1) });
  await cancel(handlers, "a1", "not_charged");
  await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.equal(refunds(db), 1);
  assert.equal(db.doc("appointment_deletions/a1").finance.cancellationCharge, "not_charged");
});

test("customers get the same neutral notice for a charge (no refund claimed)", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment({ date: "2026-10-15", preferredSlots: [{ date: "2026-10-15", time: "18:00" }], approvedSlot: { date: "2026-10-15", time: "18:00" } }) });
  const before = structuredClone(db.doc("appointments/a1"));
  await cancel(handlers, "a1", "charged");
  const after = db.doc("appointments/a1");
  const change = classifyAppointmentChange(before, after, NOW);
  assert.equal(change.event, "appointment_cancelled");
  const notice = buildAppointmentNotice({
    uid: "user-1", dedupeKey: "k", event: "appointment_cancelled", appointmentId: "a1", status: "cancelled",
    customerName: "Lucía", slot: { date: "2026-10-15", time: "18:00" }, sessionType: "Entrenamiento", trainerName: "Ana",
    minutesRefunded: Boolean(after.minutesRefundedAt),
  });
  assert.equal(notice.title, "Cita cancelada");
  assert.doesNotMatch(notice.body, /devuelto|cargo|descontad/i);
});

test("customer and automatic cancellations are recorded as without charge", () => {
  const patch = buildPendingSeriesOccurrencePatch({ status: "cancelled", now: "2026-10-14T08:00:00.000Z", refundPatch: {} });
  assert.equal(patch.cancellationCharge, "not_charged");
  assert.equal(patch.cancellationChargeDecidedBy, "customer");
  const rejected = buildPendingSeriesOccurrencePatch({ status: "rejected", now: "2026-10-14T08:00:00.000Z", refundPatch: {} });
  assert.equal(rejected.cancellationCharge, undefined, "a rejection is not a cancellation");

  const source = (file) => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
  const cancelOwn = source("index.ts").match(/export const cancelOwnAppointment[\s\S]*?\n\);/)[0];
  assert.match(cancelOwn, /notChargedCancellationPatch\("customer", now, requestUid\)/);
  assert.match(source("recurringReschedule.ts"), /customer_series_schedule_reduction",\n\s*\.\.\.notChargedCancellationPatch\("customer"/);
  assert.match(source("adminAppointmentReschedule.ts"), /admin_series_schedule_reduction",\n\s*\.\.\.cancellationChargePatch\(\{ charge: "not_charged"/);
  assert.match(source("appointmentProposals.ts"), /isProposal \? \{\} : notChargedCancellationPatch\("customer", now, uid\)/);
});

test("only Cloud Functions can write the charge fields (rules)", () => {
  const rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  const block = rules.match(/match \/appointments\/\{appointmentId\} \{([\s\S]*?)\n {4}\}/)[1];
  assert.match(block, /allow create: if isAdmin\(\)\s*&& !request\.resource\.data\.keys\(\)\.hasAny\(cancellationChargeFields\(\)\)/);
  assert.match(block, /isAdmin\(\) && recurringAppointmentClientUpdateAllowed\(\) && cancellationChargeUnchanged\(\)/);
  for (const field of ["cancellationCharge", "cancellationChargedMinutes", "cancellationChargeDecidedBy", "cancellationChargeDecidedByUid", "cancellationChargeDecidedAt"]) {
    assert.match(rules, new RegExp(`'${field}'`));
  }
});

test("non-admins cannot cancel with or without charge", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  await assert.rejects(handlers.updateAppointmentStatusFromAdmin(callable("user-1", {
    appointmentId: "a1", status: "cancelled", expectedStatus: "approved", cancellationCharge: "not_charged",
  })));
  assert.equal(db.doc("appointments/a1").status, "approved");
});
