const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAdminAppointmentRescheduleHandlers,
} = require("../lib/adminAppointmentReschedule.js");
const {
  getSlotBlocks,
  reconcileAppointmentMinutes,
  slotOccupancyDocId,
} = require("../lib/appointmentLifecycle.js");

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
    return new FakeQuery(this.db, this.collectionName, [
      ...this.filters,
      { field, operator, value },
    ], this.maximum);
  }

  limit(maximum) {
    return new FakeQuery(this.db, this.collectionName, this.filters, maximum);
  }
}

class FakeCollection extends FakeQuery {
  constructor(db, collectionName) {
    super(db, collectionName);
  }

  doc(id) {
    const nextId = id ?? `auto-${++this.db.autoId}`;
    return new FakeDocumentReference(this.db, `${this.collectionName}/${nextId}`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function matchesFilter(actual, { operator, value }) {
  if (operator === "==") return actual === value;
  if (operator === "in") return Array.isArray(value) && value.includes(actual);
  if (operator === ">=") return actual >= value;
  if (operator === "<=") return actual <= value;
  throw new Error(`unsupported query operator ${operator}`);
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(clone(documents)));
    this.operations = [];
    this.autoId = 0;
  }

  collection(name) {
    return new FakeCollection(this, name);
  }

  async runTransaction(callback) {
    const staged = [];
    let firstWriteSeen = false;
    const transaction = {
      get: async (target) => {
        if (firstWriteSeen) throw new Error("read after write");
        this.operations.push({ type: "read", target: target.path ?? target.collectionName });
        if (target.kind === "doc") {
          const data = this.documents.get(target.path);
          return {
            id: target.id,
            ref: target,
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : clone(data)),
          };
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
          .filter((snap) => target.filters.every((filter) => matchesFilter(snap.data()[filter.field], filter)));
        return { docs: target.maximum === undefined ? docs : docs.slice(0, target.maximum), empty: docs.length === 0 };
      },
      set: (ref, value, options) => {
        firstWriteSeen = true;
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        const deleteFields = Object.entries(value)
          .filter(([, fieldValue]) => fieldValue?.constructor?.name === "DeleteTransform")
          .map(([field]) => field);
        staged.push({ ref, value: clone(value), merge: options?.merge === true, deleteFields });
      },
      create: (ref, value) => {
        if (this.documents.has(ref.path) || staged.some((entry) => entry.ref.path === ref.path)) {
          throw new Error(`document already exists: ${ref.path}`);
        }
        firstWriteSeen = true;
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        staged.push({ ref, value: clone(value), merge: false });
      },
    };
    const result = await callback(transaction);
    staged.forEach(({ ref, value, merge, deleteFields = [] }) => {
      const previous = this.documents.get(ref.path) ?? {};
      const next = merge ? { ...previous, ...value } : value;
      deleteFields.forEach((field) => delete next[field]);
      this.documents.set(ref.path, next);
    });
    return result;
  }
}

const fixedNow = new Date("2026-09-01T08:00:00.000Z"); // 10:00 in Europe/Madrid

function slotOccupancy(date, time, count = 0) {
  return { date, time, count };
}

function slotKeys(date, time, duration = 60) {
  return getSlotBlocks(time, duration).map((block) => slotOccupancyDocId(date, block));
}

function addOccupancy(documents, date, time, count, duration = 60) {
  slotKeys(date, time, duration).forEach((key) => {
    documents[`slot_occupancy/${key}`] = slotOccupancy(key.slice(0, 10), key.slice(11), count);
  });
}

function createHandlers(db, overrides = {}) {
  return createAdminAppointmentRescheduleHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
    ...overrides,
  });
}

function snapshotDocuments(db) {
  return new Map([...db.documents.entries()].map(([path, value]) => [path, clone(value)]));
}

function assertNoWrites(db, before) {
  assert.equal(db.operations.some((operation) => operation.type === "write"), false);
  assert.deepEqual(db.documents, before);
}

function futurePendingAppointment(overrides = {}) {
  return {
    userId: "user-1",
    name: "Cliente protegido",
    email: "cliente@example.com",
    phone: "600000000",
    serviceType: "Entrenamiento personal",
    sessionType: "Personal",
    duration: "60",
    preferredSlots: [{ date: "2026-09-07", time: "10:00" }],
    reason: "Objetivo protegido",
    status: "pending",
    date: "2026-09-07",
    time: "10:00",
    assignedTrainer: "trainer-1",
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-08-01T10:00:00.000Z",
    minutesRefunded: false,
    minutesRefundedAt: null,
    googleCalendarEventId: "google-event-1",
    googleCalendarSyncedAt: "2026-08-02T10:00:00.000Z",
    googleCalendarSyncStatus: "synced",
    googleCalendarSyncHash: "hash-1",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function recurringOccurrence(id, recurrenceIndex, date, status = "approved", overrides = {}) {
  const slot = { date, time: "10:00" };
  return {
    userId: "user-1",
    name: "Cliente protegido",
    email: "cliente@example.com",
    phone: "600000000",
    serviceType: "Entrenamiento personal",
    sessionType: "Personal",
    duration: "60",
    preferredSlots: [slot],
    ...(status === "approved" ? { approvedSlot: slot } : {}),
    reason: "Objetivo protegido",
    status,
    date,
    time: "10:00",
    assignedTrainer: "trainer-1",
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-08-01T10:00:00.000Z",
    minutesDeductionSkippedAt: null,
    minutesDeductionSkippedReason: null,
    minutesRefunded: false,
    minutesRefundedAmount: null,
    minutesRefundedAt: null,
    minutesRefundReason: null,
    recurrenceSeriesId: "series-1",
    recurrenceIndex,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    googleCalendarEventId: `google-${id}`,
    googleCalendarSyncedAt: "2026-08-02T10:00:00.000Z",
    googleCalendarSyncStatus: "synced",
    googleCalendarSyncHash: `hash-${id}`,
    ...overrides,
  };
}

function recurringSeriesFixture(overrides = {}) {
  const records = {
    "past-0": recurringOccurrence("past-0", 0, "2026-08-25"),
    "future-1": recurringOccurrence("future-1", 1, "2026-09-07"),
    "future-2": recurringOccurrence("future-2", 2, "2026-09-14"),
    "future-3": recurringOccurrence("future-3", 3, "2026-09-21"),
    "cancelled-4": recurringOccurrence("cancelled-4", 4, "2026-09-28", "cancelled", {
      minutesRefunded: true,
      minutesRefundedAmount: 60,
      minutesRefundedAt: "2026-08-15T10:00:00.000Z",
      minutesRefundReason: "previous_cancel",
    }),
    "pending-5": recurringOccurrence("pending-5", 5, "2026-10-05", "pending"),
    "rejected-6": recurringOccurrence("rejected-6", 6, "2026-10-12", "rejected"),
  };
  const documents = {
    "appointment_recurrences/series-1": {
      userId: "user-1",
      serviceType: "Entrenamiento personal",
      duration: "60",
      assignedTrainer: "trainer-1",
      startDate: "2026-08-25",
      startTime: "10:00",
      intervalDays: 7,
      endDate: "2026-10-12",
      occurrenceCount: 4,
      totalMinutes: 240,
      bonoId: "bono-1",
      status: "approved",
      origin: "admin",
      createdAt: "2026-08-01T10:00:00.000Z",
      ...overrides.series,
    },
    "users/user-1": { uid: "user-1", role: "user" },
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "trainers/trainer-2": { uid: "trainer-2", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "bonos/bono-1": {
      userId: "user-1",
      tamano: 1000,
      minutosTotales: 1000,
      minutosRestantes: 500,
      fechaExpiracion: "2026-12-01T23:59:59.000Z",
      estado: "activo",
      historial: [{ accion: "kept_history" }],
      ...overrides.bono,
    },
  };
  Object.entries(records).forEach(([id, record]) => {
    documents[`appointments/${id}`] = { ...record, ...(overrides.records?.[id] ?? {}) };
  });
  ["future-1", "future-2", "future-3"].forEach((id) => {
    const record = documents[`appointments/${id}`];
    addOccupancy(documents, record.date, record.time, 1, Number(record.duration));
  });
  return documents;
}

function pendingRecurringSeriesFixture(overrides = {}) {
  const records = {
    "pending-0": recurringOccurrence("pending-0", 0, "2026-09-07", "pending", {
      approvedSlot: undefined,
      googleCalendarEventId: undefined,
      googleCalendarSyncedAt: undefined,
      googleCalendarSyncStatus: undefined,
      googleCalendarSyncHash: undefined,
    }),
    "pending-1": recurringOccurrence("pending-1", 1, "2026-09-14", "pending", {
      approvedSlot: undefined,
      googleCalendarEventId: undefined,
      googleCalendarSyncedAt: undefined,
      googleCalendarSyncStatus: undefined,
      googleCalendarSyncHash: undefined,
    }),
    "pending-2": recurringOccurrence("pending-2", 2, "2026-09-21", "pending", {
      approvedSlot: undefined,
      googleCalendarEventId: undefined,
      googleCalendarSyncedAt: undefined,
      googleCalendarSyncStatus: undefined,
      googleCalendarSyncHash: undefined,
    }),
    "cancelled-3": recurringOccurrence("cancelled-3", 3, "2026-09-28", "cancelled", {
      approvedSlot: undefined,
      minutesRefunded: true,
      minutesRefundedAmount: 60,
      minutesRefundedAt: "2026-08-15T10:00:00.000Z",
      minutesRefundReason: "previous_cancel",
    }),
  };
  const documents = {
    "appointment_recurrences/series-1": {
      userId: "user-1",
      serviceType: "Entrenamiento personal",
      duration: "60",
      assignedTrainer: "trainer-1",
      startDate: "2026-09-07",
      startTime: "10:00",
      intervalDays: 7,
      endDate: "2026-09-21",
      occurrenceCount: 3,
      totalMinutes: 180,
      futureOccurrenceCount: 3,
      futureStartDate: "2026-09-07",
      futureStartTime: "10:00",
      futureEndDate: "2026-09-21",
      bonoId: "bono-1",
      status: "pending",
      origin: "admin",
      ...overrides.series,
    },
    "users/user-1": { uid: "user-1", role: "user" },
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "trainers/trainer-2": { uid: "trainer-2", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "bonos/bono-1": {
      userId: "user-1",
      tamano: 600,
      minutosTotales: 600,
      minutosRestantes: 300,
      fechaExpiracion: "2026-12-01T23:59:59.000Z",
      estado: "activo",
      historial: [{ accion: "kept_history" }],
      ...overrides.bono,
    },
  };
  Object.entries(records).forEach(([id, record]) => {
    documents[`appointments/${id}`] = { ...record, ...(overrides.records?.[id] ?? {}) };
  });
  return documents;
}

function activityLog(db, action) {
  return [...db.documents.entries()].find(([path, value]) => path.startsWith("activity_logs/") && value.action === action)?.[1];
}

test("admin single reschedule updates a future pending record without consuming occupancy or bono", async () => {
  const before = futurePendingAppointment();
  const documents = {
    "appointments/pending-1": before,
    "users/user-1": { role: "user" },
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "slot_occupancy/2026-09-08_11:00": slotOccupancy("2026-09-08", "11:00"),
    "slot_occupancy/2026-09-08_11:30": slotOccupancy("2026-09-08", "11:30"),
    "slot_occupancy/2026-09-08_12:00": slotOccupancy("2026-09-08", "12:00"),
    "bonos/bono-1": { userId: "user-1", estado: "activo", minutosRestantes: 120 },
  };
  const db = new FakeFirestore(documents);
  const handlers = createAdminAppointmentRescheduleHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });

  const result = await handlers.rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "pending-1",
      slot: { date: "2026-09-08", time: "11:00" },
      assignedTrainer: "trainer-1",
    },
  });

  assert.equal(result.success, true);
  const updated = db.documents.get("appointments/pending-1");
  assert.equal(updated.status, "pending");
  assert.deepEqual(updated.preferredSlots, [{ date: "2026-09-08", time: "11:00" }]);
  assert.equal(updated.date, "2026-09-08");
  assert.equal(updated.time, "11:00");
  assert.equal(updated.approvedSlot, undefined);
  assert.equal(updated.bonoId, before.bonoId);
  assert.equal(updated.minutesDeductedAt, before.minutesDeductedAt);
  assert.equal(updated.googleCalendarEventId, before.googleCalendarEventId);
  assert.deepEqual(db.documents.get("bonos/bono-1"), documents["bonos/bono-1"]);
  assert.equal(db.operations.some((operation) => operation.target.startsWith("slot_occupancy/") && operation.type === "write"), false);
  const log = [...db.documents.entries()].find(([path]) => path.startsWith("activity_logs/"))[1];
  assert.equal(log.action, "appointment_rescheduled_by_admin");
  assert.equal(log.adminUid, "admin-1");
  assert.equal(log.appointmentId, "pending-1");
  assert.equal(log.recurrenceSeriesId, null);
  assert.deepEqual(log.oldSlot, { date: "2026-09-07", time: "10:00" });
  assert.deepEqual(log.newSlot, { date: "2026-09-08", time: "11:00" });
  assert.equal(log.oldTrainer, "trainer-1");
  assert.equal(log.newTrainer, "trainer-1");
  assert.equal(log.slotChanged, true);
  assert.equal(log.trainerChanged, false);
  assert.equal(log.createdAt, fixedNow.toISOString());
  assert.equal("email" in log, false);
  assert.equal("name" in log, false);
  assert.equal("phone" in log, false);
});

test("admin single reschedule requires authentication and admin authorization before writes", async () => {
  const documents = {
    "appointments/pending-1": futurePendingAppointment(),
  };
  const db = new FakeFirestore(documents);
  let requireAdminCalls = 0;
  const handlers = createHandlers(db, {
    requireAdmin: async () => { requireAdminCalls += 1; },
  });
  const before = snapshotDocuments(db);

  await assert.rejects(
    handlers.rescheduleAppointmentFromAdmin({
      data: {
        appointmentId: "pending-1",
        slot: { date: "2026-09-08", time: "11:00" },
        assignedTrainer: null,
      },
    }),
    (error) => error.code === "permission-denied" && error.details.reason === "unauthenticated",
  );
  assert.equal(requireAdminCalls, 0);
  assertNoWrites(db, before);

  const deniedDb = new FakeFirestore(documents);
  const deniedHandlers = createHandlers(deniedDb, {
    requireAdmin: async () => {
      const error = new Error("denied");
      error.code = "permission-denied";
      throw error;
    },
  });
  await assert.rejects(
    deniedHandlers.rescheduleAppointmentFromAdmin({
      auth: { uid: "not-an-admin", token: {} },
      data: {
        appointmentId: "pending-1",
        slot: { date: "2026-09-08", time: "11:00" },
        assignedTrainer: null,
      },
    }),
    (error) => error.code === "permission-denied" && error.details.reason === "admin_required",
  );
  assertNoWrites(deniedDb, snapshotDocuments(new FakeFirestore(documents)));
});

test("both admin rescheduling callables expose stable reasons for denied admin checks", async (t) => {
  const requestDataByHandler = {
    rescheduleAppointmentFromAdmin: {
      appointmentId: "pending-1",
      slot: { date: "2026-09-08", time: "11:00" },
      assignedTrainer: null,
    },
    replaceRecurringSeriesScheduleFromAdmin: {
      appointmentId: "future-1",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-22",
      assignedTrainer: null,
    },
    returnRecurringSeriesToPendingFromAdmin: {
      seriesId: "series-1",
    },
  };

  for (const [handlerName, data] of Object.entries(requestDataByHandler)) {
    await t.test(`${handlerName} unauthenticated`, async () => {
      const db = new FakeFirestore({});
      let requireAdminCalls = 0;
      const handlers = createHandlers(db, {
        requireAdmin: async () => { requireAdminCalls += 1; },
      });
      const before = snapshotDocuments(db);

      await assert.rejects(
        handlers[handlerName]({ data }),
        (error) => error.code === "permission-denied" && error.details.reason === "unauthenticated",
      );
      assert.equal(requireAdminCalls, 0);
      assertNoWrites(db, before);
    });

    await t.test(`${handlerName} denied admin`, async () => {
      const db = new FakeFirestore({});
      const handlers = createHandlers(db, {
        requireAdmin: async () => {
          const error = new Error("raw admin denial");
          error.code = "permission-denied";
          throw error;
        },
      });
      const before = snapshotDocuments(db);

      await assert.rejects(
        handlers[handlerName]({ auth: { uid: "not-an-admin", token: {} }, data }),
        (error) => error.code === "permission-denied" && error.details.reason === "admin_required",
      );
      assertNoWrites(db, before);
    });
  }
});

test("admin single approved correction aggregates old and historical occupancy while bypassing historical blocked capacity and conflicts", async () => {
  const before = futurePendingAppointment({
    status: "approved",
    approvedSlot: { date: "2026-09-07", time: "10:00" },
    preferredSlots: [{ date: "2026-09-07", time: "10:00" }],
    date: "2026-09-07",
    time: "10:00",
  });
  const documents = {
    "appointments/approved-1": before,
    "appointments/historical-conflict": futurePendingAppointment({
      preferredSlots: [{ date: "2026-08-20", time: "11:00" }],
      date: "2026-08-20",
      time: "11:00",
    }),
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "blocked_slots/historical-block": { date: "2026-08-20", time: "11:00" },
    "bonos/bono-1": { userId: "user-1", estado: "activo", minutosRestantes: 120 },
  };
  addOccupancy(documents, "2026-09-07", "10:00", 1);
  addOccupancy(documents, "2026-08-20", "11:00", 5);
  const db = new FakeFirestore(documents);
  const handlers = createHandlers(db);

  await handlers.rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "approved-1",
      slot: { date: "2026-08-20", time: "11:00" },
      assignedTrainer: "trainer-1",
    },
  });

  const updated = db.documents.get("appointments/approved-1");
  assert.equal(updated.status, "approved");
  assert.deepEqual(updated.approvedSlot, { date: "2026-08-20", time: "11:00" });
  assert.equal(updated.googleCalendarEventId, before.googleCalendarEventId);
  slotKeys("2026-09-07", "10:00").forEach((key) => {
    assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 0);
  });
  slotKeys("2026-08-20", "11:00").forEach((key) => {
    assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 6);
  });
  assert.deepEqual(db.documents.get("bonos/bono-1"), documents["bonos/bono-1"]);
  const log = [...db.documents.entries()].find(([path]) => path.startsWith("activity_logs/"))[1];
  assert.equal(log.action, "appointment_corrected_by_admin");
  assert.deepEqual(log.oldSlot, { date: "2026-09-07", time: "10:00" });
  assert.deepEqual(log.newSlot, { date: "2026-08-20", time: "11:00" });
  assert.equal(log.oldTrainer, "trainer-1");
  assert.equal(log.newTrainer, "trainer-1");
  assert.equal(log.slotChanged, true);
  assert.equal(log.trainerChanged, false);
});

test("admin single future validation treats a later Madrid-today target as future and leaves failed transactions unchanged", async () => {
  const appointment = futurePendingAppointment({
    status: "approved",
    approvedSlot: { date: "2026-09-07", time: "10:00" },
  });
  const documents = {
    "appointments/approved-1": appointment,
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "blocked_slots/today-block": { date: "2026-09-01", time: "11:00" },
  };
  addOccupancy(documents, "2026-09-07", "10:00", 1);
  addOccupancy(documents, "2026-09-01", "11:00", 0);
  const db = new FakeFirestore(documents);
  const before = snapshotDocuments(db);

  await assert.rejects(
    createHandlers(db).rescheduleAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "approved-1",
        slot: { date: "2026-09-01", time: "11:00" },
        assignedTrainer: "trainer-1",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "slot_blocked",
  );
  assertNoWrites(db, before);
});

test("admin single trainer-only changes do not read or write occupancy or bono and explicit null unassigns", async () => {
  const appointment = futurePendingAppointment({
    status: "approved",
    approvedSlot: { date: "2026-09-07", time: "10:00" },
  });
  const documents = {
    "appointments/approved-1": appointment,
    "trainers/trainer-2": { uid: "trainer-2", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    "bonos/bono-1": { userId: "user-1", estado: "activo", minutosRestantes: 120 },
  };
  const db = new FakeFirestore(documents);
  const handlers = createHandlers(db);
  await handlers.rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "approved-1",
      slot: { date: "2026-09-07", time: "10:00" },
      assignedTrainer: "trainer-2",
    },
  });
  assert.equal(db.documents.get("appointments/approved-1").assignedTrainer, "trainer-2");
  assert.equal(db.operations.some((operation) => operation.target.startsWith("slot_occupancy/")), false);
  assert.equal(db.operations.some((operation) => operation.target.startsWith("bonos/")), false);

  const unassignDb = new FakeFirestore({
    ...documents,
    "appointments/approved-1": { ...appointment, assignedTrainer: "trainer-2" },
  });
  await createHandlers(unassignDb).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "approved-1",
      slot: { date: "2026-09-07", time: "10:00" },
      assignedTrainer: null,
    },
  });
  assert.equal(unassignDb.documents.get("appointments/approved-1").assignedTrainer, null);
  assert.equal(unassignDb.operations.some((operation) => operation.target.startsWith("slot_occupancy/")), false);
  assert.equal(unassignDb.operations.some((operation) => operation.target.startsWith("bonos/")), false);
});

test("admin single rejects a changed or future inactive trainer but preserves an unchanged historical inactive trainer", async () => {
  const historical = futurePendingAppointment({
    status: "approved",
    assignedTrainer: "trainer-inactive",
    preferredSlots: [{ date: "2026-08-20", time: "10:00" }],
    approvedSlot: { date: "2026-08-20", time: "10:00" },
    date: "2026-08-20",
    time: "10:00",
  });
  const historicalDb = new FakeFirestore({
    "appointments/historical": historical,
    "trainers/trainer-inactive": { uid: "trainer-inactive", active: false },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  });
  await createHandlers(historicalDb).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "historical",
      slot: { date: "2026-08-20", time: "10:00" },
      assignedTrainer: "trainer-inactive",
    },
  });
  assert.equal(historicalDb.documents.get("appointments/historical").assignedTrainer, "trainer-inactive");

  const future = futurePendingAppointment({
    status: "approved",
    assignedTrainer: "trainer-inactive",
    approvedSlot: { date: "2026-09-07", time: "10:00" },
  });
  const futureDb = new FakeFirestore({
    "appointments/future": future,
    "trainers/trainer-inactive": { uid: "trainer-inactive", active: false },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  });
  const before = snapshotDocuments(futureDb);
  await assert.rejects(
    createHandlers(futureDb).rescheduleAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "future",
        slot: { date: "2026-09-07", time: "10:00" },
        assignedTrainer: "trainer-inactive",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "trainer_inactive",
  );
  assertNoWrites(futureDb, before);
});

test("admin single cannot carry an unchanged inactive trainer from a historical record into a future correction", async () => {
  const historical = futurePendingAppointment({
    status: "approved",
    assignedTrainer: "trainer-inactive",
    preferredSlots: [{ date: "2026-08-20", time: "10:00" }],
    approvedSlot: { date: "2026-08-20", time: "10:00" },
    date: "2026-08-20",
    time: "10:00",
  });
  const documents = {
    "appointments/historical": historical,
    "trainers/trainer-inactive": { uid: "trainer-inactive", active: false },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  };
  addOccupancy(documents, "2026-08-20", "10:00", 1);
  addOccupancy(documents, "2026-09-07", "11:00", 0);
  const db = new FakeFirestore(documents);
  const before = snapshotDocuments(db);
  await assert.rejects(
    createHandlers(db).rescheduleAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "historical",
        slot: { date: "2026-09-07", time: "11:00" },
        assignedTrainer: "trainer-inactive",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "trainer_inactive",
  );
  assertNoWrites(db, before);
});

test("admin single validates a pending future target at capacity and performs no write", async () => {
  const documents = {
    "appointments/pending-1": futurePendingAppointment(),
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  };
  addOccupancy(documents, "2026-09-08", "11:00", 2);
  const db = new FakeFirestore(documents);
  const before = snapshotDocuments(db);
  await assert.rejects(
    createHandlers(db).rescheduleAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "pending-1",
        slot: { date: "2026-09-08", time: "11:00" },
        assignedTrainer: "trainer-1",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "slot_full",
  );
  assertNoWrites(db, before);
});

test("admin single approved reschedule reads delta-zero occupancy and writes only absolute nonzero final counts", async () => {
  const appointment = futurePendingAppointment({
    status: "approved",
    approvedSlot: { date: "2026-09-07", time: "10:00" },
  });
  const documents = {
    "appointments/approved-1": appointment,
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 3 },
  };
  addOccupancy(documents, "2026-09-07", "10:00", 1);
  addOccupancy(documents, "2026-09-07", "10:30", 0);
  const oldKeys = new Set(slotKeys("2026-09-07", "10:00"));
  const newKeys = new Set(slotKeys("2026-09-07", "10:30"));
  const zeroDeltaKeys = [...oldKeys].filter((key) => newKeys.has(key));
  const db = new FakeFirestore(documents);

  await createHandlers(db).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "approved-1",
      slot: { date: "2026-09-07", time: "10:30" },
      assignedTrainer: "trainer-1",
    },
  });

  zeroDeltaKeys.forEach((key) => {
    assert.ok(db.operations.some((operation) => operation.type === "read" && operation.target === `slot_occupancy/${key}`));
    assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target === `slot_occupancy/${key}`), false);
  });
  db.operations
    .filter((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/"))
    .forEach((operation) => assert.equal(Number.isInteger(operation.value.count), true));
});

test("admin single recurrent approved reschedule changes only its selected record and refreshes the recurrence end-date audit", async () => {
  const selected = recurringOccurrence("single-recurring", 1, "2026-09-07", "approved", {
    recurrenceSeriesId: "series-single",
  });
  const sibling = recurringOccurrence("sibling-recurring", 2, "2026-09-14", "approved", {
    recurrenceSeriesId: "series-single",
  });
  const documents = {
    "appointments/single-recurring": selected,
    "appointments/sibling-recurring": sibling,
    "appointment_recurrences/series-single": {
      userId: "user-1",
      status: "approved",
      intervalDays: 7,
      endDate: "2026-09-14",
      bonoId: "bono-1",
    },
    "trainers/trainer-1": { uid: "trainer-1", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  };
  addOccupancy(documents, "2026-09-07", "10:00", 1);
  addOccupancy(documents, "2026-09-21", "11:00", 0);
  const db = new FakeFirestore(documents);

  await createHandlers(db).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "single-recurring",
      slot: { date: "2026-09-21", time: "11:00" },
      assignedTrainer: "trainer-1",
    },
  });

  assert.deepEqual(db.documents.get("appointments/single-recurring").approvedSlot, { date: "2026-09-21", time: "11:00" });
  assert.deepEqual(db.documents.get("appointments/sibling-recurring"), sibling);
  const series = db.documents.get("appointment_recurrences/series-single");
  assert.equal(series.endDate, "2026-09-21");
  assert.equal(series.lastRescheduleScope, "single");
  assert.equal(series.lastRescheduleAppointmentId, "single-recurring");
});

test("admin single allows a recurring pending occurrence and preserves its financial reservation", async () => {
  const documents = {
    "appointments/recurring-pending": recurringOccurrence("recurring-pending", 0, "2026-09-07", "pending", {
      approvedSlot: undefined,
    }),
    "appointment_recurrences/series-1": {
      userId: "user-1",
      status: "pending",
      intervalDays: 7,
      endDate: "2026-09-07",
      bonoId: "bono-1",
    },
    "trainers/trainer-2": { uid: "trainer-2", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
  };
  addOccupancy(documents, "2026-09-08", "11:00", 0);
  const db = new FakeFirestore(documents);
  const before = clone(documents["appointments/recurring-pending"]);
  await createHandlers(db).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "recurring-pending",
      slot: { date: "2026-09-08", time: "11:00" },
      assignedTrainer: "trainer-2",
    },
  });
  const updated = db.documents.get("appointments/recurring-pending");
  assert.equal(updated.status, "pending");
  assert.deepEqual(updated.preferredSlots, [{ date: "2026-09-08", time: "11:00" }]);
  assert.equal(updated.assignedTrainer, "trainer-2");
  assert.equal(updated.approvedSlot, undefined);
  for (const field of ["bonoId", "minutesDeducted", "minutesDeductedAmount", "minutesDeductedAt", "recurrenceSeriesId", "recurrenceIndex"]) {
    assert.equal(updated[field], before[field]);
  }
  assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/")), false);
});

test("recurring pending trainer-only bypasses full and blocked availability without occupancy reads", async () => {
  const documents = {
    "appointments/recurring-pending": recurringOccurrence("recurring-pending", 0, "2026-09-07", "pending", {
      approvedSlot: undefined,
    }),
    "appointment_recurrences/series-1": {
      userId: "user-1", status: "pending", intervalDays: 7, endDate: "2026-09-07", bonoId: "bono-1",
    },
    "trainers/trainer-2": { uid: "trainer-2", active: true },
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 1 },
    "blocked_slots/blocked": { date: "2026-09-07", time: "10:00" },
  };
  addOccupancy(documents, "2026-09-07", "10:00", 1);
  const db = new FakeFirestore(documents);
  const beforeSlot = clone(documents["appointments/recurring-pending"].preferredSlots);
  await createHandlers(db).rescheduleAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "recurring-pending",
      slot: { date: "2026-09-07", time: "10:00" },
      assignedTrainer: "trainer-2",
    },
  });
  const updated = db.documents.get("appointments/recurring-pending");
  assert.equal(updated.assignedTrainer, "trainer-2");
  assert.deepEqual(updated.preferredSlots, beforeSlot);
  assert.equal(updated.date, "2026-09-07");
  assert.equal(updated.time, "10:00");
  assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/")), false);
  assert.equal(db.operations.some((operation) => operation.target === "blocked_slots"), false);
  assert.equal(db.operations.some((operation) => operation.target === "site_config/main"), false);
});

test("admin pending series replacement reuses records and applies only the financial delta without occupancy", async () => {
  const documents = pendingRecurringSeriesFixture();
  const db = new FakeFirestore(documents);
  const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "pending-1",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-15",
      assignedTrainer: "trainer-2",
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.minutesDelta, -60);
  assert.deepEqual(result.reusedAppointmentIds, ["pending-0", "pending-1"]);
  assert.deepEqual(result.cancelledAppointmentIds, ["pending-2"]);
  assert.equal(db.documents.get("appointments/pending-0").status, "pending");
  assert.equal(db.documents.get("appointments/pending-0").approvedSlot, undefined);
  assert.equal(db.documents.get("appointments/pending-2").minutesRefunded, true);
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 360);
  assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/")), false);
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "pending");
  assert.equal(series.occurrenceCount, 2);
  assert.equal(series.totalMinutes, 120);
  assert.equal(activityLog(db, "recurring_pending_series_schedule_replaced").minutesDelta, -60);
});

test("admin pending series same-count replacement changes neither bono nor occupancy", async () => {
  const documents = pendingRecurringSeriesFixture();
  const beforeBono = clone(documents["bonos/bono-1"]);
  const db = new FakeFirestore(documents);
  const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "pending-0",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-22",
      assignedTrainer: null,
    },
  });
  assert.equal(result.minutesDelta, 0);
  assert.deepEqual(result.reusedAppointmentIds, ["pending-0", "pending-1", "pending-2"]);
  assert.deepEqual(db.documents.get("bonos/bono-1"), beforeBono);
  assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/")), false);
});

test("admin pending series validates capacity and an eliminated bono before writes", async (t) => {
  await t.test("full target", async () => {
    const documents = pendingRecurringSeriesFixture();
    addOccupancy(documents, "2026-09-08", "11:00", 2);
    const db = new FakeFirestore(documents);
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId: "pending-0",
          startSlot: { date: "2026-09-08", time: "11:00" },
          endDate: "2026-09-22",
          assignedTrainer: null,
        },
      }),
      (error) => error.code === "failed-precondition" && error.details.reason === "slot_full",
    );
    assertNoWrites(db, before);
  });

  await t.test("eliminated bono", async () => {
    const documents = pendingRecurringSeriesFixture({ bono: { estado: "eliminado" } });
    const db = new FakeFirestore(documents);
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId: "pending-0",
          startSlot: { date: "2026-09-08", time: "11:00" },
          endDate: "2026-09-22",
          assignedTrainer: null,
        },
      }),
      (error) => error.code === "failed-precondition" && error.details.reason === "bono_unavailable",
    );
    assertNoWrites(db, before);
  });
});

test("returning an approved series to pending releases occupancy and preserves finance and session type", async () => {
  const documents = recurringSeriesFixture({
    records: {
      "past-0": { status: "cancelled" },
      "pending-5": { status: "cancelled" },
    },
    series: { occurrenceCount: 3, totalMinutes: 180, startDate: "2026-09-07" },
  });
  const db = new FakeFirestore(documents);
  const result = await createHandlers(db).returnRecurringSeriesToPendingFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: { seriesId: "series-1" },
  });
  assert.deepEqual(result.affectedAppointmentIds, ["future-1", "future-2", "future-3"]);
  for (const id of result.affectedAppointmentIds) {
    const occurrence = db.documents.get(`appointments/${id}`);
    assert.equal(occurrence.status, "pending");
    assert.equal(occurrence.sessionType, "Personal");
    assert.equal(occurrence.serviceType, "Entrenamiento personal");
    assert.equal(occurrence.assignedTrainer, undefined);
    assert.equal(occurrence.approvedSlot, undefined);
    assert.equal(occurrence.minutesDeducted, true);
    assert.equal(occurrence.minutesRefunded, false);
  }
  assert.equal(db.documents.get("appointment_recurrences/series-1").status, "pending");
  assert.equal(db.documents.get("appointment_recurrences/series-1").assignedTrainer, null);
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 500);
  slotKeys("2026-09-07", "10:00").forEach((key) => assert.equal(db.documents.get(`slot_occupancy/${key}`).count, 0));
  assert.equal(activityLog(db, "recurring_series_returned_to_pending").oldStatus, "approved");
  const log = activityLog(db, "recurring_series_returned_to_pending");
  assert.equal("email" in log, false);
  assert.equal("phone" in log, false);
  assert.equal("name" in log, false);
});

test("returning an approved series rejects historical occurrences and invalid occupancy atomically", async (t) => {
  await t.test("historical occurrence", async () => {
    const documents = recurringSeriesFixture();
    const db = new FakeFirestore(documents);
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).returnRecurringSeriesToPendingFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: { seriesId: "series-1" },
      }),
      (error) => error.code === "failed-precondition"
        && error.details.reason === "series_has_historical_occurrences",
    );
    assertNoWrites(db, before);
  });

  await t.test("invalid occupancy", async () => {
    const documents = recurringSeriesFixture({
      records: { "past-0": { status: "cancelled" }, "pending-5": { status: "cancelled" } },
      series: { occurrenceCount: 3, totalMinutes: 180, startDate: "2026-09-07" },
    });
    documents[`slot_occupancy/${slotKeys("2026-09-07", "10:00")[0]}`].count = -1;
    const db = new FakeFirestore(documents);
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).returnRecurringSeriesToPendingFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: { seriesId: "series-1" },
      }),
      (error) => error.code === "failed-precondition" && error.details.reason === "invalid_occupancy",
    );
    assertNoWrites(db, before);
  });
});

test("admin series replacement uses a cancelled selected occurrence only to identify the series and reuses future approved records", async () => {
  const documents = recurringSeriesFixture();
  const beforeFutureOne = clone(documents["appointments/future-1"]);
  const beforePast = clone(documents["appointments/past-0"]);
  const beforeCancelled = clone(documents["appointments/cancelled-4"]);
  const db = new FakeFirestore(documents);

  const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "cancelled-4",
      startSlot: { date: "2026-09-07", time: "10:00" },
      endDate: "2026-09-21",
      assignedTrainer: "trainer-2",
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.reusedAppointmentIds, ["future-1", "future-2", "future-3"]);
  ["future-1", "future-2", "future-3"].forEach((id, index) => {
    const updated = db.documents.get(`appointments/${id}`);
    assert.equal(updated.recurrenceIndex, index + 1);
    assert.equal(updated.assignedTrainer, "trainer-2");
    assert.equal(updated.googleCalendarEventId, `google-${id}`);
    assert.equal(updated.minutesDeductedAt, beforeFutureOne.minutesDeductedAt);
  });
  assert.deepEqual(db.documents.get("appointments/past-0"), beforePast);
  assert.deepEqual(db.documents.get("appointments/cancelled-4"), beforeCancelled);
  assert.equal(db.operations.some((operation) => operation.target.startsWith("slot_occupancy/") && operation.type === "write"), false);
  slotKeys("2026-09-07", "10:00").forEach((key) => {
    assert.ok(db.operations.some((operation) => operation.type === "read" && operation.target === `slot_occupancy/${key}`));
  });
  assert.equal(db.operations.some((operation) => operation.target.startsWith("bonos/") && operation.type === "write"), false);
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.occurrenceCount, 4);
  assert.equal(series.totalMinutes, 240);
  assert.equal(series.futureOccurrenceCount, 3);
  assert.equal(series.futureStartDate, "2026-09-07");
  assert.equal(series.futureEndDate, "2026-09-21");
  assert.equal(series.assignedTrainer, "trainer-2");
  assert.equal(series.startDate, "2026-08-25", "historical series anchor must be preserved");
  const log = activityLog(db, "recurring_series_schedule_replaced");
  assert.deepEqual(log.reusedAppointmentIds, ["future-1", "future-2", "future-3"]);
  assert.equal(log.oldFutureCount, 3);
  assert.equal(log.newFutureCount, 3);
  assert.equal(log.oldFutureReservedMinutes, 180);
  assert.equal(log.newFutureMinutes, 180);
  assert.equal(log.minutesDelta, 0);
  assert.deepEqual(log.newStartSlot, { date: "2026-09-07", time: "10:00" });
  assert.equal(log.newEndDate, "2026-09-21");
  assert.equal(log.oldTrainer, "trainer-1");
  assert.equal(log.newTrainer, "trainer-2");
  assert.equal("email" in log, false);
  assert.equal("name" in log, false);
  assert.equal("phone" in log, false);
});

test("admin series replacement derives owner and dates from its series, not a stale selected occurrence", async (t) => {
  const selectedCases = [
    ["cancelled stale owner", "cancelled-4", "cancelled", "stale-user"],
    ["rejected missing owner", "rejected-6", "rejected", undefined],
    ["pending stale owner", "pending-5", "pending", "stale-user"],
  ];

  for (const [label, appointmentId, status, staleUserId] of selectedCases) {
    await t.test(label, async () => {
      const documents = recurringSeriesFixture();
      const selectedPath = `appointments/${appointmentId}`;
      const selectedSlot = { date: "2031-01-06", time: "18:30" };
      documents[selectedPath] = {
        ...documents[selectedPath],
        status,
        userId: staleUserId,
        date: selectedSlot.date,
        time: selectedSlot.time,
        approvedSlot: selectedSlot,
        preferredSlots: [selectedSlot],
      };
      if (staleUserId === undefined) delete documents[selectedPath].userId;
      const selectedBefore = clone(documents[selectedPath]);
      const db = new FakeFirestore(documents);

      const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId,
          startSlot: { date: "2026-09-08", time: "11:00" },
          endDate: "2026-09-22",
          assignedTrainer: "trainer-2",
        },
      });

      assert.equal(result.success, true);
      assert.equal(db.documents.get("appointments/future-1").date, "2026-09-08");
      assert.equal(db.documents.get("appointments/future-3").date, "2026-09-22");
      assert.equal(db.documents.get("appointment_recurrences/series-1").futureStartDate, "2026-09-08");
      assert.equal(db.documents.get("appointment_recurrences/series-1").futureEndDate, "2026-09-22");
      assert.deepEqual(db.documents.get(selectedPath), selectedBefore);
    });
  }
});

test("admin series replacement treats only safely dated invalid approved occurrences as historical", async () => {
  const historicalDocuments = recurringSeriesFixture({
    records: {
      "past-0": {
        approvedSlot: { date: "invalid", time: "invalid" },
        preferredSlots: [{ date: "2026-08-25", time: "invalid" }],
      },
    },
  });
  const historicalDb = new FakeFirestore(historicalDocuments);
  await createHandlers(historicalDb).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "future-1",
      startSlot: { date: "2026-09-07", time: "10:00" },
      endDate: "2026-09-21",
      assignedTrainer: "trainer-1",
    },
  });

  const unsafeDocuments = recurringSeriesFixture({
    records: {
      "future-2": {
        approvedSlot: { date: "invalid", time: "invalid" },
        preferredSlots: [{ date: "2026-09-14", time: "invalid" }],
      },
    },
  });
  const unsafeDb = new FakeFirestore(unsafeDocuments);
  const before = snapshotDocuments(unsafeDb);
  await assert.rejects(
    createHandlers(unsafeDb).replaceRecurringSeriesScheduleFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "future-1",
        startSlot: { date: "2026-09-07", time: "10:00" },
        endDate: "2026-09-21",
        assignedTrainer: "trainer-1",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "invalid_occurrence_slot",
  );
  assertNoWrites(unsafeDb, before);
});

test("admin series replacement updates its historical start metadata only when no historical occurrence remains", async () => {
  const db = new FakeFirestore(recurringSeriesFixture({
    records: {
      "past-0": {
        status: "cancelled",
        preferredSlots: [{ date: "2026-09-28", time: "10:00" }],
        approvedSlot: { date: "2026-09-28", time: "10:00" },
        date: "2026-09-28",
        time: "10:00",
      },
    },
  }));
  await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "future-1",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-22",
      assignedTrainer: "trainer-2",
    },
  });
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.startDate, "2026-09-08");
  assert.equal(series.startTime, "11:00");
});

test("admin series replacement omits trainer patches when the selected trainer is unchanged", async () => {
  const db = new FakeFirestore(recurringSeriesFixture());
  await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "future-1",
      startSlot: { date: "2026-09-07", time: "10:00" },
      endDate: "2026-09-21",
      assignedTrainer: "trainer-1",
    },
  });
  const futureWrite = db.operations.find((operation) => operation.type === "write" && operation.target === "appointments/future-1");
  const seriesWrite = db.operations.find((operation) => operation.type === "write" && operation.target === "appointment_recurrences/series-1");
  assert.equal("assignedTrainer" in futureWrite.value, false);
  assert.equal("assignedTrainer" in seriesWrite.value, false);
});

test("admin series reduction cancels only surplus future approved records, unassigns reused records, and refunds once", async () => {
  const documents = recurringSeriesFixture();
  const beforePast = clone(documents["appointments/past-0"]);
  const db = new FakeFirestore(documents);

  const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "future-2",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-15",
      assignedTrainer: null,
    },
  });

  assert.deepEqual(result.reusedAppointmentIds, ["future-1", "future-2"]);
  assert.deepEqual(result.cancelledAppointmentIds, ["future-3"]);
  assert.equal(db.documents.get("appointments/future-1").assignedTrainer, null);
  assert.equal(db.documents.get("appointments/future-2").assignedTrainer, null);
  const cancelled = db.documents.get("appointments/future-3");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellationReason, "admin_series_schedule_reduction");
  assert.equal(cancelled.minutesRefunded, true);
  assert.equal(cancelled.minutesRefundedAmount, 60);
  assert.equal(cancelled.googleCalendarEventId, "google-future-3");
  assert.deepEqual(db.documents.get("appointments/past-0"), beforePast);
  const bono = db.documents.get("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 560);
  assert.equal(bono.historial.length, 2);
  assert.equal(bono.historial[1].accion, "devolucion_cita");
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.occurrenceCount, 3);
  assert.equal(series.totalMinutes, 180);
  assert.equal(series.futureOccurrenceCount, 2);
  const log = activityLog(db, "recurring_series_schedule_replaced");
  assert.deepEqual(log.cancelledAppointmentIds, ["future-3"]);
  assert.equal(log.minutesDelta, -60);

  let secondBonoPatch;
  let secondAppointmentPatch;
  const secondRefund = reconcileAppointmentMinutes({
    action: "refund",
    appointment: cancelled,
    bono: { id: "bono-1", ...bono },
    now: "2026-09-01T09:00:00.000Z",
    transaction: {
      setBono: (_bonoId, patch) => { secondBonoPatch = patch; },
      setAppointment: (patch) => { secondAppointmentPatch = patch; },
    },
  });
  assert.deepEqual(secondRefund, { ok: false, reason: "not-refundable" });
  assert.equal(secondBonoPatch, undefined);
  assert.equal(secondAppointmentPatch, undefined);
});

test("admin series finance updates retain every existing bono history entry", async () => {
  const legacyHistory = ["legacy-entry", { accion: "older_entry", payload: { preserved: true } }];
  const db = new FakeFirestore(recurringSeriesFixture({ bono: { historial: legacyHistory } }));
  await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "future-1",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-15",
      assignedTrainer: null,
    },
  });
  const history = db.documents.get("bonos/bono-1").historial;
  assert.deepEqual(history.slice(0, legacyHistory.length), legacyHistory);
  assert.equal(history.at(-1).accion, "devolucion_cita");
});

test("admin series replacement rejects malformed reserved-bono data even when its minutes delta is zero", async (t) => {
  for (const [label, bono] of [
    ["unknown state", { estado: "unknown" }],
    ["negative remaining minutes", { minutosRestantes: -1 }],
  ]) {
    await t.test(label, async () => {
      const db = new FakeFirestore(recurringSeriesFixture({ bono }));
      const before = snapshotDocuments(db);
      await assert.rejects(
        createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
          auth: { uid: "admin-1", token: {} },
          data: {
            appointmentId: "future-1",
            startSlot: { date: "2026-09-07", time: "10:00" },
            endDate: "2026-09-21",
            assignedTrainer: "trainer-1",
          },
        }),
        (error) => error.code === "failed-precondition" && error.details.reason === "invalid_bono",
      );
      assertNoWrites(db, before);
    });
  }
});

test("admin series replacement rejects an eliminated bono before every financial shape without writes", async (t) => {
  const cases = [
    ["same count", "2026-09-07", "2026-09-21"],
    ["reduction", "2026-09-08", "2026-09-15"],
    ["expansion", "2026-09-08", "2026-09-29"],
  ];

  for (const [label, startDate, endDate] of cases) {
    await t.test(label, async () => {
      const db = new FakeFirestore(recurringSeriesFixture({ bono: { estado: "eliminado" } }));
      const before = snapshotDocuments(db);

      await assert.rejects(
        createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
          auth: { uid: "admin-1", token: {} },
          data: {
            appointmentId: "future-1",
            startSlot: { date: startDate, time: "10:00" },
            endDate,
            assignedTrainer: "trainer-1",
          },
        }),
        (error) => error.code === "failed-precondition" && error.details.reason === "bono_unavailable",
      );
      assertNoWrites(db, before);
    });
  }
});

test("admin series replacement enforces civil bono expiration only while the bono is still current", async (t) => {
  await t.test("active bono rejects a final occurrence after its civil expiration", async () => {
    const db = new FakeFirestore(recurringSeriesFixture({
      bono: { fechaExpiracion: "2026-09-30T23:59:59.000Z", estado: "activo" },
    }));
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId: "future-1",
          startSlot: { date: "2026-09-08", time: "11:00" },
          endDate: "2026-10-06",
          assignedTrainer: "trainer-1",
        },
      }),
      (error) => error.code === "failed-precondition" && error.details.reason === "bono_unavailable",
    );
    assertNoWrites(db, before);
  });

  await t.test("active bono accepts a final occurrence within its civil expiration", async () => {
    const db = new FakeFirestore(recurringSeriesFixture({
      bono: { fechaExpiracion: "2026-09-30T23:59:59.000Z", estado: "activo" },
    }));
    const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "future-1",
        startSlot: { date: "2026-09-08", time: "11:00" },
        endDate: "2026-09-29",
        assignedTrainer: "trainer-1",
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.newFutureCount, 4);
  });

  await t.test("already expired bono can still reduce existing reservations", async () => {
    const db = new FakeFirestore(recurringSeriesFixture({
      bono: { fechaExpiracion: "2026-08-31T23:59:59.000Z", estado: "expirado" },
    }));
    const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "future-1",
        startSlot: { date: "2026-09-08", time: "11:00" },
        endDate: "2026-09-15",
        assignedTrainer: "trainer-1",
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.minutesDelta, -60);
  });

  await t.test("already expired bono still rejects expansion", async () => {
    const db = new FakeFirestore(recurringSeriesFixture({
      bono: { fechaExpiracion: "2026-08-31T23:59:59.000Z", estado: "expirado" },
    }));
    const before = snapshotDocuments(db);
    await assert.rejects(
      createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId: "future-1",
          startSlot: { date: "2026-09-08", time: "11:00" },
          endDate: "2026-09-29",
          assignedTrainer: "trainer-1",
        },
      }),
      (error) => error.code === "failed-precondition" && error.details.reason === "bono_unavailable",
    );
    assertNoWrites(db, before);
  });
});

test("admin series replacement rejects missing and over-total usable bono balances without writes", async (t) => {
  const balanceCases = [
    ["missing remaining balance", (documents) => delete documents["bonos/bono-1"].minutosRestantes],
    ["over-total remaining balance", (documents) => { documents["bonos/bono-1"].minutosRestantes = 1001; }],
  ];

  for (const [label, mutate] of balanceCases) {
    await t.test(label, async () => {
      const documents = recurringSeriesFixture();
      mutate(documents);
      const db = new FakeFirestore(documents);
      const before = snapshotDocuments(db);

      await assert.rejects(
        createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
          auth: { uid: "admin-1", token: {} },
          data: {
            appointmentId: "future-1",
            startSlot: { date: "2026-09-07", time: "10:00" },
            endDate: "2026-09-21",
            assignedTrainer: "trainer-1",
          },
        }),
        (error) => error.code === "failed-precondition" && error.details.reason === "invalid_financial_reservation",
      );
      assertNoWrites(db, before);
    });
  }
});

test("admin series reduction rejects a refund that cannot be applied exactly", async () => {
  const db = new FakeFirestore(recurringSeriesFixture({ bono: { minutosRestantes: 980 } }));
  const before = snapshotDocuments(db);

  await assert.rejects(
    createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "future-1",
        startSlot: { date: "2026-09-08", time: "11:00" },
        endDate: "2026-09-15",
        assignedTrainer: null,
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "invalid_financial_reservation",
  );
  assertNoWrites(db, before);
});

test("admin series expansion creates a new high unique index with copied identity and correct reservation metadata", async () => {
  const documents = recurringSeriesFixture();
  const template = clone(documents["appointments/future-1"]);
  const db = new FakeFirestore(documents);

  const result = await createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "past-0",
      startSlot: { date: "2026-09-08", time: "11:00" },
      endDate: "2026-09-29",
      assignedTrainer: "trainer-2",
    },
  });

  assert.equal(result.createdAppointmentIds.length, 1);
  const created = db.documents.get(`appointments/${result.createdAppointmentIds[0]}`);
  assert.equal(created.recurrenceIndex, 7, "new index must exceed every valid existing index");
  assert.equal(created.status, "approved");
  assert.equal(created.userId, template.userId);
  assert.equal(created.name, template.name);
  assert.equal(created.serviceType, template.serviceType);
  assert.equal(created.duration, template.duration);
  assert.equal(created.assignedTrainer, "trainer-2");
  assert.equal(created.minutesDeducted, true);
  assert.equal(created.minutesDeductedAmount, 60);
  assert.equal(created.minutesRefundedAt, null);
  assert.equal("googleCalendarEventId" in created, false);
  const bono = db.documents.get("bonos/bono-1");
  assert.equal(bono.minutosRestantes, 440);
  assert.equal(bono.historial.length, 2);
  assert.equal(bono.historial[1].accion, "descuento_cita");
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.occurrenceCount, 5);
  assert.equal(series.totalMinutes, 300);
  assert.equal(series.futureOccurrenceCount, 4);
  const log = activityLog(db, "recurring_series_schedule_replaced");
  assert.deepEqual(log.createdAppointmentIds, result.createdAppointmentIds);
  assert.equal(log.minutesDelta, 60);
});

test("admin series replacement rejects blocked, full, conflicting, invalid cadence, and duplicate-index requests without writes", async (t) => {
  const failureCases = [
    ["blocked", (documents) => {
      documents["blocked_slots/block"] = { date: "2026-09-08", time: "11:00" };
    }, "slot_blocked", { endDate: "2026-09-22" }],
    ["full", (documents) => {
      addOccupancy(documents, "2026-09-08", "11:00", 2);
    }, "slot_full", { endDate: "2026-09-22" }],
    ["same-user conflict", (documents) => {
      documents["appointments/external"] = futurePendingAppointment({
        preferredSlots: [{ date: "2026-09-08", time: "11:00" }],
        approvedSlot: { date: "2026-09-08", time: "11:00" },
        date: "2026-09-08",
        time: "11:00",
        status: "approved",
        recurrenceSeriesId: "other-series",
      });
    }, "appointment_conflict", { endDate: "2026-09-22" }],
    ["outside schedule", () => {}, "outside_schedule", { startSlot: { date: "2026-09-08", time: "07:00" }, endDate: "2026-09-22" }],
    ["non-cadence end", () => {}, "invalid_end_date", { endDate: "2026-09-23" }],
    ["duplicate global index", (documents) => {
      documents["appointments/cancelled-4"] = {
        ...documents["appointments/cancelled-4"],
        recurrenceIndex: 1,
      };
    }, "duplicate_recurrence_index", { endDate: "2026-09-22" }],
  ];

  for (const [label, mutate, reason, requestOverrides] of failureCases) {
    await t.test(label, async () => {
      const documents = recurringSeriesFixture();
      mutate(documents);
      const db = new FakeFirestore(documents);
      const before = snapshotDocuments(db);
      await assert.rejects(
        createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
          auth: { uid: "admin-1", token: {} },
          data: {
            appointmentId: "future-1",
            startSlot: { date: "2026-09-08", time: "11:00" },
            endDate: "2026-09-22",
            assignedTrainer: "trainer-2",
            ...requestOverrides,
          },
        }),
        (error) => error.code === "failed-precondition" && error.details.reason === reason,
      );
      assertNoWrites(db, before);
    });
  }
});

test("admin series replacement rejects expired, insufficient, inconsistent, and already-refunded future reservations without writes", async (t) => {
  const failureCases = [
    ["expired", { bono: { fechaExpiracion: "2026-08-31T23:59:59.000Z" } }, "bono_unavailable"],
    ["insufficient", { bono: { minutosRestantes: 30 } }, "insufficient_bono_minutes"],
    ["inconsistent", { records: { "future-2": { minutesDeductedAmount: 45 } } }, "invalid_financial_reservation"],
    ["already refunded", { records: { "future-3": { minutesRefunded: true, minutesRefundedAt: "2026-08-20T10:00:00.000Z" } } }, "invalid_financial_reservation"],
  ];

  for (const [label, overrides, reason] of failureCases) {
    await t.test(label, async () => {
      const db = new FakeFirestore(recurringSeriesFixture(overrides));
      const before = snapshotDocuments(db);
      await assert.rejects(
        createHandlers(db).replaceRecurringSeriesScheduleFromAdmin({
          auth: { uid: "admin-1", token: {} },
          data: {
            appointmentId: "future-1",
            startSlot: { date: "2026-09-08", time: "11:00" },
            endDate: "2026-09-29",
            assignedTrainer: "trainer-2",
          },
        }),
        (error) => error.code === "failed-precondition" && error.details.reason === reason,
      );
      assertNoWrites(db, before);
    });
  }
});
