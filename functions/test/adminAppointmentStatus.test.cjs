const assert = require("node:assert/strict");
const test = require("node:test");

const { createAdminAppointmentStatusHandlers } = require("../lib/adminAppointmentStatus.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Wednesday 14 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-14T08:00:00.000Z");
const DAY = "2026-10-20";

function appointment(overrides = {}) {
  const slot = overrides.slot ?? { date: DAY, time: "10:00" };
  const data = {
    userId: "user-1",
    name: "Lucía",
    email: "lucia@example.com",
    phone: "",
    serviceType: "Bono Mensual de Entrenamiento",
    duration: "60",
    preferredSlots: [slot],
    date: slot.date,
    time: slot.time,
    reason: "",
    status: "pending",
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-10-10T09:00:00.000Z",
    minutesRefundedAt: null,
    createdAt: "2026-10-10T09:00:00.000Z",
    ...overrides,
  };
  delete data.slot;
  return data;
}

function occupancy(time, count, date = DAY) {
  return { [`slot_occupancy/${date}_${time}`]: { date, time, count } };
}

function baseDocuments(extra = {}) {
  return {
    "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2 },
    "users/admin": { role: "admin", email: "admin@example.com", name: "Admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com" },
    "users/user-2": { uid: "user-2", name: "Pablo", email: "pablo@example.com" },
    "users/user-3": { uid: "user-3", name: "Marta", email: "marta@example.com" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "trainers/nutri-1": { uid: "n1", name: "Nora", active: true, offersNutrition: true },
    "bonos/bono-1": {
      userId: "user-1",
      tamano: 480,
      minutosTotales: 480,
      minutosRestantes: 420,
      estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z",
      historial: [],
    },
    ...extra,
  };
}

function setup(extra = {}) {
  const db = new FakeFirestore(baseDocuments(extra));
  const handlers = createAdminAppointmentStatusHandlers({
    db,
    requireAdmin: async (uid) => {
      if (uid !== "admin") throw new Error("not admin");
    },
    getNowDate: () => NOW,
  });
  return { db, handlers };
}

function count(db, time, date = DAY) {
  return db.doc(`slot_occupancy/${date}_${time}`)?.count ?? 0;
}

/** Every slot_occupancy document must keep the shape the published apps parse. */
function assertOccupancyShape(db) {
  for (const [path, data] of db.documents) {
    if (!path.startsWith("slot_occupancy/")) continue;
    assert.equal(typeof data.date, "string", path);
    assert.equal(typeof data.time, "string", path);
    assert.ok(Number.isInteger(data.count) && data.count >= 0, `${path} count=${data.count}`);
    assert.equal(path, `slot_occupancy/${data.date}_${data.time}`);
  }
}

function logs(db, action) {
  return [...db.documents].filter(([path, data]) => path.startsWith("activity_logs/") && data.action === action);
}

const approve = (handlers, id, extra = {}) => handlers.updateAppointmentStatusFromAdmin(callable("admin", {
  appointmentId: id,
  status: "approved",
  expectedStatus: "pending",
  ...extra,
}));

test("approving occupies every 15-min block of the session once", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  const result = await approve(handlers, "a1");
  assert.equal(result.changed, true);
  for (const time of ["10:00", "10:15", "10:30", "10:45"]) assert.equal(count(db, time), 1);
  assert.equal(count(db, "11:00"), 0);
  const stored = db.doc("appointments/a1");
  assert.equal(stored.status, "approved");
  assert.deepEqual(stored.approvedSlot, { date: DAY, time: "10:00" });
  assert.equal(stored.sessionType, "Bono Mensual de Entrenamiento");
  // Minutes were reserved at booking: approval must not debit again.
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420);
  assert.equal(logs(db, "appointment_approved").length, 1);
  assertOccupancyShape(db);
});

test("repeating an approval (double click, retry) is a no-op", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  await approve(handlers, "a1");
  const again = await approve(handlers, "a1");
  assert.equal(again.changed, false);
  assert.equal(count(db, "10:00"), 1);
  assert.equal(logs(db, "appointment_approved").length, 1);
});

test("two simultaneous approvals of the same appointment count one seat", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  const results = await Promise.all([approve(handlers, "a1"), approve(handlers, "a1")]);
  assert.deepEqual(results.map((result) => result.changed).sort(), [false, true]);
  assert.equal(count(db, "10:00"), 1);
  assert.equal(count(db, "10:45"), 1);
});

test("two admins racing for the last seat: one wins, the other gets an overridable slot_full", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment(),
    "appointments/a2": appointment({ userId: "user-2", bonoId: undefined, minutesDeducted: false }),
    ...occupancy("10:00", 1), ...occupancy("10:15", 1), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
  });
  const outcomes = await Promise.allSettled([approve(handlers, "a1"), approve(handlers, "a2")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const failure = outcomes.find((outcome) => outcome.status === "rejected").reason;
  assert.equal(failure.details.reason, "slot_full");
  assert.equal(failure.details.overridable, true);
  assert.equal(failure.details.maxCapacity, 2);
  assert.equal(count(db, "10:00"), 2);
  assert.ok(db.conflicts >= 1, "the losing transaction must have been retried on fresh data");
});

test("allowOverCapacity exceeds only the capacity, with an audit log", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment(),
    ...occupancy("10:00", 2),
  });
  const refused = await rejectsWithReason(approve(handlers, "a1"), "slot_full");
  assert.equal(refused.details.occupancy, 2);
  assert.equal(db.doc("appointments/a1").status, "pending");
  const result = await approve(handlers, "a1", { allowOverCapacity: true });
  assert.equal(result.overCapacity, true);
  assert.equal(count(db, "10:00"), 3);
  const [[, log]] = logs(db, "appointment_approved_over_capacity");
  assert.equal(log.occupancyBefore, 2);
  assert.equal(log.maxCapacity, 2);
  assertOccupancyShape(db);
});

test("allowOverCapacity never bypasses a blocked slot", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment(),
    [`blocked_slots/${DAY}_10:30`]: { date: DAY, time: "10:30", createdBy: "admin", createdAt: "x" },
  });
  await rejectsWithReason(approve(handlers, "a1", { allowOverCapacity: true }), "slot_blocked");
  assert.equal(count(db, "10:00"), 0);
});

test("allowOverCapacity never bypasses a duplicate booking of the customer", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment(),
    "appointments/a0": appointment({ status: "approved", slot: { date: DAY, time: "10:30" }, approvedSlot: { date: DAY, time: "10:30" } }),
    ...occupancy("10:30", 2), ...occupancy("10:45", 2), ...occupancy("11:00", 1), ...occupancy("11:15", 1),
  });
  // Full AND duplicated: the duplicate is reported even when capacity could be overridden.
  await rejectsWithReason(approve(handlers, "a1"), "appointment_conflict");
  await rejectsWithReason(approve(handlers, "a1", { allowOverCapacity: true }), "appointment_conflict");
  assert.equal(db.doc("appointments/a1").status, "pending");
});

test("allowOverCapacity never bypasses a professional conflict (nutrition)", async () => {
  const nutrition = { appointmentType: "nutrition", duration: "30", serviceType: "Consulta de nutrición", minutesDeducted: false, bonoId: undefined };
  const { db, handlers } = setup({
    "appointments/n1": appointment({ ...nutrition, userId: "user-2", status: "approved", assignedTrainer: "nutri-1", approvedSlot: { date: DAY, time: "10:00" } }),
    "appointments/n2": appointment(nutrition),
    ...occupancy("10:00", 2), ...occupancy("10:15", 2),
  });
  await rejectsWithReason(approve(handlers, "n2", { assignedTrainer: "nutri-1", allowOverCapacity: true }), "professional_conflict");
  await rejectsWithReason(approve(handlers, "n2"), "trainer_required", "invalid-argument");
  assert.equal(db.doc("appointments/n2").status, "pending");
});

test("a corrupt counter is detected, never read as free capacity", async () => {
  for (const corrupt of [-1, "1", 1.5, null]) {
    const { db, handlers } = setup({ "appointments/a1": appointment(), ...occupancy("10:15", corrupt) });
    await rejectsWithReason(approve(handlers, "a1", { allowOverCapacity: true }), "invalid_occupancy");
    assert.equal(db.doc("appointments/a1").status, "pending");
    assert.equal(db.doc(`slot_occupancy/${DAY}_10:15`).count, corrupt);
  }
});

test("a stale screen cannot overwrite a newer status", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment({ status: "cancelled" }) });
  const error = await rejectsWithReason(approve(handlers, "a1"), "status_changed");
  assert.equal(error.details.currentStatus, "cancelled");
  assert.equal(db.doc("appointments/a1").status, "cancelled");
});

test("45-min session crossing into a full block is refused (15/30/45/60 grids)", async () => {
  for (const slotInterval of [15, 30, 45, 60]) {
    const { db, handlers } = setup({
      "site_config/main": { startHour: 7, endHour: 22, slotInterval, maxCapacity: 2 },
      // 10:00 is a valid start on every grid (07:00 + n * interval).
      "appointments/a1": appointment({ duration: "45", slot: { date: DAY, time: "10:00" } }),
      ...occupancy("10:30", 2),
    });
    await rejectsWithReason(approve(handlers, "a1"), "slot_full");
    assert.equal(count(db, "10:00"), 0, `interval ${slotInterval}`);
  }
  // Adjacent, non-overlapping sessions do not compete: 09:00-09:45 vs a full 09:45 block.
  const { db, handlers } = setup({
    "appointments/a1": appointment({ duration: "45", slot: { date: DAY, time: "09:00" } }),
    ...occupancy("09:45", 2),
  });
  await approve(handlers, "a1");
  assert.equal(count(db, "09:30"), 1);
  assert.equal(count(db, "09:45"), 2);
});

test("cancelling releases the seat and refunds the minutes exactly once", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
    ...occupancy("10:00", 2), ...occupancy("10:15", 2), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
  });
  const cancel = () => handlers.updateAppointmentStatusFromAdmin(callable("admin", {
    appointmentId: "a1", status: "cancelled", expectedStatus: "approved",
  }));
  await cancel();
  await cancel();
  assert.deepEqual(["10:00", "10:15", "10:30", "10:45"].map((time) => count(db, time)), [1, 1, 0, 0]);
  const stored = db.doc("appointments/a1");
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancelledBy, "admin");
  assert.ok(stored.minutesRefundedAt);
  const bono = db.doc("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 480);
  assert.equal(bono.historial.filter((entry) => entry.accion === "devolucion_cita").length, 1);
  assertOccupancyShape(db);
});

test("rejecting a request refunds its reserved minutes in the same transaction", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "rejected", expectedStatus: "pending" }));
  assert.equal(db.doc("appointments/a1").status, "rejected");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 480);
  assert.equal(count(db, "10:00"), 0);
});

test("back to pending releases the seat and drops the stale approvedSlot", async () => {
  const approvedSlot = { date: DAY, time: "12:00" };
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot, slot: { date: DAY, time: "10:00" } }),
    ...occupancy("12:00", 1), ...occupancy("12:15", 1), ...occupancy("12:30", 1), ...occupancy("12:45", 1),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "pending", expectedStatus: "approved" }));
  const stored = db.doc("appointments/a1");
  assert.equal(stored.status, "pending");
  assert.equal(stored.approvedSlot, undefined);
  // The appointment stays where the admin saw it (no spurious "rescheduled" notice).
  assert.deepEqual(stored.preferredSlots, [approvedSlot]);
  assert.equal(count(db, "12:00"), 0);
  // Approving again counts the visible slot once.
  await approve(handlers, "a1");
  assert.equal(count(db, "12:00"), 1);
  assert.equal(count(db, "10:00"), 0);
});

test("legacy appointments with only date/time are released correctly", async () => {
  const legacy = appointment({ status: "approved", slot: { date: DAY, time: "18:00" }, duration: "30" });
  delete legacy.preferredSlots;
  const { db, handlers } = setup({ "appointments/l1": legacy, ...occupancy("18:00", 1), ...occupancy("18:15", 1) });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "l1", status: "cancelled", expectedStatus: "approved" }));
  assert.equal(count(db, "18:00"), 0);
  assert.equal(count(db, "18:15"), 0);
});

test("past requests can be approved without a capacity check (historical registration)", async () => {
  const past = { date: "2026-10-01", time: "10:00" };
  const { db, handlers } = setup({
    "appointments/p1": appointment({ slot: past }),
    ...occupancy("10:00", 2, past.date),
  });
  await approve(handlers, "p1");
  assert.equal(count(db, "10:00", past.date), 3);
});

test("pending recurring occurrences must be handled as a series", async () => {
  const { handlers } = setup({ "appointments/r1": appointment({ recurrenceSeriesId: "s1" }) });
  await rejectsWithReason(approve(handlers, "r1"), "recurring_series_action");
});

test("cancelling an approved occurrence keeps the series metadata consistent", async () => {
  const occurrence = (id, date, index) => ({
    [`appointments/${id}`]: appointment({
      status: "approved",
      slot: { date, time: "10:00" },
      approvedSlot: { date, time: "10:00" },
      recurrenceSeriesId: "s1",
      recurrenceIndex: index,
    }),
  });
  const { db, handlers } = setup({
    ...occurrence("o1", "2026-10-20", 0),
    ...occurrence("o2", "2026-10-27", 1),
    ...occurrence("o3", "2026-11-03", 2),
    "appointment_recurrences/s1": {
      userId: "user-1", duration: "60", status: "approved", occurrenceCount: 3, totalMinutes: 180, bonoId: "bono-1",
      startDate: "2026-10-20", startTime: "10:00", intervalDays: 7, endDate: "2026-11-03", origin: "admin",
    },
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "o2", status: "cancelled", expectedStatus: "approved" }));
  const series = db.doc("appointment_recurrences/s1");
  assert.equal(series.occurrenceCount, 2);
  assert.equal(series.totalMinutes, 120);
  assert.equal(series.futureOccurrenceCount, 2);
  assert.equal(series.status, "approved");
});

test("deleting appointments releases seats, refunds once and is idempotent", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
    "appointments/a2": appointment({ slot: { date: DAY, time: "12:00" } }),
    ...occupancy("10:00", 1), ...occupancy("10:15", 1), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
  });
  const result = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1", "a2"] }));
  assert.deepEqual(result.deletedIds.sort(), ["a1", "a2"]);
  assert.deepEqual(result.refundedIds.sort(), ["a1", "a2"]);
  assert.equal(db.doc("appointments/a1"), undefined);
  assert.equal(count(db, "10:00"), 0);
  // Both refunds hit the same bono: 420 + 60 + 60 capped at 480 and recorded.
  const bono = db.doc("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 480);
  assert.equal(bono.historial.filter((entry) => entry.accion === "devolucion_cita").length, 2);
  const again = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.deepEqual(again.alreadyDeletedIds, ["a1"]);
  assert.equal(db.doc("bonos/bono-1").historial.length, 2);
  assert.equal(logs(db, "appointment_deleted").length, 2);
});

test("blocking with deletion is atomic: an already blocked slot aborts everything", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
    ...occupancy("10:00", 1), ...occupancy("10:15", 1), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
    [`blocked_slots/${DAY}_10:15`]: { date: DAY, time: "10:15", createdBy: "admin", createdAt: "x" },
  });
  const request = { date: DAY, startTimes: ["10:00", "10:30"], groupDurationMinutes: 30, deleteAppointmentIds: ["a1"] };
  await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", request)), "slot_already_blocked");
  assert.ok(db.doc("appointments/a1"), "nothing deleted when the block fails");
  assert.equal(count(db, "10:00"), 1);
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined);

  db.documents.delete(`blocked_slots/${DAY}_10:15`);
  const result = await handlers.blockSlotsFromAdmin(callable("admin", { ...request, reason: "Mantenimiento" }));
  assert.deepEqual(result.deletedIds, ["a1"]);
  assert.equal(result.blockedSlotIds.length, 4);
  assert.equal(db.doc(`blocked_slots/${DAY}_10:30`).blockGroupId, `${DAY}_10:30_30`);
  assert.equal(db.doc(`blocked_slots/${DAY}_10:30`).reason, "Mantenimiento");
  assert.equal(db.doc("appointments/a1"), undefined);
  assert.equal(count(db, "10:45"), 0);
});

test("blocking refuses to delete appointments outside the selection", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment({ slot: { date: DAY, time: "15:00" } }) });
  const error = await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", {
    date: DAY, startTimes: ["10:00"], groupDurationMinutes: 30, deleteAppointmentIds: ["a1"],
  })), "appointments_changed");
  assert.deepEqual(error.details.missingIds, ["a1"]);
  assert.ok(db.doc("appointments/a1"));
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined);
});

test("assigning a bono replaces the active one atomically and idempotently", async () => {
  const { db, handlers } = setup();
  const request = (requestId) => handlers.assignBonoFromAdmin(callable("admin", {
    userId: "user-1", tamano: 360, requestId,
    fechaAsignacion: "2026-10-14T00:00:00.000Z", fechaExpiracion: "2026-11-14T22:59:59.000Z",
  }));
  const first = await request("req-aaaaaaaa");
  assert.deepEqual(first.replacedBonoIds, ["bono-1"]);
  const repeat = await request("req-aaaaaaaa");
  assert.equal(repeat.alreadyCreated, true);
  const old = db.doc("bonos/bono-1");
  assert.equal(old.estado, "agotado");
  assert.equal(old.replacedByBonoId, "req-aaaaaaaa");
  const created = db.doc("bonos/req-aaaaaaaa");
  assert.deepEqual(
    { estado: created.estado, tamano: created.tamano, minutosTotales: created.minutosTotales, minutosRestantes: created.minutosRestantes },
    { estado: "activo", tamano: 360, minutosTotales: 360, minutosRestantes: 360 },
  );
  assert.deepEqual(created.historial, []);
});

test("concurrent bono assignments still leave a single active bono", async () => {
  const { db, handlers } = setup();
  await Promise.all(["req-bbbbbbbb", "req-cccccccc"].map((requestId) => handlers.assignBonoFromAdmin(callable("admin", {
    userId: "user-1", tamano: 240, requestId,
    fechaAsignacion: "2026-10-14T00:00:00.000Z", fechaExpiracion: "2026-11-14T22:59:59.000Z",
  }))));
  const active = [...db.documents].filter(([path, data]) => path.startsWith("bonos/") && data.userId === "user-1" && data.estado === "activo");
  assert.equal(active.length, 1);
});

test("a refund never reactivates a replaced bono: minutes go to the current active bono", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 0, estado: "agotado",
      replacedByBonoId: "bono-2", fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "bonos/bono-2": {
      userId: "user-1", tamano: 360, minutosTotales: 360, minutosRestantes: 300, estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "cancelled", expectedStatus: "approved" }));
  assert.equal(db.doc("bonos/bono-1").estado, "agotado");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 0);
  assert.equal(db.doc("bonos/bono-2").minutosRestantes, 360);
  assert.equal(db.doc("bonos/bono-2").historial[0].sourceBonoId, "bono-1");
  assert.equal(db.doc("appointments/a1").minutesRefundedToBonoId, "bono-2");
});

test("legacy replaced bono (agotado with another active bono) is never reactivated either", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 0, estado: "agotado",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "bonos/bono-2": {
      userId: "user-1", tamano: 360, minutosTotales: 360, minutosRestantes: 300, estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment(),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "rejected", expectedStatus: "pending" }));
  const active = [...db.documents].filter(([path, data]) => path.startsWith("bonos/") && data.estado === "activo");
  assert.equal(active.length, 1);
});

test("refund with no active bono to receive it changes no bono and is flagged", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 0, estado: "agotado",
      replacedByBonoId: "bono-2", fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment(),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "rejected", expectedStatus: "pending" }));
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 0);
  assert.equal(db.doc("bonos/bono-1").estado, "agotado");
  const stored = db.doc("appointments/a1");
  assert.equal(stored.minutesRefundedAt, null);
  assert.match(stored.minutesRefundReason, /sustituido/);
});

test("a refund never exceeds the bono maximum and records what was trimmed", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 450, estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment(),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "rejected", expectedStatus: "pending" }));
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 480);
  assert.equal(db.doc("appointments/a1").minutesRefundCappedAmount, 30);
});

test("admin-created pending requests are debited on approval, exactly once", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ bonoId: undefined, minutesDeducted: undefined, minutesDeductedAmount: undefined, minutesDeductedAt: undefined }),
  });
  await approve(handlers, "a1");
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 360);
  assert.equal(db.doc("appointments/a1").bonoId, "bono-1");
  assert.equal(db.doc("appointments/a1").minutesDeductedAmount, 60);
});

test("non-admins are refused", async () => {
  const { handlers } = setup({ "appointments/a1": appointment() });
  await assert.rejects(handlers.updateAppointmentStatusFromAdmin(callable("user-1", {
    appointmentId: "a1", status: "approved", expectedStatus: "pending",
  })), /not admin/);
});

// ------------------------------------------------------------ integrations

const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");
const { buildCalendarSyncHash, buildCalendarEventPayload, resolveAppointmentSlot } = require("../lib/googleCalendarSync.js");
const { createSlotMigrationHandlers } = require("../lib/slotMigrations.js");

test("customer notices and calendar events match each transition (no duplicates on retries)", async () => {
  const { db, handlers } = setup({ "appointments/a1": appointment() });
  const snapshot = () => structuredClone(db.doc("appointments/a1"));

  const pending = snapshot();
  await approve(handlers, "a1");
  const approved = snapshot();
  assert.equal(classifyAppointmentChange(pending, approved, NOW).event, "appointment_confirmed");
  const client = { name: "Lucía", email: "lucia@example.com", phone: "" };
  assert.deepEqual(resolveAppointmentSlot(approved), { date: DAY, time: "10:00" });
  assert.ok(buildCalendarEventPayload({ appointmentId: "a1", appointment: approved, client, trainerName: "" }));

  const writesBefore = db.writes.length;
  await approve(handlers, "a1");
  assert.equal(db.writes.length, writesBefore, "an idempotent repeat writes nothing, so no trigger fires again");

  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "pending", expectedStatus: "approved" }));
  const backToPending = snapshot();
  // Same visible slot: the customer is told it is pending again, not "rescheduled".
  assert.equal(classifyAppointmentChange(approved, backToPending, NOW).event, "appointment_requested");
  assert.equal(
    buildCalendarSyncHash({ appointmentId: "a1", appointment: backToPending, client, trainerName: "" })
      === buildCalendarSyncHash({ appointmentId: "a1", appointment: approved, client, trainerName: "" }),
    false,
  );

  await approve(handlers, "a1");
  const reapproved = snapshot();
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "cancelled", expectedStatus: "approved" }));
  assert.equal(classifyAppointmentChange(reapproved, snapshot(), NOW).event, "appointment_cancelled");

  await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.equal(classifyAppointmentChange(reapproved, undefined, NOW).event, "appointment_deleted");
});

test("reconciliation dry run reports per-slot differences without writing", async () => {
  let applied = false;
  const migrations = createSlotMigrationHandlers({
    getTodayMadrid: () => "2026-10-14",
    requireAdmin: async () => undefined,
    readApprovedAppointments: async () => [{
      id: "a1",
      data: appointment({ status: "approved", approvedSlot: { date: DAY, time: "18:15" }, duration: "30" }),
    }],
    readOccupancyDocuments: async () => [
      { id: `${DAY}_18:15`, data: { date: DAY, time: "18:15", count: 3 } },
      { id: `${DAY}_18:30`, data: { date: DAY, time: "18:30", count: 1 } },
      { id: `${DAY}_19:00`, data: { date: DAY, time: "19:00", count: 0 } },
    ],
    readBlockedSlotDocuments: async () => [],
    applyOperations: async () => { applied = true; },
  });
  const report = await migrations.reconcileSlotOccupancyFromApprovedAppointments({ auth: { uid: "admin" }, data: { mode: "dryRun" } });
  assert.equal(applied, false);
  assert.equal(report.applied, false);
  assert.deepEqual(report.differences, [
    { id: `${DAY}_18:15`, date: DAY, time: "18:15", operation: "update", actualCount: 3, expectedCount: 1 },
    { id: `${DAY}_19:00`, date: DAY, time: "19:00", operation: "delete", actualCount: 0, expectedCount: 0 },
  ]);
  await assert.rejects(
    migrations.reconcileSlotOccupancyFromApprovedAppointments({ auth: { uid: "admin" }, data: { mode: "apply" } }),
    /confirmApply/,
  );
  assert.equal(applied, false);
});

// ------------------------------------------------- deletion audit records

function deletionRecord(db, id) {
  return db.doc(`appointment_deletions/${id}`);
}

const PERSONAL_FIELDS = ["name", "email", "phone", "reason", "trainerNotes"];

function assertNoPersonalData(record) {
  const flat = JSON.stringify(record);
  for (const field of PERSONAL_FIELDS) assert.ok(!flat.includes(`"${field}"`), `record must not store ${field}`);
  assert.ok(!flat.includes("lucia@example.com"));
  assert.ok(!flat.includes("Lucía"));
}

test("deleting with an impossible refund keeps the minutes pending for manual review", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 0, estado: "agotado",
      replacedByBonoId: "bono-2", fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" }, trainerNotes: "nota" }),
    ...occupancy("10:00", 1), ...occupancy("10:15", 1), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
  });
  const result = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.equal(db.doc("appointments/a1"), undefined);
  assert.deepEqual(result.refundedIds, []);
  assert.equal(result.pendingRefunds.length, 1);
  assert.equal(result.pendingRefunds[0].appointmentId, "a1");
  assert.equal(result.pendingRefunds[0].minutes, 60);
  assert.match(result.pendingRefunds[0].reason, /sustituido/);
  // No bono receives the minutes automatically.
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 0);
  assert.equal(db.doc("bonos/bono-1").estado, "agotado");

  const record = deletionRecord(db, "a1");
  assert.equal(record.userId, "user-1");
  assert.equal(record.context, "admin_delete");
  assert.deepEqual(record.appointment.slot, { date: DAY, time: "10:00" });
  assert.equal(record.finance.refundStatus, "pending_manual");
  assert.equal(record.finance.pendingRefundMinutes, 60);
  assert.equal(record.finance.bonoId, "bono-1");
  assert.equal(record.manualReview.status, "pending");
  assert.equal(record.expiresAt, undefined, "pending records never expire before review");
  assertNoPersonalData(record);
  const [[, log]] = logs(db, "appointment_deleted");
  assert.equal(log.refundStatus, "pending_manual");
  assert.equal(log.pendingRefundMinutes, 60);
});

test("deleting with a capped refund records the trimmed minutes as pending", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 450, estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment(),
  });
  const result = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 480);
  const record = deletionRecord(db, "a1");
  assert.equal(record.finance.refundStatus, "refunded_capped");
  assert.equal(record.finance.refundedAmount, 30);
  assert.equal(record.finance.cappedMinutes, 30);
  assert.equal(record.finance.pendingRefundMinutes, 30);
  assert.equal(record.expiresAt, undefined);
  assert.deepEqual(result.pendingRefunds.map((item) => [item.appointmentId, item.minutes]), [["a1", 30]]);
});

test("full and not-applicable refunds also leave a retained, minimal record", async () => {
  const nutrition = appointment({ appointmentType: "nutrition", duration: "30", minutesDeducted: false, bonoId: undefined, slot: { date: DAY, time: "12:00" } });
  const { db, handlers } = setup({ "appointments/a1": appointment(), "appointments/n1": nutrition });
  const result = await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1", "n1"] }));
  assert.deepEqual(result.pendingRefunds, []);
  const full = deletionRecord(db, "a1");
  assert.equal(full.finance.refundStatus, "refunded");
  assert.equal(full.finance.refundedAmount, 60);
  assert.equal(full.finance.refundedToBonoId, "bono-1");
  assert.equal(full.manualReview, null);
  const expires = full.expiresAt;
  assert.ok(expires, "resolved records carry a TTL timestamp");
  const expiresMs = (expires._seconds ?? expires.seconds) * 1000;
  assert.equal(new Date(expiresMs).toISOString(), "2028-10-14T08:00:00.000Z");
  assert.equal(deletionRecord(db, "n1").finance.refundStatus, "not_refundable");
  assertNoPersonalData(full);
  // Repeating the deletion creates no second refund and keeps the same record.
  await handlers.deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a1"] }));
  assert.equal(db.doc("bonos/bono-1").historial.filter((entry) => entry.accion === "devolucion_cita").length, 1);
  assert.equal(deletionRecord(db, "a1").finance.refundStatus, "refunded");
});

test("cancel with an impossible refund flags the appointment for manual review", async () => {
  const { db, handlers } = setup({
    "bonos/bono-1": {
      userId: "user-1", tamano: 480, minutosTotales: 480, minutosRestantes: 0, estado: "agotado",
      replacedByBonoId: "bono-2", fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [],
    },
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
  });
  await handlers.updateAppointmentStatusFromAdmin(callable("admin", { appointmentId: "a1", status: "cancelled", expectedStatus: "approved" }));
  const stored = db.doc("appointments/a1");
  assert.equal(stored.minutesRefundPendingReview, true);
  assert.equal(stored.minutesRefundPendingAmount, 60);
  assert.equal(stored.minutesRefundedAt, null);
});

// ------------------------------------------------- block verification

const blockRequest = (extra = {}) => ({
  date: DAY, startTimes: ["10:00", "10:30"], groupDurationMinutes: 30, deleteAppointmentIds: [], ...extra,
});

test("blocking with deletion checks every overlapping appointment, not only the ids sent", async () => {
  // A customer request (preferredSlots only, no top-level date) the admin screen did not include.
  const customerRequest = appointment({ userId: "user-2", slot: { date: DAY, time: "10:45" }, duration: "30" });
  delete customerRequest.date;
  delete customerRequest.time;
  const { db, handlers } = setup({ "appointments/c1": customerRequest });
  const error = await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", blockRequest())), "appointments_changed");
  assert.deepEqual(error.details.unexpectedIds, ["c1"]);
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined);
  assert.ok(db.doc("appointments/c1"));
});

test("older approvals found only through approvedSlot and legacy date/time are detected", async () => {
  const oldApproval = appointment({ status: "approved", slot: { date: "2026-10-19", time: "09:00" }, approvedSlot: { time: "10:15", date: DAY } });
  const legacy = appointment({ userId: "user-2", status: "approved", slot: { date: DAY, time: "09:30" }, duration: "60" });
  delete legacy.preferredSlots;
  const { handlers } = setup({ "appointments/o1": oldApproval, "appointments/l1": legacy });
  const error = await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", blockRequest())), "appointments_changed");
  assert.deepEqual(error.details.unexpectedIds, ["l1", "o1"]);
});

test("blocking with deletion requested succeeds when nothing overlaps", async () => {
  const { db, handlers } = setup({
    "appointments/far": appointment({ slot: { date: DAY, time: "15:00" } }),
    "appointments/before": appointment({ userId: "user-2", slot: { date: DAY, time: "09:00" } }),
    "appointments/cancelled": appointment({ userId: "user-3", status: "cancelled", slot: { date: DAY, time: "10:00" } }),
  });
  const result = await handlers.blockSlotsFromAdmin(callable("admin", blockRequest()));
  assert.equal(result.blockedSlotIds.length, 4);
  assert.deepEqual(result.deletedIds, []);
  assert.ok(db.doc(`blocked_slots/${DAY}_10:45`));
});

test("a booking created while the block is confirming makes it fail with nothing written", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
    ...occupancy("10:00", 1), ...occupancy("10:15", 1), ...occupancy("10:30", 1), ...occupancy("10:45", 1),
  });
  let injected = false;
  db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    // Concurrent customer booking (customer flows write only preferredSlots).
    const booking = appointment({ userId: "user-2", slot: { date: DAY, time: "10:30" }, duration: "30" });
    delete booking.date;
    delete booking.time;
    await db.collection("appointments").doc("late").set(booking);
  };
  const error = await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", blockRequest({ deleteAppointmentIds: ["a1"] }))), "appointments_changed");
  assert.deepEqual(error.details.unexpectedIds, ["late"]);
  assert.ok(db.conflicts >= 1, "the transaction was retried on fresh data");
  assert.ok(db.doc("appointments/a1"), "nothing deleted");
  assert.ok(db.doc("appointments/late"));
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined, "nothing blocked");
  assert.equal(count(db, "10:00"), 1);
  assert.equal(deletionRecord(db, "a1"), undefined);
});

test("a cancellation during the block confirmation also aborts it", async () => {
  const { db, handlers } = setup({
    "appointments/a1": appointment({ status: "approved", approvedSlot: { date: DAY, time: "10:00" } }),
  });
  let injected = false;
  db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    await db.collection("appointments").doc("a1").set({ status: "cancelled" }, { merge: true });
  };
  const error = await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", blockRequest({ deleteAppointmentIds: ["a1"] }))), "appointments_changed");
  assert.deepEqual(error.details.missingIds, ["a1"]);
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined);
  assert.equal(db.doc("appointments/a1").status, "cancelled");
});

test("blocking refuses safely when the day is too large to verify", async () => {
  const many = {};
  for (let index = 0; index < 301; index += 1) {
    many[`appointments/x${index}`] = appointment({ userId: `user-${index}`, status: "cancelled", slot: { date: DAY, time: "10:00" } });
  }
  const { db, handlers } = setup(many);
  await rejectsWithReason(handlers.blockSlotsFromAdmin(callable("admin", blockRequest())), "operation_too_large");
  assert.equal(db.doc(`blocked_slots/${DAY}_10:00`), undefined);
});

test("candidate start slots cover every session that can reach the blocks", () => {
  const { candidateStartSlots } = require("../lib/adminAppointmentStatus.js");
  const slots = candidateStartSlots(DAY, new Set([`${DAY}_10:00`, `${DAY}_00:15`]));
  assert.deepEqual(slots.map((slot) => slot.time), ["00:00", "00:15", "09:15", "09:30", "09:45", "10:00"]);
});
