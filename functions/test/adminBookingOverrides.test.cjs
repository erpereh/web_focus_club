const assert = require("node:assert/strict");
const test = require("node:test");

const { createAdminAppointmentCreateHandlers } = require("../lib/adminAppointmentCreate.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { collectAdminSlotRestrictions, restrictionsFingerprint } = require("../lib/adminBookingOverrides.js");
const { appointmentOccupancyKeys } = require("../lib/slotOccupancy.js");
const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");
const { planAppointmentReminders } = require("../lib/notifications/schedules.js");
const { buildCalendarEventPayload } = require("../lib/googleCalendarSync.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Wednesday 14 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-14T08:00:00.000Z");
const DAY = "2026-10-20";
const SERVICE = "Bono Mensual de Entrenamiento";

function occupancy(time, count, date = DAY) {
  return { [`slot_occupancy/${date}_${time}`]: { date, time, count } };
}

/** Full 60-min session at `time` (four 15-min blocks). */
function fullHour(time, date = DAY, count = 2) {
  const [hours] = time.split(":");
  return Object.assign({}, ...["00", "15", "30", "45"].map((minutes) => occupancy(`${hours}:${minutes}`, count, date)));
}

function baseDocuments(extra = {}) {
  return {
    "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2 },
    "users/admin": { role: "admin", email: "admin@example.com", name: "Admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "trainers/nutri-1": { uid: "n1", name: "Nora", active: true, offersNutrition: true },
    "services/svc-1": { title: SERVICE, active: true },
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

function setup(extra = {}, now = NOW) {
  const db = new FakeFirestore(baseDocuments(extra));
  const emails = [];
  const deps = {
    db,
    requireAdmin: async (uid) => {
      if (uid !== "admin") throw new Error("not admin");
    },
    getNowDate: () => now,
  };
  const single = createAdminAppointmentCreateHandlers({
    ...deps,
    notifyAdmin: async (appointmentId) => { emails.push(appointmentId); },
  });
  const series = createRecurringSeriesHandlers({
    ...deps,
    appointmentSlotKeys: (appointment) => new Set(appointmentOccupancyKeys(appointment)),
    defaultServiceType: SERVICE,
  });
  return { db, single, series, emails };
}

let requestCounter = 0;
const newRequestId = () => `test-request-${++requestCounter}`;

function singleInput(extra = {}) {
  return {
    userId: "user-1",
    date: DAY,
    time: "10:00",
    durationMinutes: 60,
    serviceType: SERVICE,
    assignedTrainer: "trainer-1",
    status: "approved",
    comment: "",
    requestId: newRequestId(),
    ...extra,
  };
}

function seriesInput(extra = {}) {
  return {
    userId: "user-1",
    date: DAY,
    time: "10:00",
    durationMinutes: 60,
    serviceType: SERVICE,
    assignedTrainer: "trainer-1",
    comment: "",
    intervalDays: 7,
    endDate: "2026-11-03",
    requestId: newRequestId(),
    ...extra,
  };
}

const createSingle = (ctx, data) => ctx.single.createAppointmentFromAdmin(callable("admin", data));
const createSeries = (ctx, data) => ctx.series.createRecurringAppointmentsFromAdmin(callable("admin", data));

function docs(db, prefix) {
  return [...db.documents].filter(([path]) => path.startsWith(`${prefix}/`)).map(([path, data]) => ({ path, data }));
}

function logs(db, action) {
  return docs(db, "activity_logs").filter(({ data }) => data.action === action);
}

function count(db, time, date = DAY) {
  return db.doc(`slot_occupancy/${date}_${time}`)?.count ?? 0;
}

/** First call → popup details; second call with the fingerprint (and past confirmation). */
async function confirmAfterPrompt(create, ctx, data, { confirmPastDate = false } = {}) {
  const error = await rejectsWithReason(create(ctx, data), "admin_override_required", "failed-precondition");
  return create(ctx, { ...data, acknowledgedRestrictions: error.details.fingerprint, confirmPastDate });
}

// ------------------------------------------------------------ single appointment

test("a slot without restrictions is created directly and audited once", async () => {
  const ctx = setup();
  const result = await createSingle(ctx, singleInput());
  assert.equal(result.success, true);
  const stored = ctx.db.doc(`appointments/${result.appointmentId}`);
  assert.equal(stored.status, "approved");
  assert.equal(stored.adminOverride, undefined);
  assert.equal(count(ctx.db, "10:00"), 1);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 360);
  assert.equal(logs(ctx.db, "appointment_created_by_admin").length, 1);
  assert.equal(logs(ctx.db, "appointment_created_with_admin_override").length, 0);
  assert.deepEqual(ctx.emails, [result.appointmentId]);
});

test("every admin creation needs a request id", async () => {
  const ctx = setup();
  await rejectsWithReason(createSingle(ctx, singleInput({ requestId: undefined })), "invalid_request_id", "invalid-argument");
  await rejectsWithReason(createSeries(ctx, seriesInput({ requestId: "x" })), "invalid_request_id", "invalid-argument");
  assert.equal(docs(ctx.db, "appointments").length, 0);
});

test("a full slot asks for confirmation with occupancy and capacity, writing nothing", async () => {
  const ctx = setup(fullHour("10:00"));
  const error = await rejectsWithReason(createSingle(ctx, singleInput()), "admin_override_required", "failed-precondition");
  assert.deepEqual(error.details.restrictions, [{ date: DAY, time: "10:00", reason: "slot_full", occupancy: 2, maxCapacity: 2 }]);
  assert.equal(error.details.changed, false);
  assert.equal(error.details.requiresPastConfirmation, false);
  assert.equal(docs(ctx.db, "appointments").length, 0);
  assert.equal(docs(ctx.db, "admin_booking_requests").length, 0);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 420);
});

test("confirming a full slot creates it over capacity and records who authorized what", async () => {
  const ctx = setup(fullHour("10:00"));
  const result = await confirmAfterPrompt(createSingle, ctx, singleInput());
  const stored = ctx.db.doc(`appointments/${result.appointmentId}`);
  assert.equal(stored.adminOverride.authorizedByUid, "admin");
  assert.equal(stored.adminOverride.authorizedByEmail, "admin@example.com");
  assert.equal(stored.adminOverride.authorizedAt, NOW.toISOString());
  assert.deepEqual(stored.adminOverride.restrictions.map((item) => item.reason), ["slot_full"]);
  assert.equal(stored.adminOverride.pastDateConfirmed, false);
  assert.equal(count(ctx.db, "10:00"), 3);
  assert.equal(count(ctx.db, "10:45"), 3);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 360);
  const [log] = logs(ctx.db, "appointment_created_with_admin_override");
  assert.equal(log.data.adminUid, "admin");
  assert.equal(log.data.appointmentId, result.appointmentId);
  assert.deepEqual(result.overriddenRestrictions.map((item) => item.reason), ["slot_full"]);
});

test("blocked, off-schedule and short-notice restrictions are all listed together", async () => {
  const ctx = setup({
    "site_config/main": { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2, minBookingNoticeHours: 4, blockSameDayBooking: true },
    "blocked_slots/b1": { date: "2026-10-14", time: "21:30" },
  });
  const data = singleInput({ date: "2026-10-14", time: "21:30" });
  const error = await rejectsWithReason(createSingle(ctx, data), "admin_override_required");
  assert.deepEqual(error.details.restrictions.map((item) => item.reason).sort(), [
    "outside_schedule",
    "same_day_booking_disabled",
    "slot_blocked",
  ]);
  const notice = await rejectsWithReason(createSingle(ctx, singleInput({ date: "2026-10-14", time: "12:00" })), "admin_override_required");
  assert.deepEqual(notice.details.restrictions.map((item) => item.reason).sort(), ["booking_notice_too_short", "same_day_booking_disabled"]);
  const created = await createSingle(ctx, { ...data, acknowledgedRestrictions: error.details.fingerprint });
  assert.ok(ctx.db.doc(`appointments/${created.appointmentId}`).adminOverride);
});

test("a manual time outside opening hours is accepted only after confirmation", async () => {
  const ctx = setup();
  const result = await confirmAfterPrompt(createSingle, ctx, singleInput({ time: "06:00" }));
  assert.deepEqual(ctx.db.doc(`appointments/${result.appointmentId}`).adminOverride.restrictions.map((item) => item.reason), ["outside_schedule"]);
  await assert.rejects(createSingle(ctx, singleInput({ time: "06:07" })), /formato/);
  await assert.rejects(createSingle(ctx, singleInput({ time: "23:30" })), /formato/);
});

test("if conditions change after the popup, the new list must be confirmed again", async () => {
  const ctx = setup(fullHour("10:00"));
  const data = singleInput();
  const first = await rejectsWithReason(createSingle(ctx, data), "admin_override_required");
  // Someone blocks the slot meanwhile.
  await ctx.db.collection("blocked_slots").doc("b1").set({ date: DAY, time: "10:15" });
  const second = await rejectsWithReason(
    createSingle(ctx, { ...data, acknowledgedRestrictions: first.details.fingerprint }),
    "admin_override_required",
  );
  assert.equal(second.details.changed, true);
  assert.deepEqual(second.details.restrictions.map((item) => item.reason).sort(), ["slot_blocked", "slot_full"]);
  assert.equal(docs(ctx.db, "appointments").length, 0);
  const created = await createSingle(ctx, { ...data, acknowledgedRestrictions: second.details.fingerprint });
  assert.ok(created.appointmentId);
});

test("past dates need the extra explicit confirmation and never notify anyone", async () => {
  const ctx = setup();
  const data = singleInput({ date: "2026-10-13", time: "18:00" });
  const prompt = await rejectsWithReason(createSingle(ctx, data), "admin_override_required");
  assert.equal(prompt.details.requiresPastConfirmation, true);
  const withoutPast = await rejectsWithReason(
    createSingle(ctx, { ...data, acknowledgedRestrictions: prompt.details.fingerprint }),
    "admin_override_required",
  );
  assert.equal(withoutPast.details.changed, false);
  assert.match(withoutPast.message, /fecha pasada/);
  assert.equal(docs(ctx.db, "appointments").length, 0);

  const result = await createSingle(ctx, { ...data, acknowledgedRestrictions: prompt.details.fingerprint, confirmPastDate: true });
  const stored = ctx.db.doc(`appointments/${result.appointmentId}`);
  assert.equal(stored.adminOverride.pastDateConfirmed, true);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 360);
  assert.deepEqual(ctx.emails, [], "no admin email for a retroactive appointment");
  assert.equal(classifyAppointmentChange(undefined, stored, NOW), null, "no customer notice for a retroactive appointment");
  assert.deepEqual(planAppointmentReminders([{ id: result.appointmentId, data: stored }], NOW), []);
  assert.ok(buildCalendarEventPayload({ appointmentId: result.appointmentId, appointment: stored, client: {}, trainerName: "Ana" }),
    "the internal calendar still records the session");
});

test("upcoming creations keep notifying the customer", () => {
  const appointment = { userId: "user-1", status: "approved", approvedSlot: { date: DAY, time: "10:00" }, duration: "60" };
  assert.equal(classifyAppointmentChange(undefined, appointment, NOW).event, "appointment_confirmed");
});

test("restrictions can only be authorized on approved appointments", async () => {
  const ctx = setup(fullHour("10:00"));
  const error = await rejectsWithReason(createSingle(ctx, singleInput({ status: "pending" })), "override_requires_approved", "failed-precondition");
  assert.match(error.message, /aforo completo/);
  assert.equal(docs(ctx.db, "appointments").length, 0);
});

test("customer duplicates and professional conflicts stay hard errors even in a restricted slot", async () => {
  const ctx = setup({
    ...fullHour("10:00"),
    "appointments/own": {
      userId: "user-1", status: "approved", duration: "30",
      preferredSlots: [{ date: DAY, time: "10:30" }], approvedSlot: { date: DAY, time: "10:30" },
    },
    "appointments/nutri": {
      userId: "user-9", status: "approved", duration: "30", appointmentType: "nutrition", assignedTrainer: "nutri-1",
      preferredSlots: [{ date: DAY, time: "12:00" }], approvedSlot: { date: DAY, time: "12:00" },
    },
  });
  await rejectsWithReason(createSingle(ctx, singleInput()), "appointment_conflict");
  await rejectsWithReason(createSingle(ctx, singleInput({
    time: "12:00", durationMinutes: 30, appointmentType: "nutrition", assignedTrainer: "nutri-1",
  })), "professional_conflict");
});

test("a corrupt counter is never overridable", async () => {
  const ctx = setup(occupancy("10:15", -1));
  await rejectsWithReason(createSingle(ctx, singleInput()), "invalid_occupancy");
});

test("repeating a request (double click, retry) creates one appointment and debits once", async () => {
  const ctx = setup(fullHour("10:00"));
  const data = singleInput();
  const first = await confirmAfterPrompt(createSingle, ctx, data);
  // Same request again: even though the slot is now 3/2, the stored result is returned.
  const again = await createSingle(ctx, { ...data, acknowledgedRestrictions: "anything" });
  assert.equal(again.appointmentId, first.appointmentId);
  assert.equal(again.replayed, true);
  assert.equal(docs(ctx.db, "appointments").length, 1);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 360);
  assert.equal(count(ctx.db, "10:00"), 3);
  assert.equal(logs(ctx.db, "appointment_created_by_admin").length, 1);
});

test("two simultaneous submissions of the same request create a single appointment", async () => {
  const ctx = setup();
  const data = singleInput();
  const results = await Promise.all([createSingle(ctx, data), createSingle(ctx, data)]);
  assert.equal(results[0].appointmentId, results[1].appointmentId);
  assert.equal(docs(ctx.db, "appointments").length, 1);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 360);
  assert.equal(ctx.emails.length, 1);
});

test("a request id reused with different data is refused", async () => {
  const ctx = setup();
  const data = singleInput();
  await createSingle(ctx, data);
  await rejectsWithReason(createSingle(ctx, { ...data, time: "12:00" }), "request_id_reused");
  assert.equal(docs(ctx.db, "appointments").length, 1);
});

// ------------------------------------------------------------ recurring series

test("a series without restrictions is created as before", async () => {
  const ctx = setup();
  const result = await createSeries(ctx, seriesInput());
  assert.equal(result.occurrenceCount, 3);
  assert.equal(result.overriddenRestrictions, undefined);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 240);
  assert.equal(docs(ctx.db, "notification_outbox").length, 1);
});

test("a series lists every affected date with its reasons and creates all after confirmation", async () => {
  const ctx = setup({
    ...fullHour("10:00", "2026-10-20"),
    "blocked_slots/b1": { date: "2026-11-03", time: "10:30" },
  });
  const data = seriesInput();
  const prompt = await rejectsWithReason(createSeries(ctx, data), "admin_override_required");
  assert.deepEqual(prompt.details.restrictions.map((item) => `${item.date} ${item.reason}`), [
    "2026-10-20 slot_full",
    "2026-11-03 slot_blocked",
  ]);
  assert.equal(docs(ctx.db, "appointments").length, 0);

  const result = await createSeries(ctx, { ...data, acknowledgedRestrictions: prompt.details.fingerprint });
  assert.equal(result.occurrenceCount, 3);
  const appointments = docs(ctx.db, "appointments");
  assert.equal(appointments.length, 3);
  appointments.forEach(({ data: appointment }) => assert.equal(appointment.adminOverride.authorizedByUid, "admin"));
  assert.ok(ctx.db.doc(`appointment_recurrences/${result.seriesId}`).adminOverride);
  assert.equal(count(ctx.db, "10:00", "2026-10-20"), 3);
  assert.equal(count(ctx.db, "10:30", "2026-11-03"), 1);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 240);
  assert.equal(logs(ctx.db, "recurring_appointments_created_with_admin_override").length, 1);
});

test("a series never overrides bono problems: nothing is created", async () => {
  const ctx = setup({
    ...fullHour("10:00", "2026-10-20"),
    "bonos/bono-1": { userId: "user-1", minutosTotales: 480, minutosRestantes: 120, estado: "activo", fechaExpiracion: "2026-12-31T22:59:59.000Z", historial: [] },
  });
  await assert.rejects(
    createSeries(ctx, seriesInput({ acknowledgedRestrictions: "2026-10-20|10:00|slot_full|2|2" })),
    /No hay suficientes minutos/,
  );
  assert.equal(docs(ctx.db, "appointments").length, 0);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 120);
});

test("a series overlapping the customer's own appointment stays refused", async () => {
  const ctx = setup({
    "appointments/own": {
      userId: "user-1", status: "approved", duration: "60",
      preferredSlots: [{ date: "2026-10-27", time: "10:00" }], approvedSlot: { date: "2026-10-27", time: "10:00" },
    },
  });
  await assert.rejects(createSeries(ctx, seriesInput()), /se solapa/);
  assert.equal(docs(ctx.db, "appointments").length, 1);
});

test("a series with past sessions requires the past confirmation and only notifies upcoming sessions", async () => {
  const ctx = setup();
  const data = seriesInput({ date: "2026-10-07", endDate: "2026-10-21" });
  const result = await confirmAfterPrompt(createSeries, ctx, data, { confirmPastDate: true });
  assert.equal(result.occurrenceCount, 3);
  const [outbox] = docs(ctx.db, "notification_outbox");
  assert.deepEqual(outbox.data.sessions.map((session) => session.date), ["2026-10-21"]);
  assert.equal(outbox.data.appointmentIds.length, 1);
});

test("a fully retroactive series writes no customer notification at all", async () => {
  const ctx = setup();
  await confirmAfterPrompt(createSeries, ctx, seriesInput({ date: "2026-09-30", endDate: "2026-10-07" }), { confirmPastDate: true });
  assert.equal(docs(ctx.db, "appointments").length, 2);
  assert.equal(docs(ctx.db, "notification_outbox").length, 0);
});

test("repeating a series request never creates a second series or debits twice", async () => {
  const ctx = setup();
  const data = seriesInput();
  const first = await createSeries(ctx, data);
  const again = await createSeries(ctx, data);
  assert.equal(again.seriesId, first.seriesId);
  assert.equal(again.replayed, true);
  assert.equal(docs(ctx.db, "appointment_recurrences").length, 1);
  assert.equal(docs(ctx.db, "appointments").length, 3);
  assert.equal(ctx.db.doc("bonos/bono-1").minutosRestantes, 240);
});

test("customer series keep their strict rules (no override path)", async () => {
  const ctx = setup(fullHour("10:00", "2026-10-20"));
  await assert.rejects(
    ctx.series.createRecurringAppointments(callable("user-1", {
      date: DAY, time: "10:00", durationMinutes: 60, intervalDays: 7, endDate: "2026-10-27",
      acknowledgedRestrictions: "2026-10-20|10:00|slot_full|2|2",
    })),
    /completa/,
  );
  assert.equal(docs(ctx.db, "appointments").length, 0);
});

// ------------------------------------------------------------ pure helpers

test("restriction collection reports all reasons and a stable fingerprint", () => {
  const config = normalizeSiteConfig({ startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2 });
  const day = {
    config,
    blockedTimes: new Set(["21:45"]),
    occupancyByTime: new Map([["21:30", 2]]),
  };
  const { restrictions, hard } = collectAdminSlotRestrictions(day, {
    slot: { date: DAY, time: "21:30" },
    durationMinutes: 60,
    now: NOW,
  });
  assert.equal(hard, undefined);
  assert.deepEqual(restrictions.map((item) => item.reason), ["outside_schedule", "slot_blocked", "slot_full"]);
  assert.equal(restrictionsFingerprint(restrictions), restrictionsFingerprint([...restrictions].reverse()));
});
