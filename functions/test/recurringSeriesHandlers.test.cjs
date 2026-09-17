const assert = require("node:assert/strict");
const test = require("node:test");

const { createAdminAppointmentRescheduleHandlers } = require("../lib/adminAppointmentReschedule.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { getSlotBlocks, slotOccupancyDocId } = require("../lib/appointmentLifecycle.js");

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
  return getSlotBlocks(time, duration).map((block) => slotOccupancyDocId(date, block));
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
