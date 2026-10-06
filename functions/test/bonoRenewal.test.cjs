const assert = require("node:assert/strict");
const test = require("node:test");

const { createBonoRenewalHandlers, renewalAppointmentId } = require("../lib/bonoRenewal.js");
const { planRenewalCandidates } = require("../lib/bonoRenewalPlanning.js");
const { createAppointmentProposalHandlers } = require("../lib/appointmentProposals.js");
const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Monday 5 Oct 2026, 10:00 in Madrid.
const NOW = new Date("2026-10-05T08:00:00.000Z");

function occurrence(seriesId, index, slot, duration, trainer) {
  return {
    userId: "user-1",
    name: "Lucía",
    email: "lucia@example.com",
    serviceType: "Bono Mensual de Entrenamiento",
    sessionType: "Entrenamiento personal",
    duration: String(duration),
    preferredSlots: [slot],
    approvedSlot: slot,
    status: "approved",
    assignedTrainer: trainer,
    recurrenceSeriesId: seriesId,
    recurrenceIndex: index,
    bonoId: "bono-old",
  };
}

function fixture(overrides = {}) {
  return {
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "users/admin": { role: "admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com", phone: "600" },
    "trainers/trainer-1": { uid: "t1", name: "Ana", active: true },
    "bonos/bono-old": { userId: "user-1", tamano: 480, minutosRestantes: 0, estado: "agotado", fechaExpiracion: "2026-10-08T21:59:59.000Z" },
    "bonos/bono-new": {
      userId: "user-1",
      tamano: 360,
      minutosTotales: 360,
      minutosRestantes: 360,
      estado: "activo",
      fechaAsignacion: "2026-10-08T22:00:00.000Z",
      fechaExpiracion: "2026-11-08T22:59:59.000Z",
      historial: [],
    },
    // Weekly Thursday 18:00, 60 min with Ana.
    "appointment_recurrences/s-weekly": {
      userId: "user-1", bonoId: "bono-old", status: "approved", intervalDays: 7, duration: "60",
      serviceType: "Bono Mensual de Entrenamiento", assignedTrainer: "trainer-1",
    },
    "appointments/w1": occurrence("s-weekly", 0, { date: "2026-10-01", time: "18:00" }, 60, "trainer-1"),
    "appointments/w2": occurrence("s-weekly", 1, { date: "2026-10-08", time: "18:00" }, 60, "trainer-1"),
    // Every 14 days, Tuesday 09:00, 45 min, no trainer. The last one was rescheduled to 09:30.
    "appointment_recurrences/s-biweekly": {
      userId: "user-1", bonoId: "bono-old", status: "approved", intervalDays: 14, duration: "45",
      serviceType: "Bono Mensual de Entrenamiento", assignedTrainer: null,
    },
    "appointments/b1": occurrence("s-biweekly", 0, { date: "2026-09-22", time: "09:00" }, 45, null),
    "appointments/b2": occurrence("s-biweekly", 1, { date: "2026-10-06", time: "09:30" }, 45, null),
    // Not approved: never renewed.
    "appointment_recurrences/s-cancelled": {
      userId: "user-1", bonoId: "bono-old", status: "cancelled", intervalDays: 7, duration: "60",
    },
    ...overrides,
  };
}

function handlers(db) {
  return createBonoRenewalHandlers({ db, getNowDate: () => NOW, requireAdmin: async () => ({}) });
}

function confirmations(db) {
  return createAppointmentProposalHandlers({ db, getNowDate: () => NOW, requireAdmin: async () => ({}) });
}

function fill(db, date, time, duration, count) {
  const [hours, minutes] = time.split(":").map(Number);
  for (let offset = 0; offset < duration; offset += 15) {
    const total = hours * 60 + minutes + offset;
    const block = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    db.documents.set(`slot_occupancy/${date}_${block}`, { date, time: block, count });
  }
}

const PREVIEW_INPUT = {
  userId: "user-1",
  sourceBonoId: "bono-old",
  periodStart: "2026-10-09",
  periodEnd: "2026-11-08",
  availableMinutes: 360,
};

function byKey(items) {
  return Object.fromEntries(items.map((item) => [item.key, item]));
}

test("planning continues each series cadence inside the new period", () => {
  const candidates = planRenewalCandidates([
    { seriesId: "w", intervalDays: 7, durationMinutes: 60, serviceType: "", sessionType: "", trainerId: "t", lastSlot: { date: "2026-10-08", time: "18:00" } },
    { seriesId: "b", intervalDays: 14, durationMinutes: 45, serviceType: "", sessionType: "", trainerId: null, lastSlot: { date: "2026-10-06", time: "09:30" } },
  ], "2026-10-09", "2026-11-08", "2026-10-06");
  assert.deepEqual(candidates.map((item) => `${item.slot.date} ${item.slot.time}`), [
    "2026-10-15 18:00",
    "2026-10-20 09:30",
    "2026-10-22 18:00",
    "2026-10-29 18:00",
    "2026-11-03 09:30",
    "2026-11-05 18:00",
  ]);
  assert.ok(candidates.every((item) => new Date(`${item.slot.date}T12:00:00Z`).getUTCDay()
    === (item.sourceSeriesId === "w" ? 4 : 2)), "weekdays are preserved");
  assert.equal(planRenewalCandidates([
    { seriesId: "w", intervalDays: 7, durationMinutes: 60, serviceType: "", sessionType: "", trainerId: null, lastSlot: { date: "2026-10-08", time: "18:00" } },
  ], "2026-10-01", "2026-10-20", "2026-10-16").length, 0, "nothing before tomorrow nor after the period end");
});

test("preview builds the plan from approved series and flags every conflict with its reason", async () => {
  const db = new FakeFirestore(fixture({
    "blocked_slots/x": { date: "2026-10-22", time: "18:15" },
    // The customer already has a session overlapping the 3 Nov renewal.
    "appointments/existing": {
      userId: "user-1", status: "pending", duration: "60",
      preferredSlots: [{ date: "2026-11-03", time: "09:00" }],
    },
  }));
  fill(db, "2026-10-29", "18:00", 60, 2);
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", { ...PREVIEW_INPUT, availableMinutes: 300 }));
  const items = byKey(preview.items);
  assert.equal(preview.items.length, 6);
  assert.equal(items["s-weekly:2026-10-15"].status, "ready");
  assert.equal(items["s-weekly:2026-10-15"].trainerId, "trainer-1");
  assert.equal(items["s-weekly:2026-10-15"].trainerName, "Ana");
  assert.equal(items["s-weekly:2026-10-15"].durationMinutes, 60);
  assert.equal(items["s-biweekly:2026-10-20"].status, "ready");
  assert.deepEqual(items["s-biweekly:2026-10-20"].slot, { date: "2026-10-20", time: "09:30" }, "rescheduled time is the reference");
  assert.equal(items["s-weekly:2026-10-22"].reason, "slot_blocked");
  assert.equal(items["s-weekly:2026-10-29"].reason, "slot_full");
  assert.equal(items["s-biweekly:2026-11-03"].reason, "appointment_conflict", "never duplicates an existing appointment");
  assert.equal(items["s-weekly:2026-11-05"].reason, "insufficient_minutes", "60+45+60+60+45 = 270, the next 60 exceeds 300");
  assert.equal(db.writes.length, 0, "preview never writes");
});

test("preview revalidates a manual date/time change before marking it ready", async () => {
  const db = new FakeFirestore(fixture({ "blocked_slots/x": { date: "2026-10-22", time: "18:15" } }));
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", PREVIEW_INPUT));
  const items = preview.items.map((item) => item.key === "s-weekly:2026-10-22"
    ? { ...item, slot: { date: "2026-10-23", time: "18:00" } }
    : item);
  const revalidated = byKey((await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", { ...PREVIEW_INPUT, items }))).items);
  assert.equal(revalidated["s-weekly:2026-10-22"].status, "ready");
  assert.equal(revalidated["s-weekly:2026-10-22"].modified, true);
  assert.deepEqual(revalidated["s-weekly:2026-10-22"].originalSlot, { date: "2026-10-22", time: "18:00" });

  const clash = items.map((item) => item.key === "s-weekly:2026-10-22"
    ? { ...item, slot: { date: "2026-10-20", time: "09:30" } }
    : item);
  const clashing = byKey((await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", { ...PREVIEW_INPUT, items: clash }))).items);
  assert.equal(clashing["s-weekly:2026-10-22"].reason, "appointment_conflict", "cannot collide with another renewed appointment");
});

test("commit creates pending appointments awaiting the customer, reserving minutes once", async () => {
  const db = new FakeFirestore(fixture());
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", PREVIEW_INPUT));
  const ready = preview.items.filter((item) => item.status === "ready");
  const toCreate = ready.filter((item) => item.key !== "s-weekly:2026-11-05");
  const skipped = [{ key: "s-weekly:2026-11-05", originalSlot: { date: "2026-11-05", time: "18:00" }, reason: "skipped_by_admin" }];
  const result = await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", {
    renewalId: "renewal-0001",
    userId: "user-1",
    bonoId: "bono-new",
    sourceBonoId: "bono-old",
    items: toCreate,
    skipped,
  }));
  assert.equal(result.created.length, 5);
  assert.equal(result.conflicts.length, 0);

  const createdId = renewalAppointmentId("renewal-0001", "s-weekly:2026-10-15");
  const appointment = db.doc(`appointments/${createdId}`);
  assert.equal(appointment.status, "pending", "renewed appointments are never auto-approved");
  assert.equal(appointment.customerConfirmation.kind, "renewal");
  assert.equal(appointment.customerConfirmation.renewalId, "renewal-0001");
  assert.equal(appointment.customerConfirmation.response, null);
  assert.equal(appointment.appointmentType, "training");
  assert.equal(appointment.assignedTrainer, "trainer-1");
  assert.equal(appointment.bonoId, "bono-new");
  assert.equal(appointment.minutesDeducted, true);
  assert.equal(appointment.renewalSourceSeriesId, "s-weekly");
  assert.equal(appointment.recurrenceSeriesId, undefined, "renewed appointments are standalone");
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("slot_occupancy/")).length, 0,
    "pending renewals do not take capacity");

  const bono = db.doc("bonos/bono-new");
  assert.equal(bono.minutosRestantes, 360 - (60 + 45 + 60 + 60 + 45));
  assert.equal(bono.historial.length, 5);
  assert.ok(bono.historial.every((entry) => entry.accion === "descuento_cita"));

  const renewal = db.doc("bono_renewals/renewal-0001");
  assert.equal(renewal.created.length, 5);
  assert.deepEqual(renewal.skipped, skipped);
  assert.equal(renewal.status, "completed");

  const outbox = [...db.documents.entries()].filter(([key]) => key.startsWith("notification_outbox/"));
  assert.equal(outbox.length, 1, "one grouped notice for the whole renewal");
  assert.equal(outbox[0][1].event, "appointment_series_renewal_pending");
  assert.equal(outbox[0][1].appointmentIds.length, 5);
  assert.equal(appointment.notificationOperationId, outbox[0][0].split("/")[1]);
  assert.equal(classifyAppointmentChange(undefined, appointment, NOW), null, "no per-appointment notice on creation");
});

test("retrying the same renewal never duplicates appointments nor minutes", async () => {
  const db = new FakeFirestore(fixture());
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", PREVIEW_INPUT));
  const input = {
    renewalId: "renewal-0002",
    userId: "user-1",
    bonoId: "bono-new",
    sourceBonoId: "bono-old",
    items: preview.items.filter((item) => item.status === "ready"),
  };
  await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", input));
  const minutes = db.doc("bonos/bono-new").minutosRestantes;
  const appointments = [...db.documents.keys()].filter((key) => key.startsWith("appointments/renewal_")).length;

  const retry = await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", input));
  assert.equal(retry.created.length, 0);
  assert.equal(retry.alreadyCreated.length, input.items.length);
  assert.equal(db.doc("bonos/bono-new").minutosRestantes, minutes);
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("appointments/renewal_")).length, appointments);
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("notification_outbox/")).length, 1);
});

test("a slot taken between preview and commit comes back as a conflict to resolve", async () => {
  const db = new FakeFirestore(fixture());
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", PREVIEW_INPUT));
  fill(db, "2026-10-15", "18:00", 60, 2);
  const input = {
    renewalId: "renewal-0003",
    userId: "user-1",
    bonoId: "bono-new",
    sourceBonoId: "bono-old",
    items: preview.items.filter((item) => item.status === "ready"),
  };
  const result = await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", input));
  assert.deepEqual(result.conflicts.map((item) => [item.key, item.reason]), [["s-weekly:2026-10-15", "slot_full"]]);
  assert.equal(db.doc(`appointments/${renewalAppointmentId("renewal-0003", "s-weekly:2026-10-15")}`), undefined);
  assert.equal(db.doc("bono_renewals/renewal-0003").status, "has_conflicts");

  // The admin moves it and retries with the same renewal id: only that one is created.
  const fixed = { ...result.conflicts[0], slot: { date: "2026-10-16", time: "18:00" }, modified: true };
  const retry = await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", { ...input, items: [fixed] }));
  assert.equal(retry.created.length, 1);
  assert.equal(retry.created[0].modified, true);
  const created = db.doc(`appointments/${retry.created[0].appointmentId}`);
  assert.deepEqual(created.preferredSlots, [{ date: "2026-10-16", time: "18:00" }]);
  assert.deepEqual(created.renewalOriginalSlot, { date: "2026-10-15", time: "18:00" });
  assert.equal(created.renewalModified, true);
  assert.equal(db.doc("bono_renewals/renewal-0003").created.length, 6);
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith("notification_outbox/")).length, 2,
    "the retry notifies only the newly created appointment");
});

test("commit refuses an inactive bono, a foreign renewal id and bad items", async () => {
  const db = new FakeFirestore(fixture({ "bonos/bono-new": { ...fixture()["bonos/bono-new"], estado: "expirado" } }));
  const base = { renewalId: "renewal-0004", userId: "user-1", bonoId: "bono-new", sourceBonoId: "bono-old", items: [] };
  await rejectsWithReason(handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", base)), "bono_not_active");
  await rejectsWithReason(handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", { ...base, renewalId: "x" })), "invalid_request");
  await rejectsWithReason(handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", {
    ...base,
    items: [{ key: "k", sourceSeriesId: "s", slot: { date: "2026-10-15", time: "18:00" }, originalSlot: { date: "2026-10-15", time: "18:00" }, durationMinutes: 50 }],
  })), "invalid_items");
  await rejectsWithReason(handlers(db).commitBonoAppointmentRenewalFromAdmin(callable(undefined, base)), "unauthenticated");
});

test("the customer confirms or declines each renewed appointment", async () => {
  const db = new FakeFirestore(fixture());
  const preview = await handlers(db).previewBonoAppointmentRenewalFromAdmin(callable("admin", PREVIEW_INPUT));
  await handlers(db).commitBonoAppointmentRenewalFromAdmin(callable("admin", {
    renewalId: "renewal-0005",
    userId: "user-1",
    bonoId: "bono-new",
    sourceBonoId: "bono-old",
    items: preview.items.filter((item) => item.status === "ready"),
  }));
  const first = renewalAppointmentId("renewal-0005", "s-weekly:2026-10-15");
  const second = renewalAppointmentId("renewal-0005", "s-biweekly:2026-10-20");
  const minutesBefore = db.doc("bonos/bono-new").minutosRestantes;

  await confirmations(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: first, action: "accept" }));
  const accepted = db.doc(`appointments/${first}`);
  assert.equal(accepted.status, "approved");
  assert.deepEqual(accepted.approvedSlot, { date: "2026-10-15", time: "18:00" });
  assert.equal(accepted.assignedTrainer, "trainer-1");
  assert.equal(db.doc("slot_occupancy/2026-10-15_18:45").count, 1);
  assert.equal(db.doc("bonos/bono-new").minutosRestantes, minutesBefore, "minutes were reserved at creation");

  await confirmations(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: second, action: "decline" }));
  const declined = db.doc(`appointments/${second}`);
  assert.equal(declined.status, "cancelled");
  assert.equal(declined.cancellationReason, "customer_declined_renewal");
  assert.equal(db.doc("bonos/bono-new").minutosRestantes, minutesBefore + 45);

  // Race: the slot of another renewed appointment filled up before the customer answered.
  const third = renewalAppointmentId("renewal-0005", "s-weekly:2026-10-22");
  fill(db, "2026-10-22", "18:00", 60, 2);
  await rejectsWithReason(confirmations(db).respondToAppointmentConfirmation(callable("user-1", { appointmentId: third, action: "accept" })), "slot_full");
  assert.equal(db.doc(`appointments/${third}`).status, "pending");
});
