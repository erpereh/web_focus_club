const assert = require("node:assert/strict");
const test = require("node:test");

const { createRecurringRescheduleHandlers } = require("../lib/recurringReschedule.js");
const { getCanonicalSlotBlocks, slotOccupancyDocId } = require("../lib/appointmentLifecycle.js");
const { calculateActiveSeriesMetadata } = require("../lib/recurringScheduleReplacement.js");

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
    this.kind = "doc";
  }
}

class FakeQuery {
  constructor(db, collectionName, filters = []) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
    this.kind = "query";
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, operator, value }]);
  }
}

class FakeCollection extends FakeQuery {
  constructor(db, collectionName) { super(db, collectionName); }
  doc(id) {
    const nextId = id ?? `auto-${++this.db.autoId}`;
    return new FakeDocumentReference(this.db, `${this.collectionName}/${nextId}`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function matches(actual, filter) {
  if (filter.operator === "==") return actual === filter.value;
  if (filter.operator === "in") return filter.value.includes(actual);
  if (filter.operator === ">=") return actual >= filter.value;
  if (filter.operator === "<=") return actual <= filter.value;
  throw new Error(`unsupported operator ${filter.operator}`);
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
    let writeStarted = false;
    const transaction = {
      get: async (target) => {
        if (writeStarted) throw new Error("read after write");
        this.operations.push({ type: "read", target: target.path ?? target.collectionName });
        if (target.kind === "doc") {
          const value = this.documents.get(target.path);
          return {
            id: target.id,
            ref: target,
            exists: value !== undefined,
            data: () => value === undefined ? undefined : clone(value),
          };
        }
        const prefix = `${target.collectionName}/`;
        const docs = [...this.documents.entries()]
          .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
          .map(([path, value]) => ({
            id: path.slice(prefix.length),
            ref: new FakeDocumentReference(this, path),
            exists: true,
            data: () => clone(value),
          }))
          .filter((snapshot) => target.filters.every((filter) => matches(snapshot.data()[filter.field], filter)));
        return { docs, empty: docs.length === 0 };
      },
      set: (ref, value, options) => {
        writeStarted = true;
        const deleteFields = Object.entries(value)
          .filter(([, fieldValue]) => fieldValue?.constructor?.name === "DeleteTransform")
          .map(([field]) => field);
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        staged.push({ ref, value: clone(value), merge: options?.merge === true, deleteFields });
      },
      create: (ref, value) => {
        writeStarted = true;
        this.operations.push({ type: "write", target: ref.path, value: clone(value) });
        staged.push({ ref, value: clone(value), merge: false, deleteFields: [] });
      },
    };
    const result = await callback(transaction);
    staged.forEach(({ ref, value, merge, deleteFields }) => {
      const previous = this.documents.get(ref.path) ?? {};
      const next = merge ? { ...previous, ...value } : value;
      deleteFields.forEach((field) => delete next[field]);
      this.documents.set(ref.path, next);
    });
    return result;
  }
}

const now = new Date("2026-09-01T08:00:00.000Z");
const duration = 60;

function reservation(status, recurrenceIndex, date, extras = {}) {
  const slot = { date, time: "10:00" };
  return {
    userId: "user-1",
    name: "Cliente histórico",
    email: "old@example.com",
    phone: "600000000",
    serviceType: "Entrenamiento",
    sessionType: "Personal",
    duration: "60",
    status,
    preferredSlots: [slot],
    date: slot.date,
    time: slot.time,
    ...(status === "approved" ? { approvedSlot: slot, assignedTrainer: "trainer-1" } : {}),
    recurrenceSeriesId: "series-1",
    recurrenceIndex,
    bonoId: "bono-1",
    minutesDeducted: true,
    minutesDeductedAmount: duration,
    minutesDeductedAt: "2026-08-01T10:00:00.000Z",
    minutesRefunded: false,
    minutesRefundedAmount: null,
    minutesRefundedAt: null,
    minutesRefundReason: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...extras,
  };
}

function baseDocuments() {
  const documents = {
    "appointment_recurrences/series-1": {
      userId: "user-1",
      status: "approved",
      intervalDays: 7,
      startDate: "2026-08-25",
      startTime: "10:00",
      endDate: "2026-09-17",
      duration: "60",
      serviceType: "Entrenamiento",
      bonoId: "bono-1",
      occurrenceCount: 3,
      totalMinutes: 180,
      assignedTrainer: "trainer-1",
    },
    "appointments/historical": reservation("approved", 0, "2026-08-25"),
    "appointments/future-approved": reservation("approved", 1, "2026-09-10", {
      googleCalendarEventId: "event-approved",
      googleCalendarSyncStatus: "synced",
    }),
    "appointments/cancelled": reservation("cancelled", 2, "2026-09-12", {
      minutesRefunded: true,
      minutesRefundedAmount: 60,
      minutesRefundedAt: "2026-08-20T10:00:00.000Z",
    }),
    "appointments/future-pending": reservation("pending", 3, "2026-09-17"),
    "appointments/rejected": reservation("rejected", 4, "2026-09-24"),
    "bonos/bono-1": {
      userId: "user-1",
      estado: "activo",
      tamano: 600,
      minutosTotales: 600,
      minutosRestantes: 300,
      fechaExpiracion: "2026-12-31",
      historial: [],
    },
    "users/user-1": {
      name: "Cliente actual",
      email: "actual@example.com",
      phone: "611111111",
    },
    "site_config/main": {
      startHour: 8,
      endHour: 21,
      slotInterval: 30,
      maxCapacity: 3,
    },
  };
  getCanonicalSlotBlocks("10:00", duration).forEach((time) => {
    const key = slotOccupancyDocId("2026-09-10", time);
    documents[`slot_occupancy/${key}`] = { date: "2026-09-10", time, count: 1 };
  });
  return documents;
}

function handlersFor(db, currentNow = now) {
  return createRecurringRescheduleHandlers({
    db,
    requireAdmin: async () => { throw new Error("customer callable must not require admin"); },
    getNowDate: () => currentNow,
  });
}

function snapshot(db) {
  return clone([...db.documents.entries()]);
}

function assertNoWrites(db, before) {
  assert.deepEqual([...db.documents.entries()], before);
  assert.equal(db.operations.some((operation) => operation.type === "write"), false);
}

function requestFor(overrides = {}, uid = "user-1") {
  return {
    auth: { uid, token: {} },
    data: {
      appointmentId: "future-approved",
      startSlot: { date: "2026-09-11", time: "12:00" },
      intervalDays: 3,
      endDate: "2026-09-17",
      ...overrides,
    },
  };
}

test("customer replaces a mixed future series with deterministic reuse/create results", async () => {
  const db = new FakeFirestore(baseDocuments());
  const handlers = handlersFor(db);
  assert.equal(typeof handlers.replaceOwnRecurringSeriesSchedule, "function");

  const response = await handlers.replaceOwnRecurringSeriesSchedule({
    auth: { uid: "user-1", token: {} },
    data: {
      appointmentId: "future-approved",
      startSlot: { date: "2026-09-11", time: "12:00" },
      intervalDays: 3,
      endDate: "2026-09-17",
    },
  });

  assert.deepEqual(response, {
    success: true,
    seriesId: "series-1",
    affectedAppointmentIds: ["future-approved", "future-pending", "auto-1"],
    reusedAppointmentIds: ["future-approved", "future-pending"],
    createdAppointmentIds: ["auto-1"],
    cancelledAppointmentIds: [],
    occurrenceCount: 4,
    totalMinutes: 240,
    status: "pending",
  });
  assert.equal(db.documents.get("appointments/historical").status, "approved");
  assert.equal(db.documents.get("appointments/cancelled").status, "cancelled");
  assert.equal(db.documents.get("appointments/rejected").status, "rejected");
  assert.deepEqual(db.documents.get("appointments/future-approved").preferredSlots[0], { date: "2026-09-11", time: "12:00" });
  assert.equal(db.documents.get("appointments/future-approved").status, "pending");
  assert.equal(db.documents.get("appointments/future-approved").googleCalendarEventId, "event-approved");
  assert.equal(db.documents.get("appointments/future-approved").sessionType, "Personal");
  assert.equal(db.documents.get("appointments/auto-1").recurrenceIndex, 5);
  assert.equal(db.documents.get("appointments/auto-1").name, "Cliente actual");
  assert.equal(db.documents.get("appointments/auto-1").status, "pending");
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 240);

  getCanonicalSlotBlocks("10:00", duration).forEach((time) => {
    assert.equal(db.documents.get(`slot_occupancy/2026-09-10_${time}`).count, 0);
  });
  const series = db.documents.get("appointment_recurrences/series-1");
  assert.equal(series.status, "pending");
  assert.equal(series.intervalDays, 3);
  assert.equal(series.occurrenceCount, 4);
  assert.equal(series.totalMinutes, 240);
  assert.equal(series.futureOccurrenceCount, 3);
  assert.equal(series.futureStartDate, "2026-09-11");
  assert.equal(series.futureEndDate, "2026-09-17");
  assert.equal(series.startDate, "2026-08-25", "historical start remains immutable");
  const log = [...db.documents.entries()].find(([path]) => path.startsWith("activity_logs/"))[1];
  assert.equal(log.action, "customer_recurring_series_schedule_replaced");
  assert.deepEqual(log.affectedAppointmentIds, response.affectedAppointmentIds);
  assert.deepEqual(log.reusedAppointmentIds, response.reusedAppointmentIds);
  assert.deepEqual(log.createdAppointmentIds, response.createdAppointmentIds);
  assert.deepEqual(log.cancelledAppointmentIds, response.cancelledAppointmentIds);
  assert.equal("email" in log, false);
  assert.equal("phone" in log, false);
  assert.equal("name" in log, false);
  const firstWrite = db.operations.findIndex((operation) => operation.type === "write");
  assert.ok(firstWrite > 0);
  assert.ok(db.operations.slice(firstWrite).every((operation) => operation.type === "write"));
});

test("customer series replacement keeps bono untouched for a zero delta", async () => {
  const db = new FakeFirestore(baseDocuments());
  const beforeBono = clone(db.documents.get("bonos/bono-1"));
  const response = await handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({
    endDate: "2026-09-14",
  }));

  assert.deepEqual(response.reusedAppointmentIds, ["future-approved", "future-pending"]);
  assert.deepEqual(response.createdAppointmentIds, []);
  assert.deepEqual(response.cancelledAppointmentIds, []);
  assert.deepEqual(response.affectedAppointmentIds, ["future-approved", "future-pending"]);
  assert.deepEqual(db.documents.get("bonos/bono-1"), beforeBono);
  assert.equal(db.operations.some((operation) => operation.type === "write" && operation.target === "bonos/bono-1"), false);
});

test("customer series reduction refunds once and returns deterministic ordered arrays", async () => {
  const documents = baseDocuments();
  documents["appointments/future-third"] = reservation("approved", 5, "2026-09-24");
  documents["appointment_recurrences/series-1"].occurrenceCount = 4;
  documents["appointment_recurrences/series-1"].totalMinutes = 240;
  getCanonicalSlotBlocks("10:00", duration).forEach((time) => {
    const key = slotOccupancyDocId("2026-09-24", time);
    documents[`slot_occupancy/${key}`] = { date: "2026-09-24", time, count: 1 };
  });
  const db = new FakeFirestore(documents);

  const response = await handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" }));

  assert.deepEqual(response.reusedAppointmentIds, ["future-approved", "future-pending"]);
  assert.deepEqual(response.createdAppointmentIds, []);
  assert.deepEqual(response.cancelledAppointmentIds, ["future-third"]);
  assert.deepEqual(response.affectedAppointmentIds, ["future-approved", "future-pending", "future-third"]);
  const cancelled = db.documents.get("appointments/future-third");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledBy, "user-1");
  assert.equal(cancelled.cancellationReason, "customer_series_schedule_reduction");
  assert.equal(cancelled.minutesRefunded, true);
  assert.equal(cancelled.minutesRefundedAmount, 60);
  assert.equal(db.documents.get("bonos/bono-1").minutosRestantes, 360);
  assert.equal(response.occurrenceCount, 3);
  assert.equal(response.totalMinutes, 180);
});

test("expired bonos allow reduction but reject expansion", async (t) => {
  await t.test("reduction", async () => {
    const documents = baseDocuments();
    documents["appointments/future-third"] = reservation("approved", 5, "2026-09-24");
    documents["appointment_recurrences/series-1"].occurrenceCount = 4;
    documents["appointment_recurrences/series-1"].totalMinutes = 240;
    documents["bonos/bono-1"].estado = "expirado";
    documents["bonos/bono-1"].fechaExpiracion = "2026-08-31";
    getCanonicalSlotBlocks("10:00", duration).forEach((time) => {
      const key = slotOccupancyDocId("2026-09-24", time);
      documents[`slot_occupancy/${key}`] = { date: "2026-09-24", time, count: 1 };
    });
    const response = await handlersFor(new FakeFirestore(documents))
      .replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" }));
    assert.deepEqual(response.cancelledAppointmentIds, ["future-third"]);
  });

  await t.test("expansion", async () => {
    const documents = baseDocuments();
    documents["bonos/bono-1"].estado = "expirado";
    documents["bonos/bono-1"].fechaExpiracion = "2026-08-31";
    const db = new FakeFirestore(documents);
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor()),
      (error) => error.details.reason === "bono_unavailable",
    );
    assertNoWrites(db, before);
  });
});

test("invalid future reservation structure and invalid cadence abort without writes", async (t) => {
  const cases = [
    ["invalid index", (documents) => {
      documents["appointments/future-pending"].recurrenceIndex = 1.5;
    }, {}, "recurring_occurrence_unavailable"],
    ["invalid duration", (documents) => {
      documents["appointments/future-pending"].duration = "15";
    }, {}, "recurring_occurrence_unavailable"],
    ["invalid cadence", () => {}, { intervalDays: 4, endDate: "2026-09-17" }, "invalid_series_length"],
  ];
  for (const [label, mutate, overrides, reason] of cases) {
    await t.test(label, async () => {
      const documents = baseDocuments();
      mutate(documents);
      const db = new FakeFirestore(documents);
      const before = snapshot(db);
      await assert.rejects(
        handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor(overrides)),
        (error) => error.details.reason === reason,
      );
      assertNoWrites(db, before);
    });
  }
});

test("customer replacement rejects ownership and unavailable bonos atomically", async (t) => {
  await t.test("unauthenticated", async () => {
    const db = new FakeFirestore(baseDocuments());
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule({ auth: undefined, data: requestFor().data }),
      (error) => error.code === "permission-denied",
    );
    assertNoWrites(db, before);
  });

  await t.test("foreign owner", async () => {
    const db = new FakeFirestore(baseDocuments());
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({}, "user-2")),
      (error) => error.code === "permission-denied",
    );
    assertNoWrites(db, before);
  });

  await t.test("deleted bono", async () => {
    const documents = baseDocuments();
    documents["bonos/bono-1"].estado = "eliminado";
    const db = new FakeFirestore(documents);
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" })),
      (error) => error.code === "failed-precondition" && error.details.reason === "bono_unavailable",
    );
    assertNoWrites(db, before);
  });
});

test("customer replacement enforces blocked, capacity and own-conflict checks atomically", async (t) => {
  const cases = [
    ["blocked", (documents) => {
      documents["blocked_slots/blocked"] = { date: "2026-09-11", time: "12:00" };
    }, "slot_blocked"],
    ["full", (documents) => {
      getCanonicalSlotBlocks("12:00", duration).forEach((time) => {
        const key = slotOccupancyDocId("2026-09-11", time);
        documents[`slot_occupancy/${key}`] = { date: "2026-09-11", time, count: 3 };
      });
    }, "slot_full"],
    ["conflict", (documents) => {
      documents["appointments/external"] = {
        ...reservation("pending", 99, "2026-09-11"),
        recurrenceSeriesId: "other-series",
        approvedSlot: undefined,
        preferredSlots: [{ date: "2026-09-11", time: "12:00" }],
        date: "2026-09-11",
        time: "12:00",
      };
    }, "appointment_conflict"],
  ];
  for (const [label, mutate, reason] of cases) {
    await t.test(label, async () => {
      const documents = baseDocuments();
      mutate(documents);
      const db = new FakeFirestore(documents);
      const before = snapshot(db);
      await assert.rejects(
        handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" })),
        (error) => error.code === "failed-precondition" && error.details.reason === reason,
      );
      assertNoWrites(db, before);
    });
  }
});

test("customer replacement uses an inclusive real 24-hour lock window", async (t) => {
  await t.test("current occurrence exactly 24 hours away", async () => {
    const documents = baseDocuments();
    const exact = { date: "2026-09-02", time: "10:00" };
    Object.assign(documents["appointments/future-approved"], {
      approvedSlot: exact,
      preferredSlots: [exact],
      date: exact.date,
      time: exact.time,
    });
    const db = new FakeFirestore(documents);
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" })),
      (error) => error.details.reason === "one_day_change_not_allowed",
    );
    assertNoWrites(db, before);
  });

  await t.test("destination 23 hours 59 minutes away", async () => {
    const db = new FakeFirestore(baseDocuments());
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({
        startSlot: { date: "2026-09-02", time: "09:59" },
        intervalDays: 1,
        endDate: "2026-09-03",
      })),
      (error) => error.details.reason === "one_day_change_not_allowed",
    );
    assertNoWrites(db, before);
  });

  await t.test("destination exactly 24 hours away", async () => {
    const db = new FakeFirestore(baseDocuments());
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({
        startSlot: { date: "2026-09-02", time: "10:00" },
        intervalDays: 1,
        endDate: "2026-09-03",
      })),
      (error) => error.details.reason === "one_day_change_not_allowed",
    );
    assertNoWrites(db, before);
  });

  await t.test("destination 25 hours away is accepted", async () => {
    const db = new FakeFirestore(baseDocuments());
    const response = await handlersFor(db).replaceOwnRecurringSeriesSchedule(requestFor({
      startSlot: { date: "2026-09-02", time: "11:00" },
      intervalDays: 1,
      endDate: "2026-09-03",
    }));
    assert.equal(response.success, true);
  });
});

test("active metadata includes historical pending and approved but excludes cancelled and rejected", () => {
  const historicalApprovedFuturePending = calculateActiveSeriesMetadata([
    { data: reservation("approved", 0, "2026-08-25", { duration: "30" }) },
    { data: reservation("pending", 1, "2026-09-10", { duration: "45" }) },
  ], now);
  assert.equal(historicalApprovedFuturePending.occurrenceCount, 2);
  assert.equal(historicalApprovedFuturePending.totalMinutes, 75);
  assert.equal(historicalApprovedFuturePending.futureOccurrenceCount, 1);

  const historicalApprovedFutureApproved = calculateActiveSeriesMetadata([
    { data: reservation("approved", 0, "2026-08-25", { duration: "30" }) },
    { data: reservation("approved", 1, "2026-09-11", { duration: "60" }) },
  ], now);
  assert.equal(historicalApprovedFutureApproved.occurrenceCount, 2);
  assert.equal(historicalApprovedFutureApproved.totalMinutes, 90);
  assert.equal(historicalApprovedFutureApproved.futureOccurrenceCount, 1);

  const metadata = calculateActiveSeriesMetadata([
    { data: reservation("approved", 0, "2026-08-25", { duration: "30" }) },
    { data: reservation("pending", 1, "2026-08-26", { duration: "45" }) },
    { data: reservation("pending", 2, "2026-09-10", { duration: "45" }) },
    { data: reservation("approved", 3, "2026-09-11", { duration: "60" }) },
    { data: reservation("cancelled", 4, "2026-09-12") },
    { data: reservation("rejected", 5, "2026-09-13") },
  ], now);

  assert.deepEqual(metadata, {
    occurrenceCount: 4,
    totalMinutes: 180,
    futureOccurrenceCount: 2,
    futureStartDate: "2026-09-10",
    futureStartTime: "10:00",
    futureEndDate: "2026-09-11",
  });
});

test("invalid civil slots use the safe-date fallback and reject non-historical DST gaps", async (t) => {
  await t.test("invalid slot with a safely past civil date remains historical", async () => {
    const documents = baseDocuments();
    Object.assign(documents["appointments/historical"], {
      approvedSlot: { date: "invalid", time: "invalid" },
      preferredSlots: [{ date: "2026-08-25", time: "invalid" }],
      date: "2026-08-25",
      time: "invalid",
    });
    const response = await handlersFor(new FakeFirestore(documents))
      .replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" }));
    assert.equal(response.success, true);
    assert.equal(response.occurrenceCount, 3);
  });

  await t.test("non-existent future Madrid wall time aborts", async () => {
    const documents = baseDocuments();
    const gap = { date: "2026-03-29", time: "02:30" };
    Object.assign(documents["appointments/future-approved"], {
      approvedSlot: gap,
      preferredSlots: [gap],
      date: gap.date,
      time: gap.time,
    });
    const db = new FakeFirestore(documents);
    const before = snapshot(db);
    await assert.rejects(
      handlersFor(db, new Date("2026-03-28T09:00:00.000Z"))
        .replaceOwnRecurringSeriesSchedule(requestFor({ endDate: "2026-09-14" })),
      (error) => error.details.reason === "recurring_occurrence_unavailable"
        && error.details.problematicAppointmentId === "future-approved",
    );
    assertNoWrites(db, before);
  });
});
