const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  calculateAppointmentDeduction,
  calculateAppointmentRefund,
  reconcileAppointmentMinutes,
  reconcileOwnAppointmentReschedule,
  selectExactlyOneActiveBono,
  validateOwnFutureAppointment,
  validateOwnReschedule,
  approvalOnlyAppointmentFields,
  isRescheduleCapacityAvailable,
  shouldReconcileAppointmentTransition,
} = require("../lib/appointmentLifecycle.js");

class MemoryTransaction {
  constructor() {
    this.bonoWrites = [];
    this.appointmentWrites = [];
  }

  setBono(id, patch) { this.bonoWrites.push({ id, patch }); }
  setAppointment(patch) { this.appointmentWrites.push(patch); }
}

const activeBono = { id: "bono-a", estado: "activo", minutosTotales: 60, minutosRestantes: 60 };
const expiredBono = { ...activeBono, estado: "expirado", fechaExpiracion: "2020-01-01", minutosRestantes: 0 };

assert.equal(selectExactlyOneActiveBono([activeBono]), activeBono);
assert.equal(selectExactlyOneActiveBono([]), undefined);
assert.equal(selectExactlyOneActiveBono([activeBono, { ...activeBono, id: "bono-b" }]), undefined);

const deduction = calculateAppointmentDeduction(activeBono, 45, "2026-07-14T09:00:00.000Z");
assert.deepEqual(deduction, {
  ok: true,
  bonoId: "bono-a",
  remainingMinutes: 15,
  bonoStatus: "activo",
  minutesDeducted: true,
  minutesDeductedAmount: 45,
  minutesDeductedAt: "2026-07-14T09:00:00.000Z",
});
assert.equal(calculateAppointmentDeduction(activeBono, 90, "2026-07-14T09:00:00.000Z").ok, false);

const refunded = calculateAppointmentRefund(expiredBono, {
  bonoId: "bono-a",
  minutesDeducted: true,
  minutesDeductedAmount: 45,
  minutesDeductedAt: "2026-07-14T09:00:00.000Z",
  minutesRefundedAt: null,
}, "2026-07-14T10:00:00.000Z");
assert.deepEqual(refunded, {
  ok: true,
  remainingMinutes: 45,
  bonoStatus: "expirado",
  minutesRefunded: true,
  minutesRefundedAmount: 45,
  minutesRefundedAt: "2026-07-14T10:00:00.000Z",
});
assert.equal(calculateAppointmentRefund(activeBono, { minutesDeducted: true, minutesDeductedAmount: 30, minutesRefundedAt: "done" }, "now").ok, false);

// Exercise the production lifecycle reconciliation with a tiny transaction adapter.
// A rejected appointment that is approved again must reserve its original bono once,
// then become idempotent on repeated approval delivery.
const reapprovalTx = new MemoryTransaction();
const refundedAppointment = {
  bonoId: "bono-a",
  minutesDeducted: true,
  minutesDeductedAmount: 30,
  minutesDeductedAt: "2026-07-14T08:00:00.000Z",
  minutesRefundedAt: "2026-07-14T08:30:00.000Z",
};
assert.equal(reconcileAppointmentMinutes({
  action: "deduct",
  appointment: refundedAppointment,
  bono: activeBono,
  amount: 30,
  now: "2026-07-14T09:00:00.000Z",
  transaction: reapprovalTx,
}).ok, true);
assert.deepEqual(reapprovalTx.bonoWrites, [{ id: "bono-a", patch: { minutosRestantes: 30, estado: "activo" } }]);
assert.equal(reapprovalTx.appointmentWrites[0].minutesRefundedAt, null);
assert.equal(reconcileAppointmentMinutes({
  action: "deduct",
  appointment: { ...refundedAppointment, minutesRefundedAt: null },
  bono: { ...activeBono, minutosRestantes: 30 },
  amount: 30,
  now: "2026-07-14T09:01:00.000Z",
  transaction: reapprovalTx,
}).reason, "already-deducted");

const refundTx = new MemoryTransaction();
assert.equal(reconcileAppointmentMinutes({
  action: "refund",
  appointment: { ...refundedAppointment, minutesRefundedAt: null },
  bono: { ...activeBono, estado: "agotado", minutosRestantes: 0 },
  now: "2026-07-14T10:00:00.000Z",
  transaction: refundTx,
}).ok, true);
assert.deepEqual(refundTx.bonoWrites[0], { id: "bono-a", patch: { minutosRestantes: 30, estado: "activo" } });

assert.equal(validateOwnFutureAppointment({ userId: "u1", status: "pending", date: "2026-07-20", time: "10:00" }, "u1", new Date("2026-07-14T09:00:00").getTime()), undefined);
assert.equal(validateOwnFutureAppointment({ userId: "u2", status: "pending", date: "2026-07-20", time: "10:00" }, "u1", Date.now()), "not-owner");
assert.equal(validateOwnFutureAppointment({ userId: "u1", status: "cancelled", date: "2026-07-20", time: "10:00" }, "u1", Date.now()), "invalid-status");
assert.equal(validateOwnFutureAppointment({ userId: "u1", status: "approved", date: "2020-01-01", time: "10:00" }, "u1", Date.now()), "not-future");
assert.equal(validateOwnReschedule({ userId: "u1", status: "approved", date: "2020-01-01", time: "10:00" }, "u1", { date: "2026-07-20", time: "10:00" }, new Date("2026-07-14T09:00:00").getTime()), "not-future");
assert.equal(validateOwnReschedule({ userId: "u2", status: "pending", date: "2026-07-20", time: "10:00" }, "u1", { date: "2026-07-21", time: "10:00" }, new Date("2026-07-14T09:00:00").getTime()), "not-owner");
assert.deepEqual(approvalOnlyAppointmentFields(), ["approvedSlot", "assignedTrainer", "sessionType", "trainerNotes", "approvedAt", "approvedBy", "approvedByAdmin", "approvalNotes"]);

const rescheduleCalls = { released: 0, cleared: [], patches: [] };
const rescheduleResult = reconcileOwnAppointmentReschedule({
  appointment: { userId: "u1", status: "approved", date: "2026-07-20", time: "10:00" },
  uid: "u1",
  preferredSlot: { date: "2026-07-21", time: "11:00" },
  nowMillis: new Date("2026-07-14T09:00:00").getTime(),
  now: "2026-07-14T09:00:00.000Z",
  transaction: {
    releaseApprovedOccupancy: () => { rescheduleCalls.released += 1; },
    clearApprovalMetadata: (fields) => { rescheduleCalls.cleared.push(...fields); },
    setAppointment: (patch) => { rescheduleCalls.patches.push(patch); },
  },
});
assert.equal(rescheduleResult.ok, true);
assert.equal(rescheduleCalls.released, 1);
assert.deepEqual(rescheduleCalls.cleared, approvalOnlyAppointmentFields());
assert.equal(rescheduleCalls.patches[0].status, "pending");

const rejectedRescheduleCalls = { released: 0, patches: 0 };
assert.deepEqual(reconcileOwnAppointmentReschedule({
  appointment: { userId: "u2", status: "approved", date: "2020-01-01", time: "10:00" },
  uid: "u1",
  preferredSlot: { date: "2026-07-21", time: "11:00" },
  nowMillis: new Date("2026-07-14T09:00:00").getTime(),
  now: "2026-07-14T09:00:00.000Z",
  transaction: {
    releaseApprovedOccupancy: () => { rejectedRescheduleCalls.released += 1; },
    clearApprovalMetadata: () => {},
    setAppointment: () => { rejectedRescheduleCalls.patches += 1; },
  },
}), { ok: false, reason: "not-owner" });
assert.deepEqual(rejectedRescheduleCalls, { released: 0, patches: 0 });

assert.equal(isRescheduleCapacityAvailable(2, true, 2), true, "approved booking excludes its current occupancy");
assert.equal(isRescheduleCapacityAvailable(2, false, 2), false);

assert.equal(shouldReconcileAppointmentTransition("approved", "approved"), true);
assert.equal(shouldReconcileAppointmentTransition("approved", "cancelled"), false);
assert.equal(shouldReconcileAppointmentTransition("cancelled", "cancelled"), true);

// Transaction wiring: these assertions protect the Firestore lifecycle paths
// that cannot be exercised without an emulator in this dependency-free suite.
const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
assert.match(indexSource, /transaction\.create\(appointmentRef, \{ \.\.\.appointment, \.\.\.deduction \}\)/);
assert.match(indexSource, /minutesRefundedAt:\s*null/);
assert.match(indexSource, /minutesRefundReason:\s*null/);
assert.match(indexSource, /export const cancelOwnAppointment\s*=\s*onCall/);
assert.match(indexSource, /validateOwnFutureAppointment/);
assert.match(indexSource, /refundAppointmentMinutesInTransaction\(transaction, appointmentRef, appointment, bonoSnap, now\)/);
assert.match(indexSource, /export const updateOwnAppointmentSlot\s*=\s*onCall/);
assert.match(indexSource, /reconcileOwnAppointmentReschedule\(\{/);
assert.match(indexSource, /releaseApprovedAppointmentOccupancyInTransaction/);
assert.match(indexSource, /isRescheduleCapacityAvailable/);
assert.match(indexSource, /shouldReconcileAppointmentTransition\("approved", appointment\.status\)/);
assert.match(indexSource, /const expectedStatus = changedToRejected \? "rejected" : "cancelled"/);
assert.match(indexSource, /if \(status === "rejected" \|\| status === "cancelled"\)/);

console.log("appointment lifecycle tests passed");
