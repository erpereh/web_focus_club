const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppointmentProposalHandlers } = require("../lib/appointmentProposals.js");
const {
  evaluateSlot,
  getAppointmentType,
  parseAppointmentTypeInput,
} = require("../lib/slotValidation.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");
const { reconcileAppointmentMinutes, validateOwnFutureAppointment } = require("../lib/appointmentLifecycle.js");
const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");
const { createNotificationHandlers } = require("../lib/notifications/handlers.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");
const {
  createFakeEmailClient,
  createFakeFirestore,
  createFakeMessaging,
  customerDocs,
  silenceConsole,
} = require("./helpers/notificationFakes.cjs");

// Monday 5 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-05T08:00:00.000Z");
const REQUESTED = { date: "2026-10-12", time: "10:00" };
const PROPOSED = { date: "2026-10-13", time: "11:00" };

function baseDocuments(overrides = {}) {
  return {
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "users/admin": { role: "admin", email: "admin@example.com", name: "Admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com" },
    "users/user-2": { uid: "user-2", name: "Otro", email: "otro@example.com" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "trainers/nutri-1": { uid: "n1", name: "Nora", active: true, offersNutrition: true },
    "trainers/off-1": { uid: "o1", name: "Off", active: false },
    "bonos/bono-1": {
      userId: "user-1",
      tamano: 480,
      minutosTotales: 480,
      minutosRestantes: 420,
      estado: "activo",
      fechaExpiracion: "2026-12-31T22:59:59.000Z",
      historial: [],
    },
    "appointments/appt-1": {
      userId: "user-1",
      name: "Lucía",
      email: "lucia@example.com",
      serviceType: "Bono Mensual de Entrenamiento",
      duration: "60",
      preferredSlots: [REQUESTED],
      date: REQUESTED.date,
      time: REQUESTED.time,
      reason: "",
      status: "pending",
      bonoId: "bono-1",
      minutesDeducted: true,
      minutesDeductedAmount: 60,
      minutesDeductedAt: "2026-10-01T10:00:00.000Z",
      minutesRefundedAt: null,
      createdAt: "2026-10-01T10:00:00.000Z",
    },
    ...overrides,
  };
}

function handlers(db) {
  return createAppointmentProposalHandlers({
    db,
    getNowDate: () => NOW,
    requireAdmin: async (uid) => {
      const profile = db.doc(`users/${uid}`);
      if (profile?.role !== "admin") {
        const { HttpsError } = require("firebase-functions/v2/https");
        throw new HttpsError("permission-denied", "Permisos insuficientes.", { reason: "not_admin" });
      }
    },
  });
}

function fill(db, slot, duration, count) {
  const [hours, minutes] = slot.time.split(":").map(Number);
  for (let offset = 0; offset < duration; offset += 15) {
    const total = hours * 60 + minutes + offset;
    const time = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    db.documents.set(`slot_occupancy/${slot.date}_${time}`, { date: slot.date, time, count });
  }
}

// ------------------------------------------------------------- validator

test("appointment type: legacy documents are training, payload values are strict", () => {
  assert.equal(getAppointmentType({}), "training");
  assert.equal(getAppointmentType({ appointmentType: "nutrition" }), "nutrition");
  assert.equal(getAppointmentType({ appointmentType: "otro" }), "training");
  assert.equal(parseAppointmentTypeInput(undefined), "training");
  assert.equal(parseAppointmentTypeInput("nutrition"), "nutrition");
  assert.equal(parseAppointmentTypeInput("yoga"), undefined);
});

test("evaluateSlot applies past, schedule, block, capacity, conflict and professional rules", () => {
  const day = {
    config: normalizeSiteConfig({ startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 }),
    blockedTimes: new Set(["12:15"]),
    occupancyByTime: new Map([["16:00", 2], ["17:00", 1]]),
  };
  const base = { durationMinutes: 60, appointmentType: "training", now: NOW, customerAppointments: [] };
  const at = (date, time, extra = {}) => evaluateSlot(day, { ...base, slot: { date, time }, ...extra });

  assert.equal(at("2026-10-05", "09:30"), "slot_not_future", "09:30 Madrid already passed at 10:00 Madrid");
  assert.equal(at("2026-10-05", "10:30"), undefined, "later today in Madrid is still bookable");
  assert.equal(at("2026-10-12", "19:30"), "outside_schedule");
  assert.equal(at("2026-10-12", "12:00"), "slot_blocked");
  assert.equal(at("2026-10-12", "15:30"), "slot_full", "a 60 min session overlapping a full block");
  assert.equal(at("2026-10-12", "17:00"), undefined);
  assert.equal(at("2026-10-12", "16:00", { ownApprovedOccupancyKeys: new Set(["2026-10-12_16:00"]) }), undefined,
    "an approved appointment does not compete with itself");
  assert.equal(at("2026-10-12", "10:00", {
    customerAppointments: [{ id: "a", data: { status: "approved", duration: "30", approvedSlot: { date: "2026-10-12", time: "10:30" } } }],
  }), "appointment_conflict");
  assert.equal(at("2026-10-12", "10:00", {
    customerAppointments: [{ id: "a", data: { status: "approved", duration: "30", approvedSlot: { date: "2026-10-12", time: "10:30" } } }],
    excludeAppointmentIds: ["a"],
  }), undefined);
  assert.equal(at("2026-10-12", "10:00", {
    customerAppointments: [{ id: "a", data: { status: "cancelled", duration: "60", preferredSlots: [{ date: "2026-10-12", time: "10:00" }] } }],
  }), undefined, "cancelled appointments never conflict");
  assert.equal(at("2026-10-12", "10:00", {
    plannedCustomerSlots: [{ slot: { date: "2026-10-12", time: "10:45" }, durationMinutes: 30 }],
  }), "appointment_conflict", "slots planned by the same batch block each other");

  assert.equal(at("2026-10-12", "10:00", { trainer: { id: "x", exists: false } }), "trainer_unavailable");
  assert.equal(at("2026-10-12", "10:00", { trainer: { id: "x", exists: true, active: false } }), "trainer_unavailable");
  // Training trainers may be double-booked (no overlap rule for training).
  assert.equal(at("2026-10-12", "10:00", {
    trainer: { id: "t", exists: true, active: true },
    trainerAppointments: [{ id: "b", data: { status: "approved", duration: "60", assignedTrainer: "t", approvedSlot: { date: "2026-10-12", time: "10:00" } } }],
  }), undefined);

  const nutrition = { ...base, durationMinutes: 30, appointmentType: "nutrition" };
  assert.equal(evaluateSlot(day, { ...nutrition, slot: { date: "2026-10-12", time: "10:00" }, trainer: { id: "t", exists: true, active: true } }),
    "trainer_not_nutrition");
  assert.equal(evaluateSlot(day, {
    ...nutrition,
    slot: { date: "2026-10-12", time: "10:00" },
    trainer: { id: "n", exists: true, active: true, offersNutrition: true },
    trainerAppointments: [{ id: "b", data: { status: "pending", duration: "60", assignedTrainer: "n", preferredSlots: [{ date: "2026-10-12", time: "09:30" }] } }],
  }), "professional_conflict");
  assert.equal(evaluateSlot(day, { ...nutrition, slot: { date: "2026-10-12", time: "16:00" } }), "slot_full",
    "nutrition shares maxCapacity");
});

test("validateOwnFutureAppointment reads slots in Madrid time, not the server clock", () => {
  // 09:30 Madrid on 5 Oct is 07:30 UTC: already past at NOW (08:00 UTC).
  assert.equal(validateOwnFutureAppointment({ userId: "u", status: "pending", date: "2026-10-05", time: "09:30" }, "u", NOW.getTime()), "not-future");
  assert.equal(validateOwnFutureAppointment({ userId: "u", status: "pending", date: "2026-10-05", time: "10:30" }, "u", NOW.getTime()), undefined);
});

// ------------------------------------------------------------- nutrition & minutes

test("nutrition appointments never deduct nor refund bono minutes", () => {
  const writes = [];
  const transaction = { setBono: (...args) => writes.push(args), setAppointment: (...args) => writes.push(args) };
  const bono = { id: "b", estado: "activo", minutosTotales: 240, minutosRestantes: 240 };
  assert.deepEqual(
    reconcileAppointmentMinutes({ action: "deduct", appointment: { appointmentType: "nutrition" }, bono, amount: 30, now: NOW.toISOString(), transaction }),
    { ok: false, reason: "nutrition-no-minutes" },
  );
  assert.deepEqual(
    reconcileAppointmentMinutes({
      action: "refund",
      appointment: { appointmentType: "nutrition", minutesDeducted: true, minutesDeductedAt: "x", minutesDeductedAmount: 30 },
      bono,
      now: NOW.toISOString(),
      transaction,
    }).ok,
    false,
  );
  assert.equal(writes.length, 0);
  assert.equal(
    reconcileAppointmentMinutes({ action: "deduct", appointment: {}, bono, amount: 30, now: NOW.toISOString(), transaction }).ok,
    true,
    "training (legacy, no type) keeps deducting",
  );
});

test("recurring series callables refuse nutrition", async () => {
  const db = new FakeFirestore(baseDocuments());
  const series = createRecurringSeriesHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => NOW,
    appointmentSlotKeys: () => new Set(),
    defaultServiceType: "Entrenamiento",
  });
  await rejectsWithReason(series.createRecurringAppointments(callable("user-1", { appointmentType: "nutrition" })), "nutrition_not_recurring", "invalid-argument");
  await rejectsWithReason(series.createRecurringAppointmentsFromAdmin(callable("admin", { appointmentType: "nutrition" })), "nutrition_not_recurring", "invalid-argument");
});

// ------------------------------------------------------------- proposals

test("admin proposes a valid slot: pending proposal with full traceability", async () => {
  const db = new FakeFirestore(baseDocuments());
  const result = await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", {
    appointmentId: "appt-1",
    slot: PROPOSED,
    assignedTrainer: "trainer-1",
  }));
  assert.equal(result.success, true);
  const appointment = db.doc("appointments/appt-1");
  assert.equal(appointment.status, "pending", "a proposal never confirms the appointment");
  assert.deepEqual(appointment.preferredSlots, [REQUESTED], "the requested slot is kept");
  assert.deepEqual(appointment.proposal.originalSlot, REQUESTED);
  assert.deepEqual(appointment.proposal.proposedSlot, PROPOSED);
  assert.equal(appointment.proposal.proposedTrainer, "trainer-1");
  assert.equal(appointment.proposal.proposedBy, "admin");
  assert.equal(appointment.proposal.proposedAt, NOW.toISOString());
  assert.equal(appointment.proposal.status, "pending");
  assert.equal(appointment.customerConfirmation.kind, "proposal");
  assert.equal(appointment.customerConfirmation.response, null);
  assert.deepEqual(appointment.proposalHistory.map((entry) => entry.event), ["proposed"]);
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("slot_occupancy/")).length, 0,
    "a pending proposal does not take capacity");
});

test("proposing an occupied, blocked or invalid slot fails without writing", async () => {
  const db = new FakeFirestore(baseDocuments({ "blocked_slots/b1": { date: "2026-10-14", time: "10:00" } }));
  fill(db, PROPOSED, 60, 2);
  const before = JSON.stringify(db.doc("appointments/appt-1"));
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED })), "slot_full");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: { date: "2026-10-14", time: "10:00" } })), "slot_blocked");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: { date: "2026-10-14", time: "11:00" }, assignedTrainer: "off-1" })), "trainer_unavailable");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: { date: "2026-10-01", time: "11:00" } })), "slot_not_future");
  assert.equal(JSON.stringify(db.doc("appointments/appt-1")), before);
});

test("only admins can propose, and only on single pending requests", async () => {
  const db = new FakeFirestore(baseDocuments({
    "appointments/approved": { ...baseDocuments()["appointments/appt-1"], status: "approved" },
    "appointments/series": { ...baseDocuments()["appointments/appt-1"], recurrenceSeriesId: "s1" },
  }));
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("user-1", { appointmentId: "appt-1", slot: PROPOSED })), "not_admin", "permission-denied");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "approved", slot: PROPOSED })), "appointment_not_pending");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "series", slot: PROPOSED })), "recurring_not_supported");
});

test("a new proposal supersedes the previous one", async () => {
  const db = new FakeFirestore(baseDocuments());
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED }));
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: { date: "2026-10-14", time: "12:00" } }));
  const appointment = db.doc("appointments/appt-1");
  assert.deepEqual(appointment.proposal.proposedSlot, { date: "2026-10-14", time: "12:00" });
  assert.deepEqual(appointment.proposalHistory.map((entry) => entry.event), ["proposed", "superseded", "proposed"]);
});

test("customer accepts: approved in the proposed slot, occupancy taken, trainer assigned", async () => {
  const db = new FakeFirestore(baseDocuments());
  fill(db, PROPOSED, 60, 1);
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED, assignedTrainer: "trainer-1" }));
  const result = await handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "accept" }));
  assert.equal(result.status, "approved");
  const appointment = db.doc("appointments/appt-1");
  assert.equal(appointment.status, "approved");
  assert.deepEqual(appointment.approvedSlot, PROPOSED);
  assert.equal(appointment.date, PROPOSED.date);
  assert.equal(appointment.assignedTrainer, "trainer-1");
  assert.equal(appointment.approvedBy, "customer_confirmation");
  assert.equal(appointment.proposal.status, "accepted");
  assert.equal(appointment.customerConfirmation.response, "accepted");
  assert.deepEqual(appointment.proposalHistory.map((entry) => entry.event), ["proposed", "accepted"]);
  for (const time of ["11:00", "11:15", "11:30", "11:45"]) {
    assert.equal(db.doc(`slot_occupancy/2026-10-13_${time}`).count, 2);
  }
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420, "minutes were already reserved at request time");
});

test("availability race: the slot filled up after the proposal, acceptance changes nothing", async () => {
  const db = new FakeFirestore(baseDocuments());
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED }));
  fill(db, PROPOSED, 60, 2);
  const before = JSON.stringify(db.doc("appointments/appt-1"));
  const error = await rejectsWithReason(
    handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "accept" })),
    "slot_full",
    "failed-precondition",
  );
  assert.match(error.message, /completado|ya no está disponible/);
  assert.equal(JSON.stringify(db.doc("appointments/appt-1")), before);
  assert.equal(db.doc("slot_occupancy/2026-10-13_11:00").count, 2);
});

test("customer declines: proposal closed, request rejected and minutes refunded once", async () => {
  const db = new FakeFirestore(baseDocuments());
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED }));
  await handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "decline" }));
  const appointment = db.doc("appointments/appt-1");
  assert.equal(appointment.status, "rejected");
  assert.equal(appointment.cancellationReason, "customer_declined_proposal");
  assert.equal(appointment.proposal.status, "declined");
  assert.equal(appointment.customerConfirmation.response, "declined");
  assert.equal(appointment.minutesRefundedAt, NOW.toISOString());
  const bono = db.doc("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 480);
  assert.equal(bono.historial.at(-1).accion, "devolucion_cita");
});

test("responses are idempotent and a second, different answer is refused", async () => {
  const db = new FakeFirestore(baseDocuments());
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED }));
  const respond = (action) => handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action }));
  await respond("accept");
  const occupancy = db.doc("slot_occupancy/2026-10-13_11:00").count;
  const again = await respond("accept");
  assert.equal(again.alreadyApplied, true);
  assert.equal(db.doc("slot_occupancy/2026-10-13_11:00").count, occupancy, "a retry never double-books");
  await rejectsWithReason(respond("decline"), "already_responded");
});

test("permissions: only the verified owner can answer", async () => {
  const db = new FakeFirestore(baseDocuments());
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "appt-1", slot: PROPOSED }));
  await rejectsWithReason(handlers(db).respondToAppointmentConfirmation(callable("user-2", { appointmentId: "appt-1", action: "accept" })), "not_owner", "permission-denied");
  await rejectsWithReason(handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "accept" }, { emailVerified: false })), "email_not_verified", "permission-denied");
  await rejectsWithReason(handlers(db).respondToAppointmentConfirmation(callable(undefined, { appointmentId: "appt-1", action: "accept" })), "unauthenticated");
  await rejectsWithReason(handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "maybe" })), "invalid_action");
  const plain = new FakeFirestore(baseDocuments());
  await rejectsWithReason(handlers(plain).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "appt-1", action: "accept" })), "no_confirmation_pending");
});

test("nutrition proposals require a nutrition professional without overlaps", async () => {
  const nutrition = {
    ...baseDocuments()["appointments/appt-1"],
    appointmentType: "nutrition",
    duration: "30",
    serviceType: "Consulta de nutrición",
    bonoId: undefined,
    minutesDeducted: undefined,
  };
  const db = new FakeFirestore(baseDocuments({
    "appointments/nutri": nutrition,
    "appointments/busy": {
      userId: "user-2", status: "approved", duration: "30", appointmentType: "nutrition",
      assignedTrainer: "nutri-1", approvedSlot: PROPOSED, preferredSlots: [PROPOSED],
    },
  }));
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "nutri", slot: PROPOSED })), "trainer_required");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "nutri", slot: PROPOSED, assignedTrainer: "trainer-1" })), "trainer_not_nutrition");
  await rejectsWithReason(handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "nutri", slot: PROPOSED, assignedTrainer: "nutri-1" })), "professional_conflict");
  await handlers(db).proposeAppointmentSlotFromAdmin(callable("admin", { appointmentId: "nutri", slot: { date: "2026-10-13", time: "12:00" }, assignedTrainer: "nutri-1" }));
  await handlers(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: "nutri", action: "decline" }));
  assert.equal(db.doc("bonos/bono-1").minutosRestantes, 420, "declining nutrition never touches the bono");
});

// ------------------------------------------------------------- notifications

test("proposal notifications: classified once per proposal with history + push + email", async () => {
  const before = { ...baseDocuments()["appointments/appt-1"] };
  const after = {
    ...before,
    proposal: { status: "pending", originalSlot: REQUESTED, proposedSlot: PROPOSED, proposedTrainer: "trainer-1", proposedAt: NOW.toISOString() },
    customerConfirmation: { kind: "proposal", response: null },
  };
  const change = classifyAppointmentChange(before, after, NOW);
  assert.equal(change.event, "appointment_proposed");
  assert.deepEqual(change.previousSlot, REQUESTED);
  assert.equal(classifyAppointmentChange(after, { ...after, updatedAt: "later" }, NOW), null, "unrelated edits do not resend it");
  const declined = classifyAppointmentChange(after, {
    ...after, status: "rejected", cancellationReason: "customer_declined_proposal", proposal: { ...after.proposal, status: "declined" },
  }, NOW);
  assert.equal(declined.event, "appointment_proposal_declined");
  const accepted = classifyAppointmentChange(after, { ...after, status: "approved", approvedSlot: PROPOSED }, NOW);
  assert.equal(accepted.event, "appointment_confirmed");

  const restore = silenceConsole();
  try {
    const { db, documents } = createFakeFirestore({ ...customerDocs("user-1"), "trainers/trainer-1": { name: "Ana" } });
    const messaging = createFakeMessaging();
    const email = createFakeEmailClient();
    const notifications = createNotificationHandlers({ db, messaging, getEmailClient: () => email, nowDate: () => NOW });
    await notifications.onAppointmentWritten({ eventId: "e1", appointmentId: "appt-1", before, after });
    // A duplicated trigger delivery (different event id) for the same proposal.
    await notifications.onAppointmentWritten({ eventId: "e2", appointmentId: "appt-1", before, after });
    const history = [...documents.entries()].filter(([key]) => key.startsWith("users/user-1/notifications/"));
    assert.equal(history.length, 1, "deduplicated per proposal, not per trigger event");
    assert.equal(history[0][1].event, "appointment_proposed");
    assert.match(history[0][1].body, /La hora solicitada no está disponible\. Te proponemos el .*martes, 13 de octubre a las 11:00.*¿Quieres confirmarla\?/);
    assert.equal(history[0][1].navigation.route, "appointment");
    assert.equal(messaging.calls.length, 1);
    assert.equal(email.calls.length, 1);
    assert.match(email.calls[0].message.html, /Hora solicitada/);
  } finally {
    restore();
  }
});
