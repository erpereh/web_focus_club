const assert = require("node:assert/strict");
const test = require("node:test");

const { createAdminAppointmentRescheduleHandlers } = require("../lib/adminAppointmentReschedule.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { getCanonicalSlotBlocks, slotOccupancyDocId } = require("../lib/appointmentLifecycle.js");

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
    this.kind = "doc";
  }
}

class FakeQuery {
  constructor(db, collectionName, filters = [], maximum) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
    this.maximum = maximum;
    this.kind = "query";
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, operator, value }], this.maximum);
  }
  limit(maximum) { return new FakeQuery(this.db, this.collectionName, this.filters, maximum); }
}

class FakeCollection extends FakeQuery {
  constructor(db, collectionName) { super(db, collectionName); }
  doc(id) {
    const nextId = id ?? `auto-${++this.db.autoId}`;
    return new FakeDocumentReference(this.db, `${this.collectionName}/${nextId}`);
  }
}

function clone(value) { return structuredClone(value); }

function matches(actual, filter) {
  if (filter.operator === "==") return actual === filter.value;
  if (filter.operator === "in") return filter.value.includes(actual);
  if (filter.operator === ">=") return actual >= filter.value;
  if (filter.operator === "<=") return actual <= filter.value;
  throw new Error(`unsupported ${filter.operator}`);
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(clone(documents)));
    this.operations = [];
    this.autoId = 0;
  }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const staged = [];
    let wrote = false;
    const transaction = {
      get: async (target) => {
        if (wrote) throw new Error("read after write");
        this.operations.push({ type: "read", target: target.path ?? target.collectionName });
        if (target.kind === "doc") {
          const data = this.documents.get(target.path);
          return { id: target.id, ref: target, exists: data !== undefined, data: () => data === undefined ? undefined : clone(data) };
        }
        const prefix = `${target.collectionName}/`;
        const docs = [...this.documents.entries()]
          .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
          .map(([path, data]) => ({
            id: path.slice(prefix.length),
            ref: new FakeDocumentReference(this, path),
            exists: true,
            data: () => clone(data),
          }))
          .filter((snap) => target.filters.every((filter) => matches(snap.data()[filter.field], filter)));
        return { docs: target.maximum === undefined ? docs : docs.slice(0, target.maximum), empty: docs.length === 0 };
      },
      set: (ref, value, options) => {
        wrote = true;
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        const deleteFields = Object.entries(value)
          .filter(([, fieldValue]) => fieldValue?.constructor?.name === "DeleteTransform")
          .map(([field]) => field);
        staged.push({ ref, value: clone(value), merge: options?.merge === true, deleteFields });
      },
      create: (ref, value) => {
        wrote = true;
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        staged.push({ ref, value: clone(value), merge: false, deleteFields: [] });
      },
    };
    const result = await callback(transaction);
    staged.forEach(({ ref, value, merge, deleteFields }) => {
      const next = merge ? { ...(this.documents.get(ref.path) ?? {}), ...value } : value;
      deleteFields.forEach((field) => delete next[field]);
      this.documents.set(ref.path, next);
    });
    return result;
  }
}

const fixedNow = new Date("2026-09-01T08:00:00.000Z");

function slotKeys(date, time, duration = 60) {
  return getCanonicalSlotBlocks(time, duration).map((block) => slotOccupancyDocId(date, block));
}

function addOccupancy(documents, date, time, count, duration = 60) {
  slotKeys(date, time, duration).forEach((key) => {
    documents[`slot_occupancy/${key}`] = { date, time: key.slice(11), count };
  });
}

function appointmentSlotKeys(appointment) {
  const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0];
  return new Set(slot ? slotKeys(slot.date, slot.time, Number(appointment.duration)) : []);
}

function pendingOccurrence(index, date, time = "10:00") {
  return {
    userId: "user-1",
    name: "Cliente",
    email: "cliente@example.com",
    phone: "600000000",
    serviceType: "Entrenamiento personal",
    sessionType: "Personal",
    duration: "60",
    preferredSlots: [{ date, time }],
    date,
    time,
    reason: "Objetivo",
    status: "pending",
    assignedTrainer: null,
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-08-01T10:00:00.000Z",
    minutesRefunded: false,
    minutesRefundedAmount: null,
    minutesRefundedAt: null,
    minutesRefundReason: null,
    recurrenceSeriesId: "series-1",
    recurrenceIndex: index,
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

function pendingFixture(count = 2) {
  const dates = ["2026-09-08", "2026-09-15", "2026-09-22"];
  const documents = {
    "appointment_recurrences/series-1": {
      userId: "user-1",
      serviceType: "Entrenamiento personal",
      duration: "60",
      assignedTrainer: null,
      startDate: dates[0],
      startTime: "10:00",
      intervalDays: 7,
      endDate: dates[count - 1],
      occurrenceCount: count,
      totalMinutes: count * 60,
      bonoId: "bono-1",
      status: "pending",
      origin: "admin",
    },
    "users/user-1": { uid: "user-1", name: "Cliente", email: "cliente@example.com" },
    "services/service-1": { title: "Entrenamiento personal", active: true },
    "trainers/trainer-1": { uid: "trainer-1", name: "Trainer", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "bonos/bono-1": {
      userId: "user-1",
      minutosTotales: 600,
      tamano: 600,
      minutosRestantes: 300,
      fechaExpiracion: "2026-12-31T23:59:59.000Z",
      estado: "activo",
      historial: [],
    },
  };
  for (let index = 0; index < count; index += 1) {
    documents[`appointments/pending-${index}`] = pendingOccurrence(index * 2 + 1, dates[index], index === 1 ? "11:00" : "10:00");
  }
  return documents;
}

function recurringHandlers(db) {
  return createRecurringSeriesHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
    appointmentSlotKeys,
    defaultServiceType: "Entrenamiento personal",
  });
}

function adminHandlers(db) {
  return createAdminAppointmentRescheduleHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
}

function adminRequest(data) { return { auth: { uid: "admin-1", token: {} }, data }; }

test("approval uses each active pending occurrence real slot and non-contiguous index", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "11:00", 0);
  const db = new FakeFirestore(documents);
  const beforeBono = clone(documents["bonos/bono-1"]);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1",
    assignedTrainer: "trainer-1",
  }));
  assert.deepEqual(db.documents.get("appointments/pending-0").approvedSlot, { date: "2026-09-08", time: "10:00" });
  assert.deepEqual(db.documents.get("appointments/pending-1").approvedSlot, { date: "2026-09-15", time: "11:00" });
  assert.equal(db.documents.get("appointments/pending-1").recurrenceIndex, 3);
  assert.equal(db.documents.get("appointments/pending-1").sessionType, "Personal");
  assert.equal(db.documents.get("appointment_recurrences/series-1").status, "approved");
  assert.deepEqual(db.documents.get("bonos/bono-1"), beforeBono);
  slotKeys("2026-09-15", "11:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1));
});

test("approval keeps a stored recurring slot valid after only the start grid changes", async () => {
  const documents = pendingFixture(1);
  documents["appointment_recurrences/series-1"].startTime = "10:30";
  documents["appointments/pending-0"].preferredSlots = [{ date: "2026-09-08", time: "10:30" }];
  documents["appointments/pending-0"].date = "2026-09-08";
  documents["appointments/pending-0"].time = "10:30";
  documents["site_config/main"].slotInterval = 60;
  addOccupancy(documents, "2026-09-08", "10:30", 0);
  const db = new FakeFirestore(documents);

  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1",
  }));

  assert.equal(db.documents.get("appointments/pending-0").status, "approved");
  assert.deepEqual(db.documents.get("appointments/pending-0").approvedSlot, {
    date: "2026-09-08",
    time: "10:30",
  });
});

test("approval aborts atomically when a modified pending slot has become full", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "11:00", 2);
  const db = new FakeFirestore(documents);
  const before = clone(Object.fromEntries(db.documents));
  await assert.rejects(
    recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" })),
    (error) => error.code === "failed-precondition",
  );
  assert.deepEqual(Object.fromEntries(db.documents), before);
  assert.equal(db.operations.some((operation) => operation.type === "write"), false);
});

async function expectOverridePrompt(promise) {
  const error = await promise.then(() => assert.fail("expected an admin confirmation request"), (caught) => caught);
  assert.equal(error.code, "failed-precondition");
  assert.equal(error.details.reason, "admin_override_required");
  return error.details;
}

test("a pending series moved into a full slot with an exception can still be approved over capacity", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "12:00", 2);
  const db = new FakeFirestore(documents);
  const move = { appointmentId: "pending-0", startSlot: { date: "2026-09-08", time: "12:00" }, endDate: "2026-09-15", assignedTrainer: null };

  // 1. Move: the admin confirms the full slot; a pending series takes no seat yet.
  const movePrompt = await expectOverridePrompt(adminHandlers(db).replaceRecurringSeriesScheduleFromAdmin(adminRequest(move)));
  await adminHandlers(db).replaceRecurringSeriesScheduleFromAdmin(adminRequest({ ...move, acknowledgedRestrictions: movePrompt.fingerprint }));
  slotKeys("2026-09-08", "12:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 2));

  // 2. Approve: capacity is asked again (it is now that the seat is taken) and nothing is written.
  const before = clone(Object.fromEntries(db.documents));
  db.operations = [];
  const approvePrompt = await expectOverridePrompt(
    recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" })),
  );
  assert.deepEqual(approvePrompt.restrictions, [
    { date: "2026-09-08", time: "12:00", reason: "slot_full", occupancy: 2, maxCapacity: 2 },
  ]);
  assert.deepEqual(Object.fromEntries(db.documents), before);

  // 3. Confirmed approval: seats over capacity, minutes untouched (already reserved) and audited.
  const result = await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1",
    acknowledgedRestrictions: approvePrompt.fingerprint,
  }));
  assert.deepEqual(result.overriddenRestrictions, approvePrompt.restrictions);
  assert.equal(db.documents.get("appointment_recurrences/series-1").status, "approved");
  slotKeys("2026-09-08", "12:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 3));
  slotKeys("2026-09-15", "12:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1));
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 300);
  const logs = [...db.documents.entries()].filter(([path]) => path.startsWith("activity_logs/")).map(([, value]) => value);
  assert.ok(logs.some((log) => log.action === "recurring_series_schedule_replaced_with_admin_override"));
  assert.ok(logs.some((log) => log.action === "recurring_appointments_approved"));
  const approvalOverride = logs.find((log) => log.action === "recurring_series_approved_with_admin_override");
  assert.deepEqual(approvalOverride.restrictions, approvePrompt.restrictions);
});

test("series approval never overrides a blocked slot, even with a confirmation", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "10:00", 2);
  documents["blocked_slots/block"] = { date: "2026-09-15", time: "11:00" };
  const db = new FakeFirestore(documents);
  await assert.rejects(
    recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
      seriesId: "series-1",
      acknowledgedRestrictions: "2026-09-08|10:00|slot_full|2|2",
    })),
    (error) => error.code === "failed-precondition" && /bloqueada/.test(error.message),
  );
  assert.equal(db.operations.some((operation) => operation.type === "write"), false);
});

test("reduction followed by rejection or cancellation refunds only reservations still active", async (t) => {
  for (const action of ["reject", "cancel"]) {
    await t.test(action, async () => {
      const documents = pendingFixture(3);
      const db = new FakeFirestore(documents);
      await adminHandlers(db).replaceRecurringSeriesScheduleFromAdmin(adminRequest({
        appointmentId: "pending-1",
        startSlot: { date: "2026-09-08", time: "10:00" },
        endDate: "2026-09-15",
        assignedTrainer: null,
      }));
      assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 360);
      if (action === "reject") {
        await recurringHandlers(db).rejectRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
      } else {
        await recurringHandlers(db).cancelOwnRecurringAppointmentSeries({
          auth: { uid: "user-1", token: {} }, data: { seriesId: "series-1" },
        });
      }
      assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 480);
      assert.equal(db.documents.get("appointments/pending-2").minutesRefundedAmount, 60);
    });
  }
});

test("expanded pending series keeps bono stable through approve pending approve and preserves sessionType", async () => {
  const documents = pendingFixture(2);
  const db = new FakeFirestore(documents);
  await adminHandlers(db).replaceRecurringSeriesScheduleFromAdmin(adminRequest({
    appointmentId: "pending-1",
    startSlot: { date: "2026-09-08", time: "10:00" },
    endDate: "2026-09-22",
    assignedTrainer: "trainer-1",
  }));
  const remainingAfterExpansion = db.documents.get("bonos/bono-1").minutosRestantes;
  assert.equal(remainingAfterExpansion, 240);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1", assignedTrainer: "trainer-1",
  }));
  await adminHandlers(db).returnRecurringSeriesToPendingFromAdmin(adminRequest({ seriesId: "series-1" }));
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1", assignedTrainer: "trainer-1",
  }));
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, remainingAfterExpansion);
  for (const id of ["pending-0", "pending-1", "auto-1"]) {
    assert.equal(db.documents.get(`appointments/${id}`).status, "approved");
    assert.equal(db.documents.get(`appointments/${id}`).sessionType, "Personal");
  }
});

function mixedApprovalFixture({ includeHistoricalPending = false } = {}) {
  const documents = pendingFixture(2);
  delete documents["appointments/pending-1"];
  documents["appointment_recurrences/series-1"] = {
    ...documents["appointment_recurrences/series-1"],
    startDate: "2026-08-25",
    occurrenceCount: includeHistoricalPending ? 4 : 3,
    totalMinutes: includeHistoricalPending ? 240 : 180,
  };
  documents["appointments/historical-approved"] = {
    ...pendingOccurrence(0, "2026-08-25"),
    status: "approved",
    approvedSlot: { date: "2026-08-25", time: "10:00" },
    assignedTrainer: "trainer-old",
  };
  documents["appointments/future-approved"] = {
    ...pendingOccurrence(4, "2026-09-15", "12:00"),
    status: "approved",
    approvedSlot: { date: "2026-09-15", time: "12:00" },
    assignedTrainer: "trainer-old",
    updatedAt: "2026-08-10T10:00:00.000Z",
  };
  documents["appointments/cancelled"] = {
    ...pendingOccurrence(5, "2026-09-22"),
    status: "cancelled",
    minutesRefunded: true,
    minutesRefundedAt: "2026-08-20T10:00:00.000Z",
  };
  documents["appointments/rejected"] = {
    ...pendingOccurrence(6, "2026-09-29"),
    status: "rejected",
  };
  if (includeHistoricalPending) {
    documents["appointments/historical-pending"] = pendingOccurrence(7, "2026-08-20");
  }
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "12:00", 1);
  return documents;
}

test("mixed approval only approves future pending and counts every active occurrence", async () => {
  const documents = mixedApprovalFixture();
  const db = new FakeFirestore(documents);
  const existingApprovedBefore = clone(documents["appointments/future-approved"]);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1",
    assignedTrainer: "trainer-1",
  }));

  assert.equal(db.documents.get("appointments/pending-0").status, "approved");
  assert.equal(db.documents.get("appointments/historical-approved").assignedTrainer, "trainer-old");
  assert.deepEqual(db.documents.get("appointments/future-approved"), existingApprovedBefore);
  assert.equal(db.documents.get("appointments/cancelled").status, "cancelled");
  assert.equal(db.documents.get("appointments/rejected").status, "rejected");
  slotKeys("2026-09-08", "10:00").forEach((key) => {
    assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1);
  });
  slotKeys("2026-09-15", "12:00").forEach((key) => {
    assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1, "existing approved occupancy is untouched");
  });
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "approved");
  assert.equal(series.occurrenceCount, 3);
  assert.equal(series.totalMinutes, 180);
  assert.equal(series.futureOccurrenceCount, 2);
  assert.equal(series.futureStartDate, "2026-09-08");
  assert.equal(series.futureEndDate, "2026-09-15");
});

test("historical pending remains pending and keeps mixed series pending after future approval", async () => {
  const documents = mixedApprovalFixture({ includeHistoricalPending: true });
  const db = new FakeFirestore(documents);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({
    seriesId: "series-1",
    assignedTrainer: "trainer-1",
  }));

  assert.equal(db.documents.get("appointments/pending-0").status, "approved");
  assert.equal(db.documents.get("appointments/historical-pending").status, "pending");
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "pending");
  assert.equal(series.occurrenceCount, 4);
  assert.equal(series.totalMinutes, 240);
  assert.equal(series.futureOccurrenceCount, 2);
});

// -------------------------------------------------- stale series metadata
// Before 2026-10-14 the admin panel cancelled/deleted occurrences from the browser
// without updating occurrenceCount/totalMinutes. The occurrences are the truth.

const { createRecurringRescheduleHandlers } = require("../lib/recurringReschedule.js");

function staleFixture(storedCount) {
  const documents = pendingFixture(2);
  Object.assign(documents["appointment_recurrences/series-1"], {
    occurrenceCount: storedCount,
    totalMinutes: storedCount * 60,
  });
  return documents;
}

function activityLogs(db) {
  return [...db.documents.entries()].filter(([path]) => path.startsWith("activity_logs/")).map(([, value]) => value);
}

function writes(db) {
  return db.operations.filter((operation) => operation.type === "write");
}

test("approval derives the series metadata from its occurrences when the stored one is stale", async () => {
  const documents = staleFixture(4);
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "11:00", 1);
  const db = new FakeFirestore(documents);
  const beforeBono = clone(documents["bonos/bono-1"]);

  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));

  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "approved");
  assert.equal(series.occurrenceCount, 2);
  assert.equal(series.totalMinutes, 120);
  assert.deepEqual(db.documents.get("bonos/bono-1"), beforeBono, "minutes were already reserved");
  slotKeys("2026-09-08", "10:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1));
  slotKeys("2026-09-15", "11:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 2));
  const log = activityLogs(db).find((entry) => entry.action === "recurring_appointments_approved");
  assert.equal(log.previousOccurrenceCount, 4);
  assert.equal(log.previousTotalMinutes, 240);
});

test("an in-sync approval logs no metadata correction", async () => {
  const db = new FakeFirestore(pendingFixture(2));
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
  const log = activityLogs(db).find((entry) => entry.action === "recurring_appointments_approved");
  assert.equal("previousOccurrenceCount" in log, false);
});

test("stale approved series: customer moves one session, then the admin approves the series", async () => {
  const documents = pendingFixture(2);
  Object.assign(documents["appointment_recurrences/series-1"], {
    status: "approved",
    occurrenceCount: 3,
    totalMinutes: 180,
  });
  for (const [id, slot] of [["pending-0", { date: "2026-09-08", time: "10:00" }], ["pending-1", { date: "2026-09-15", time: "11:00" }]]) {
    Object.assign(documents[`appointments/${id}`], { status: "approved", approvedSlot: slot, assignedTrainer: "trainer-1" });
    addOccupancy(documents, slot.date, slot.time, 1);
  }
  const db = new FakeFirestore(documents);
  const beforeBono = clone(documents["bonos/bono-1"]);
  const customer = createRecurringRescheduleHandlers({ db, requireAdmin: async () => ({}), getNowDate: () => fixedNow });

  await customer.rescheduleOwnRecurringAppointment({
    auth: { uid: "user-1", token: {} },
    data: { appointmentId: "pending-1", preferredSlot: { date: "2026-09-16", time: "11:00" }, scope: "single" },
  });
  const pendingSeries = db.documents.get("appointment_recurrences/series-1");
  assert.equal(pendingSeries.status, "pending");
  assert.equal(pendingSeries.occurrenceCount, 3, "the single reschedule keeps the stale count");

  // Rejecting it as a whole would orphan the approved session: refused, nothing written.
  db.operations = [];
  await assert.rejects(
    recurringHandlers(db).rejectRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" })),
    (error) => error.details?.reason === "series_has_approved_occurrences",
  );
  assert.equal(writes(db).length, 0);

  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "approved");
  assert.equal(series.occurrenceCount, 2);
  assert.equal(series.totalMinutes, 120);
  assert.equal(db.documents.get("appointments/pending-1").status, "approved");
  assert.deepEqual(db.documents.get("appointments/pending-1").approvedSlot, { date: "2026-09-16", time: "11:00" });
  assert.deepEqual(db.documents.get("bonos/bono-1"), beforeBono);
  slotKeys("2026-09-08", "10:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1));
  slotKeys("2026-09-15", "11:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 0));
  slotKeys("2026-09-16", "11:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 1));
});

test("approval still refuses real occurrence inconsistencies, without writing", async (t) => {
  const cases = [
    ["duplicate index", (docs) => { docs["appointments/pending-1"].recurrenceIndex = docs["appointments/pending-0"].recurrenceIndex; }, "invalid_occurrence_index"],
    ["missing index", (docs) => { delete docs["appointments/pending-1"].recurrenceIndex; }, "invalid_occurrence_index"],
    ["other customer", (docs) => { docs["appointments/pending-1"].userId = "user-2"; }, "occurrence_owner_mismatch"],
    ["other duration", (docs) => { docs["appointments/pending-1"].duration = "30"; }, "occurrence_duration_mismatch"],
    ["already refunded", (docs) => { docs["appointments/pending-1"].minutesRefundedAt = "2026-08-20T10:00:00.000Z"; }, "reservation_mismatch"],
    ["other bono", (docs) => { docs["appointments/pending-1"].bonoId = "bono-2"; }, "reservation_mismatch"],
    ["no bono", (docs) => { delete docs["appointment_recurrences/series-1"].bonoId; }, "series_without_bono"],
  ];
  for (const [name, mutate, reason] of cases) {
    await t.test(name, async () => {
      const documents = staleFixture(3);
      mutate(documents);
      const db = new FakeFirestore(documents);
      await assert.rejects(
        recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" })),
        (error) => error.code === "failed-precondition"
          && error.message === "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto."
          && error.details?.reason === reason,
      );
      assert.equal(writes(db).length, 0);
    });
  }
});

test("rejection and cancellation of a stale series refund exactly the pending reservations", async (t) => {
  for (const action of ["reject", "cancel"]) {
    await t.test(action, async () => {
      const db = new FakeFirestore(staleFixture(4));
      if (action === "reject") {
        await recurringHandlers(db).rejectRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
      } else {
        await recurringHandlers(db).cancelOwnRecurringAppointmentSeries({
          auth: { uid: "user-1", token: {} }, data: { seriesId: "series-1" },
        });
      }
      assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 300 + 120);
      for (const id of ["pending-0", "pending-1"]) {
        assert.equal(db.documents.get(`appointments/${id}`).minutesRefundedAmount, 60);
      }
      assert.equal(db.documents.get("appointment_recurrences/series-1").status, action === "reject" ? "rejected" : "cancelled");
    });
  }
});

// ------------------------------------------------------------ grouped notices

const { classifyAppointmentChange } = require("../lib/notifications/appointmentEvents.js");

function outboxEntries(db) {
  return [...db.documents.entries()]
    .filter(([path]) => path.startsWith("notification_outbox/"))
    .map(([path, data]) => ({ id: path.split("/")[1], data }));
}

function assertGrouped(db, before, { event, appointmentIds }) {
  const entries = outboxEntries(db);
  assert.equal(entries.length, 1, "one grouped notice per operation");
  const [{ id, data }] = entries;
  assert.equal(data.event, event);
  assert.equal(data.userId, "user-1");
  assert.equal(data.seriesId, "series-1");
  assert.deepEqual([...data.appointmentIds].sort(), [...appointmentIds].sort());
  for (const appointmentId of appointmentIds) {
    const after = db.documents.get(`appointments/${appointmentId}`);
    assert.equal(after.notificationOperationId, id);
    // The per-appointment trigger stays silent for these writes.
    assert.equal(classifyAppointmentChange(before[`appointments/${appointmentId}`], after, fixedNow), null);
  }
  return data;
}

test("series approval writes one grouped confirmed notice", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "11:00", 0);
  const db = new FakeFirestore(documents);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
  const entry = assertGrouped(db, documents, {
    event: "appointment_series_confirmed",
    appointmentIds: ["pending-0", "pending-1"],
  });
  assert.deepEqual(entry.sessions, [{ date: "2026-09-08", time: "10:00" }, { date: "2026-09-15", time: "11:00" }]);
  assert.equal(entry.customerEmail, "cliente@example.com");
  assert.equal(entry.actor, "admin");
});

test("series rejection and customer cancellation write one grouped notice each", async (t) => {
  for (const [action, event, actor] of [
    ["reject", "appointment_series_rejected", "admin"],
    ["cancel", "appointment_series_cancelled", "customer"],
  ]) {
    await t.test(action, async () => {
      const documents = pendingFixture(2);
      const db = new FakeFirestore(documents);
      if (action === "reject") {
        await recurringHandlers(db).rejectRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
      } else {
        await recurringHandlers(db).cancelOwnRecurringAppointmentSeries({
          auth: { uid: "user-1", token: {} }, data: { seriesId: "series-1" },
        });
      }
      const entry = assertGrouped(db, documents, { event, appointmentIds: ["pending-0", "pending-1"] });
      assert.equal(entry.actor, actor);
    });
  }
});

test("admin schedule replacement groups reused, created and cancelled sessions in one notice", async () => {
  const documents = pendingFixture(3);
  const db = new FakeFirestore(documents);
  await adminHandlers(db).replaceRecurringSeriesScheduleFromAdmin(adminRequest({
    appointmentId: "pending-1",
    startSlot: { date: "2026-09-08", time: "10:00" },
    endDate: "2026-09-15",
    assignedTrainer: null,
  }));
  const entries = outboxEntries(db);
  assert.equal(entries.length, 1);
  const { id, data } = entries[0];
  assert.equal(data.event, "appointment_series_rescheduled");
  assert.equal(data.sessions.length, 2);
  assert.equal(data.cancelledSessions.length, 1);
  for (const appointmentId of ["pending-0", "pending-1", "pending-2"]) {
    const after = db.documents.get(`appointments/${appointmentId}`);
    assert.equal(after.notificationOperationId, id);
    assert.equal(classifyAppointmentChange(documents[`appointments/${appointmentId}`], after, fixedNow), null);
  }
});

test("returning an approved series to pending writes one grouped notice", async () => {
  const documents = pendingFixture(2);
  addOccupancy(documents, "2026-09-08", "10:00", 0);
  addOccupancy(documents, "2026-09-15", "11:00", 0);
  const db = new FakeFirestore(documents);
  await recurringHandlers(db).approveRecurringAppointmentSeriesFromAdmin(adminRequest({ seriesId: "series-1" }));
  const approvedState = Object.fromEntries([...db.documents.entries()].map(([k, v]) => [k, clone(v)]));
  [...db.documents.keys()].filter((key) => key.startsWith("notification_outbox/")).forEach((key) => db.documents.delete(key));

  await adminHandlers(db).returnRecurringSeriesToPendingFromAdmin(adminRequest({ seriesId: "series-1" }));
  assertGrouped(db, approvedState, {
    event: "appointment_series_returned_to_pending",
    appointmentIds: ["pending-0", "pending-1"],
  });
});
