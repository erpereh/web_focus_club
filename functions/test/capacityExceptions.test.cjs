// Per-date capacity ("aforo por fecha"): helpers, the three admin callables and
// every booking path that must honour the effective capacity of its date.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  collectCapacityReductionRestrictions,
  createCapacityAdminHandlers,
  parseCapacityExceptionCapacity,
  parseCapacityExceptionDates,
  resolveMaxCapacity,
} = require("../lib/capacityExceptions.js");
const { createAdminAppointmentCreateHandlers } = require("../lib/adminAppointmentCreate.js");
const { createAdminAppointmentRescheduleHandlers } = require("../lib/adminAppointmentReschedule.js");
const { createAdminAppointmentStatusHandlers } = require("../lib/adminAppointmentStatus.js");
const { createAppointmentProposalHandlers } = require("../lib/appointmentProposals.js");
const { createCustomerBookingHandlers } = require("../lib/customerBooking.js");
const { planRecurringAppointments } = require("../lib/recurringAppointments.js");
const {
  prepareRecurringReschedule,
  validateRecurringRescheduleAvailability,
} = require("../lib/recurringReschedule.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");
const { appointmentOccupancyKeys } = require("../lib/slotOccupancy.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Wednesday 14 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-14T08:00:00.000Z");
const DAY = "2026-10-20";
const NEXT_WEEK = "2026-10-27";
const SERVICE = "Bono Mensual de Entrenamiento";

let requestCounter = 0;
const newRequestId = () => `capacity-request-${++requestCounter}`;

function hour(time, count, date = DAY) {
  const [hours] = time.split(":");
  return Object.fromEntries(["00", "15", "30", "45"].map((minutes) => [
    `slot_occupancy/${date}_${hours}:${minutes}`, { date, time: `${hours}:${minutes}`, count },
  ]));
}

function exception(date, maxCapacity) {
  return { [`capacity_exceptions/${date}`]: { date, maxCapacity, updatedAt: "2026-10-01T00:00:00.000Z" } };
}

function count(db, time, date = DAY) {
  return db.doc(`slot_occupancy/${date}_${time}`)?.count ?? 0;
}

function logs(db, action) {
  return [...db.documents].filter(([key, data]) => key.startsWith("activity_logs/") && data.action === action)
    .map(([, data]) => data);
}

function pending(userId, slot, extra = {}) {
  return {
    userId,
    name: "Cliente",
    email: `${userId}@example.com`,
    phone: "",
    serviceType: SERVICE,
    duration: "60",
    preferredSlots: [slot],
    date: slot.date,
    time: slot.time,
    reason: "",
    status: "pending",
    bonoId: `bono-${userId}`,
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-10-10T09:00:00.000Z",
    minutesRefundedAt: null,
    createdAt: "2026-10-10T09:00:00.000Z",
    ...extra,
  };
}

function approved(userId, slot, extra = {}) {
  return pending(userId, slot, { status: "approved", approvedSlot: slot, ...extra });
}

function bono(userId) {
  return {
    userId,
    tamano: 960,
    minutosTotales: 960,
    minutosRestantes: 900,
    estado: "activo",
    fechaExpiracion: "2026-12-31T22:59:59.000Z",
    historial: [],
  };
}

function baseDocuments(extra = {}) {
  return {
    "site_config/main": {
      startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4, capacityExceptionsEnabled: true,
    },
    "users/admin": { role: "admin", email: "admin@example.com", name: "Admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "user-1@example.com" },
    "users/user-2": { uid: "user-2", name: "Pablo", email: "user-2@example.com" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "services/svc-1": { title: SERVICE, active: true },
    "bonos/bono-user-1": bono("user-1"),
    "bonos/bono-user-2": bono("user-2"),
    ...extra,
  };
}

function setup(extra = {}, now = NOW) {
  const db = new FakeFirestore(baseDocuments(extra));
  const deps = {
    db,
    requireAdmin: async (uid) => {
      if (uid !== "admin") {
        const { HttpsError } = require("firebase-functions/v2/https");
        throw new HttpsError("permission-denied", "Permisos insuficientes.", { reason: "not_admin" });
      }
    },
    getNowDate: () => now,
  };
  return {
    db,
    capacity: createCapacityAdminHandlers(deps),
    booking: createCustomerBookingHandlers(deps),
    create: createAdminAppointmentCreateHandlers(deps),
    status: createAdminAppointmentStatusHandlers(deps),
    reschedule: createAdminAppointmentRescheduleHandlers(deps),
    proposals: createAppointmentProposalHandlers(deps),
    series: createRecurringSeriesHandlers({
      ...deps,
      appointmentSlotKeys: (appointment) => new Set(appointmentOccupancyKeys(appointment)),
      defaultServiceType: SERVICE,
    }),
  };
}

const book = (ctx, uid, slot, duration = "60") => ctx.booking.createAppointment(callable(uid, {
  duration, preferredSlot: slot, reason: "", appointmentType: "training",
}));

/** First call → confirmation details; second call with the fingerprint. */
async function confirm(call, data, reason) {
  const error = await rejectsWithReason(call(data), reason, "failed-precondition");
  return { error, result: await call({ ...data, acknowledgedRestrictions: error.details.fingerprint }) };
}

// ------------------------------------------------------------------ helpers

test("an exception replaces the global capacity of its date only", () => {
  const exceptions = new Map([[DAY, 2]]);
  assert.equal(resolveMaxCapacity({ maxCapacity: 4 }, exceptions, DAY), 2);
  assert.equal(resolveMaxCapacity({ maxCapacity: 4 }, exceptions, NEXT_WEEK), 4);
  assert.equal(resolveMaxCapacity({ maxCapacity: 4 }, new Map([[DAY, 6]]), DAY), 6, "it may also raise it");
});

test("stored exceptions are clamped like the global value; unusable ones fall back to global", () => {
  assert.equal(parseCapacityExceptionCapacity({ maxCapacity: 2 }), 2);
  assert.equal(parseCapacityExceptionCapacity({ maxCapacity: "3" }), 3);
  assert.equal(parseCapacityExceptionCapacity({ maxCapacity: 50 }), 10);
  assert.equal(parseCapacityExceptionCapacity({ maxCapacity: 0 }), 1);
  assert.equal(parseCapacityExceptionCapacity({}), undefined);
  assert.equal(parseCapacityExceptionCapacity({ maxCapacity: "dos" }), undefined);
  assert.equal(parseCapacityExceptionCapacity(undefined), undefined);
});

test("exception dates are unique, valid, not past and limited per request", () => {
  assert.deepEqual(parseCapacityExceptionDates([NEXT_WEEK, DAY, DAY], NOW), [DAY, NEXT_WEEK]);
  assert.deepEqual(parseCapacityExceptionDates(["2026-10-14"], NOW), ["2026-10-14"], "today is allowed");
  assert.throws(() => parseCapacityExceptionDates(["2026-10-13"], NOW), (error) => error.details.reason === "past_date");
  assert.throws(() => parseCapacityExceptionDates(["2026-02-30"], NOW), (error) => error.details.reason === "invalid_dates");
  assert.throws(() => parseCapacityExceptionDates([], NOW), (error) => error.details.reason === "invalid_dates");
  const many = Array.from({ length: 63 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 1 + index));
    return date.toISOString().slice(0, 10);
  });
  assert.throws(() => parseCapacityExceptionDates(many, NOW), (error) => error.details.reason === "too_many_dates");
});

test("reduction warnings list only upcoming blocks over the new capacity", () => {
  const restrictions = collectCapacityReductionRestrictions({
    targets: new Map([[DAY, 2], ["2026-10-14", 2]]),
    occupancyDocs: [
      { date: DAY, time: "10:00", count: 3 },
      { date: DAY, time: "11:00", count: 2 },
      { date: DAY, time: "12:00", count: "x" },
      { date: "2026-10-14", time: "09:00", count: 4 },
      { date: "2026-10-14", time: "18:00", count: 4 },
      { date: NEXT_WEEK, time: "10:00", count: 9 },
    ],
    now: NOW,
  });
  assert.deepEqual(restrictions, [
    { date: "2026-10-14", time: "18:00", reason: "capacity_below_occupancy", occupancy: 4, maxCapacity: 2 },
    { date: DAY, time: "10:00", reason: "capacity_below_occupancy", occupancy: 3, maxCapacity: 2 },
  ]);
});

// --------------------------------------------------------- admin callables

const upsert = (ctx, data, uid = "admin") => ctx.capacity.upsertCapacityExceptionsFromAdmin(callable(uid, data));
const remove = (ctx, data) => ctx.capacity.deleteCapacityExceptionsFromAdmin(callable("admin", data));
const setGlobal = (ctx, data) => ctx.capacity.updateMaxCapacityFromAdmin(callable("admin", data));

test("only admins manage capacity, with validated values and a request id", async () => {
  const ctx = setup();
  await rejectsWithReason(upsert(ctx, { dates: [DAY], maxCapacity: 2, requestId: newRequestId() }, "user-1"), "not_admin", "permission-denied");
  await rejectsWithReason(upsert(ctx, { dates: [DAY], maxCapacity: 11, requestId: newRequestId() }), "invalid_capacity", "invalid-argument");
  await rejectsWithReason(upsert(ctx, { dates: [DAY], maxCapacity: 1.5, requestId: newRequestId() }), "invalid_capacity", "invalid-argument");
  await rejectsWithReason(upsert(ctx, { dates: [DAY], maxCapacity: 2 }), "invalid_request_id", "invalid-argument");
  await rejectsWithReason(setGlobal(ctx, { maxCapacity: 0, requestId: newRequestId() }), "invalid_capacity", "invalid-argument");
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`), undefined);
});

test("exceptions cannot be created until the per-date capacity is enabled", async () => {
  const ctx = setup({ "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 } });
  await rejectsWithReason(
    upsert(ctx, { dates: [DAY], maxCapacity: 2, requestId: newRequestId() }),
    "capacity_exceptions_disabled",
    "failed-precondition",
  );
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`), undefined);
});

test("several dates get the same capacity in one audited, idempotent request", async () => {
  const ctx = setup();
  const data = { dates: [DAY, NEXT_WEEK, "2026-10-22"], maxCapacity: 2, requestId: newRequestId() };
  const result = await upsert(ctx, data);
  assert.deepEqual(result.dates, ["2026-10-20", "2026-10-22", "2026-10-27"]);
  for (const date of result.dates) {
    const stored = ctx.db.doc(`capacity_exceptions/${date}`);
    assert.equal(stored.date, date);
    assert.equal(stored.maxCapacity, 2);
    assert.equal(stored.updatedByUid, "admin");
  }
  const replay = await upsert(ctx, data);
  assert.equal(replay.replayed, true);
  assert.equal(logs(ctx.db, "capacity_exception_upserted").length, 1);
  await rejectsWithReason(upsert(ctx, { ...data, maxCapacity: 3 }), "request_id_reused");
});

test("editing an exception keeps the bookings and asks to confirm when approved seats exceed it", async () => {
  const ctx = setup({
    ...hour("10:00", 3),
    "appointments/a1": approved("user-1", { date: DAY, time: "10:00" }),
  });
  const data = { dates: [DAY], maxCapacity: 2, requestId: newRequestId() };
  const { error, result } = await confirm((input) => upsert(ctx, input), data, "capacity_reduction_confirmation_required");
  assert.deepEqual(error.details.restrictions.map((item) => [item.time, item.occupancy, item.maxCapacity]), [
    ["10:00", 3, 2], ["10:15", 3, 2], ["10:30", 3, 2], ["10:45", 3, 2],
  ]);
  assert.equal(result.success, true);
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`).maxCapacity, 2);
  assert.equal(count(ctx.db, "10:00"), 3, "counters are never touched");
  assert.equal(ctx.db.doc("appointments/a1").status, "approved", "existing appointments are never cancelled");
  assert.equal(logs(ctx.db, "capacity_exception_upserted")[0].restrictions.length, 4);
});

test("a confirmation made on an older occupancy is asked again", async () => {
  const ctx = setup(hour("10:00", 3));
  const data = { dates: [DAY], maxCapacity: 2, requestId: newRequestId() };
  const first = await rejectsWithReason(upsert(ctx, data), "capacity_reduction_confirmation_required");
  ctx.db.documents.set(`slot_occupancy/${DAY}_10:00`, { date: DAY, time: "10:00", count: 4 });
  const second = await rejectsWithReason(
    upsert(ctx, { ...data, acknowledgedRestrictions: first.details.fingerprint }),
    "capacity_reduction_confirmation_required",
  );
  assert.equal(second.details.changed, true);
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`), undefined);
});

test("raising a day's capacity never asks for confirmation", async () => {
  const ctx = setup(hour("10:00", 4));
  await upsert(ctx, { dates: [DAY], maxCapacity: 6, requestId: newRequestId() });
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`).maxCapacity, 6);
});

test("deleting an exception returns to the global value, confirming if that is lower", async () => {
  const ctx = setup({ ...exception(DAY, 6), ...exception(NEXT_WEEK, 2), ...hour("10:00", 5) });
  const data = { dates: [DAY, NEXT_WEEK, "2026-10-22"], requestId: newRequestId() };
  const { error, result } = await confirm((input) => remove(ctx, input), data, "capacity_reduction_confirmation_required");
  assert.deepEqual([...new Set(error.details.restrictions.map((item) => `${item.date}:${item.maxCapacity}`))], [`${DAY}:4`]);
  assert.deepEqual(result.dates, [DAY, NEXT_WEEK], "dates without an exception are ignored");
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`), undefined);
  assert.equal(ctx.db.doc(`capacity_exceptions/${NEXT_WEEK}`), undefined);
  assert.equal(count(ctx.db, "10:00"), 5);
});

test("existing exceptions can be deleted even while the feature is switched off", async () => {
  const ctx = setup({
    "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 },
    ...exception(DAY, 2),
  });
  await remove(ctx, { dates: [DAY], requestId: newRequestId() });
  assert.equal(ctx.db.doc(`capacity_exceptions/${DAY}`), undefined);
});

test("lowering the global capacity confirms only the upcoming days that follow it", async () => {
  const ctx = setup({
    ...hour("10:00", 3),
    ...hour("10:00", 3, NEXT_WEEK),
    ...exception(NEXT_WEEK, 3),
    ...hour("18:00", 3, "2026-10-13"),
  });
  const data = { maxCapacity: 2, requestId: newRequestId() };
  const { error, result } = await confirm((input) => setGlobal(ctx, input), data, "capacity_reduction_confirmation_required");
  assert.deepEqual([...new Set(error.details.restrictions.map((item) => item.date))], [DAY]);
  assert.equal(result.previousMaxCapacity, 4);
  assert.equal(ctx.db.doc("site_config/main").maxCapacity, 2);
  assert.equal(ctx.db.doc("site_config/main").startHour, 7, "the rest of the configuration is kept");
  assert.equal(logs(ctx.db, "max_capacity_updated")[0].previousMaxCapacity, 4);
  assert.equal(count(ctx.db, "10:00"), 3);
});

test("raising the global capacity is applied directly and replays once", async () => {
  const ctx = setup(hour("10:00", 4));
  const data = { maxCapacity: 6, requestId: newRequestId() };
  const result = await setGlobal(ctx, data);
  assert.equal(result.changed, true);
  assert.equal((await setGlobal(ctx, data)).replayed, true);
  assert.equal(logs(ctx.db, "max_capacity_updated").length, 1);
  assert.equal(ctx.db.doc("site_config/main").maxCapacity, 6);
});

// ----------------------------------------------------- customer bookings

test("customer booking: a day with capacity 2 refuses the third seat, others keep the global 4", async () => {
  const ctx = setup({ ...exception(DAY, 2), ...hour("10:00", 2), ...hour("10:00", 3, NEXT_WEEK) });
  await rejectsWithReason(book(ctx, "user-1", { date: DAY, time: "10:00" }), "slot_full", "failed-precondition");
  await book(ctx, "user-1", { date: NEXT_WEEK, time: "10:00" });
  await book(ctx, "user-1", { date: DAY, time: "12:00" });
});

test("customer booking: an exception above the global capacity admits the fifth seat", async () => {
  const ctx = setup({ ...exception(DAY, 6), ...hour("10:00", 5) });
  await book(ctx, "user-1", { date: DAY, time: "10:00" });
  ctx.db.documents.set(`capacity_exceptions/${DAY}`, { date: DAY, maxCapacity: 5 });
  await rejectsWithReason(book(ctx, "user-2", { date: DAY, time: "10:00" }), "slot_full");
});

test("concurrency: an exception saved while a booking is in flight is applied on retry", async () => {
  const ctx = setup(hour("10:00", 2));
  let injected = false;
  ctx.db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    ctx.db.apply([{ ref: ctx.db.collection("capacity_exceptions").doc(DAY), value: { date: DAY, maxCapacity: 2 } }]);
  };
  await rejectsWithReason(book(ctx, "user-1", { date: DAY, time: "10:00" }), "slot_full");
  assert.ok(ctx.db.conflicts >= 1, "the booking transaction was retried");
  assert.equal([...ctx.db.documents.keys()].filter((key) => key.startsWith("appointments/")).length, 0);
});

// ------------------------------------------------- admin create / approve

test("admin creation: the restriction carries the day's capacity and changes with it", async () => {
  const ctx = setup({ ...exception(DAY, 2), ...hour("10:00", 2) });
  const data = {
    userId: "user-1", date: DAY, time: "10:00", durationMinutes: 60, serviceType: SERVICE,
    assignedTrainer: "trainer-1", status: "approved", comment: "", requestId: newRequestId(),
  };
  const prompt = await rejectsWithReason(ctx.create.createAppointmentFromAdmin(callable("admin", data)), "admin_override_required");
  assert.deepEqual(prompt.details.restrictions, [{ date: DAY, time: "10:00", reason: "slot_full", occupancy: 2, maxCapacity: 2 }]);

  // The exception changes before the admin confirms: the old confirmation is no longer valid.
  ctx.db.documents.set(`capacity_exceptions/${DAY}`, { date: DAY, maxCapacity: 1 });
  const again = await rejectsWithReason(ctx.create.createAppointmentFromAdmin(callable("admin", {
    ...data, acknowledgedRestrictions: prompt.details.fingerprint,
  })), "admin_override_required");
  assert.equal(again.details.changed, true);
  assert.equal(again.details.restrictions[0].maxCapacity, 1);

  const created = await ctx.create.createAppointmentFromAdmin(callable("admin", {
    ...data, acknowledgedRestrictions: again.details.fingerprint,
  }));
  assert.equal(created.overriddenRestrictions[0].maxCapacity, 1);
  assert.equal(count(ctx.db, "10:00"), 3);
});

test("admin creation: below the day's raised capacity there is nothing to confirm", async () => {
  const ctx = setup({ ...exception(DAY, 6), ...hour("10:00", 5) });
  const created = await ctx.create.createAppointmentFromAdmin(callable("admin", {
    userId: "user-1", date: DAY, time: "10:00", durationMinutes: 60, serviceType: SERVICE,
    assignedTrainer: "trainer-1", status: "approved", comment: "", requestId: newRequestId(),
  }));
  assert.equal(created.overriddenRestrictions, undefined);
  assert.equal(count(ctx.db, "10:00"), 6);
});

test("approval: refused at the day's capacity, approved over it only with explicit consent", async () => {
  const slot = { date: DAY, time: "10:00" };
  const ctx = setup({ ...exception(DAY, 2), ...hour("10:00", 2), "appointments/p1": pending("user-1", slot) });
  const approve = (extra = {}) => ctx.status.updateAppointmentStatusFromAdmin(callable("admin", {
    appointmentId: "p1", status: "approved", expectedStatus: "pending", ...extra,
  }));
  const refused = await rejectsWithReason(approve(), "slot_full");
  assert.equal(refused.details.maxCapacity, 2);
  assert.equal(refused.details.overridable, true);
  const result = await approve({ allowOverCapacity: true });
  assert.equal(result.overCapacity, true);
  assert.equal(logs(ctx.db, "appointment_approved_over_capacity")[0].maxCapacity, 2);
  assert.equal(count(ctx.db, "10:00"), 3);
});

test("approval: a raised day admits seats over the global capacity without override", async () => {
  const slot = { date: DAY, time: "10:00" };
  const ctx = setup({ ...exception(DAY, 6), ...hour("10:00", 4), "appointments/p1": pending("user-1", slot) });
  const result = await ctx.status.updateAppointmentStatusFromAdmin(callable("admin", {
    appointmentId: "p1", status: "approved", expectedStatus: "pending",
  }));
  assert.equal(result.overCapacity, false);
  assert.equal(count(ctx.db, "10:00"), 5);
});

test("concurrency: two approvals for the last seat of a capacity-2 day, only one passes", async () => {
  const ctx = setup({
    ...exception(DAY, 2),
    ...hour("10:00", 1),
    "appointments/p1": pending("user-1", { date: DAY, time: "10:00" }),
    "appointments/p2": pending("user-2", { date: DAY, time: "10:00" }),
  });
  const approve = (id) => ctx.status.updateAppointmentStatusFromAdmin(callable("admin", {
    appointmentId: id, status: "approved", expectedStatus: "pending",
  })).then(() => "ok", (error) => error.details?.reason);
  const results = await Promise.all([approve("p1"), approve("p2")]);
  assert.deepEqual(results.sort(), ["ok", "slot_full"]);
  assert.equal(count(ctx.db, "10:00"), 2);
});

// -------------------------------------------------- reschedule / proposals

test("admin reschedule: the target day's capacity decides the confirmation", async () => {
  const ctx = setup({
    ...exception(NEXT_WEEK, 2),
    ...hour("10:00", 2, NEXT_WEEK),
    ...hour("10:00", 1),
    "appointments/a1": approved("user-1", { date: DAY, time: "10:00" }),
  });
  const move = { appointmentId: "a1", slot: { date: NEXT_WEEK, time: "10:00" }, assignedTrainer: null };
  const { error } = await confirm(
    (input) => ctx.reschedule.rescheduleAppointmentFromAdmin(callable("admin", input)),
    move,
    "admin_override_required",
  );
  assert.equal(error.details.restrictions[0].maxCapacity, 2);
  assert.equal(count(ctx.db, "10:00", NEXT_WEEK), 3);
  assert.equal(count(ctx.db, "10:00"), 0);
});

test("proposals: the proposed day's capacity is checked when proposing and again when accepting", async () => {
  const requested = { date: DAY, time: "10:00" };
  const proposed = { date: NEXT_WEEK, time: "11:00" };
  const ctx = setup({ ...hour("11:00", 1, NEXT_WEEK), "appointments/p1": pending("user-1", requested) });
  await ctx.proposals.proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "p1", slot: proposed }));
  // The day is reduced to 1 after the proposal: accepting must not take a seat over it.
  ctx.db.documents.set(`capacity_exceptions/${NEXT_WEEK}`, { date: NEXT_WEEK, maxCapacity: 1 });
  await rejectsWithReason(
    ctx.proposals.respondToAppointmentConfirmation(callable("user-1", { appointmentId: "p1", action: "accept" })),
    "slot_full",
  );
  assert.equal(count(ctx.db, "11:00", NEXT_WEEK), 1);
  await rejectsWithReason(
    ctx.proposals.proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "p1", slot: proposed })),
    "slot_full",
  );
});

// ------------------------------------------------------------ recurring

test("recurring plan: the occurrence on a reduced day is full, the rest use the global value", () => {
  const plan = (capacityByDate) => planRecurringAppointments({
    startDate: DAY,
    startTime: "10:00",
    endDate: "2026-11-03",
    intervalDays: 7,
    durationMinutes: 60,
    now: NOW,
    siteConfig: normalizeSiteConfig({ startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 }),
    occupancyByKey: new Map([`${NEXT_WEEK}_10:00`, `${NEXT_WEEK}_10:15`].map((key) => [key, 2])),
    capacityByDate,
    blockedKeys: new Set(),
    userSlotKeys: new Set(),
    activeBonos: [{ id: "b", userId: "user-1", estado: "activo", minutosTotales: 960, minutosRestantes: 900, fechaExpiracion: "2026-12-31T22:59:59.000Z" }],
  });
  assert.equal(plan(new Map()).ok, true);
  const refused = plan(new Map([[NEXT_WEEK, 2]]));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /27\/10\/2026.*completa/);
});

test("customer series crossing a capacity-2 day is refused as a whole", async () => {
  const ctx = setup({ ...exception(NEXT_WEEK, 2), ...hour("10:00", 2, NEXT_WEEK) });
  await assert.rejects(ctx.series.createRecurringAppointments(callable("user-1", {
    date: DAY, time: "10:00", durationMinutes: 60, intervalDays: 7, endDate: "2026-11-03", comment: "",
  })), /completa/);
  assert.equal([...ctx.db.documents.keys()].filter((key) => key.startsWith("appointments/")).length, 0);
});

test("admin series: only the reduced day is listed for confirmation, with its own capacity", async () => {
  const ctx = setup({ ...exception(NEXT_WEEK, 2), ...hour("10:00", 2, NEXT_WEEK), ...hour("10:00", 3) });
  const data = {
    userId: "user-1", date: DAY, time: "10:00", durationMinutes: 60, serviceType: SERVICE,
    assignedTrainer: "trainer-1", comment: "", intervalDays: 7, endDate: "2026-11-03", requestId: newRequestId(),
  };
  const { error } = await confirm(
    (input) => ctx.series.createRecurringAppointmentsFromAdmin(callable("admin", input)),
    data,
    "admin_override_required",
  );
  assert.deepEqual(error.details.restrictions.map((item) => [item.date, item.maxCapacity]), [[NEXT_WEEK, 2]]);
  assert.equal(count(ctx.db, "10:00", NEXT_WEEK), 3);
  assert.equal(count(ctx.db, "10:00"), 4);
});

test("series approval: each occurrence is checked against its own day's capacity", async () => {
  const occurrence = (index, date) => ({
    ...pending("user-1", { date, time: "10:00" }),
    bonoId: "bono-user-1",
    recurrenceSeriesId: "series-1",
    recurrenceIndex: index,
    minutesRefunded: false,
    minutesRefundedAmount: null,
    minutesRefundReason: null,
  });
  const ctx = setup({
    ...exception(NEXT_WEEK, 2),
    ...hour("10:00", 2, NEXT_WEEK),
    ...hour("10:00", 3),
    "bonos/bono-user-1": { ...bono("user-1"), minutosRestantes: 840 },
    "appointment_recurrences/series-1": {
      userId: "user-1", serviceType: SERVICE, duration: "60", assignedTrainer: null, startDate: DAY,
      startTime: "10:00", intervalDays: 7, endDate: NEXT_WEEK, occurrenceCount: 2, totalMinutes: 120,
      bonoId: "bono-user-1", status: "pending", origin: "customer",
    },
    "appointments/occ-0": occurrence(0, DAY),
    "appointments/occ-1": occurrence(1, NEXT_WEEK),
  });
  const { error } = await confirm(
    (input) => ctx.series.approveRecurringAppointmentSeriesFromAdmin(callable("admin", input)),
    { seriesId: "series-1" },
    "admin_override_required",
  );
  assert.deepEqual(error.details.restrictions.map((item) => [item.date, item.occupancy, item.maxCapacity]), [[NEXT_WEEK, 2, 2]]);
  assert.equal(count(ctx.db, "10:00"), 4);
  assert.equal(count(ctx.db, "10:00", NEXT_WEEK), 3);
});

test("recurring reschedule: added seats are checked against the target day's capacity", () => {
  const occurrences = [DAY, NEXT_WEEK].map((date, index) => ({
    id: `occ-${index}`,
    data: {
      userId: "user-1", status: "approved", duration: "60", recurrenceSeriesId: "series-1", recurrenceIndex: index,
      approvedSlot: { date, time: "10:00" }, preferredSlots: [{ date, time: "10:00" }], date, time: "10:00",
    },
  }));
  const prepared = prepareRecurringReschedule({
    selectedAppointmentId: "occ-1",
    preferredSlot: { date: NEXT_WEEK, time: "12:00" },
    scope: "single",
    actorType: "admin",
    actorUid: "admin",
    now: NOW,
    series: { id: "series-1", userId: "user-1", status: "approved", intervalDays: 7, endDate: NEXT_WEEK, duration: "60" },
    occurrences,
  });
  assert.equal(prepared.ok, true);
  const occupancyByKey = new Map(prepared.draft.occupancyKeys.map((key) => [key, key.includes("12:") ? 2 : 1]));
  const validate = (capacityByDate) => validateRecurringRescheduleAvailability({
    draft: prepared.draft,
    siteConfig: { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 },
    blockedKeys: new Set(),
    occupancyByKey,
    userAppointments: [],
    capacityByDate,
  });
  assert.equal(validate(new Map()).ok, true);
  const refused = validate(new Map([[NEXT_WEEK, 2]]));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.reason, "slot_full");
});

// ------------------------------------------------------------- inventory

test("no booking path compares against the raw global capacity", () => {
  const sourceDir = path.join(__dirname, "../src");
  // Where the global value is defined and resolved against the exceptions.
  const owners = new Set(["siteConfig.ts", "capacityExceptions.ts"]);
  const allowed = new Set(["slotValidation.ts", "recurringAppointments.ts", "recurringReschedule.ts"]);
  for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts") && !owners.has(name))) {
    const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
    const offenders = source.split("\n").filter((line) => /config\.maxCapacity/.test(line));
    if (allowed.has(file)) {
      // Allowed only as the fallback when a date has no exception.
      offenders.forEach((line) => assert.match(line, /\?\? (day\.)?config\.maxCapacity|normalizeMaxCapacity\(config\.maxCapacity\)|`config\.maxCapacity`/, `${file}: ${line.trim()}`));
    } else {
      assert.deepEqual(offenders, [], `${file} must use the effective capacity of the date`);
    }
  }
});
