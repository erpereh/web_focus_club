const assert = require("node:assert/strict");

const {
  buildRecurringAppointmentPatch,
  buildRecurringRescheduleActivityLog,
  buildRecurringRescheduleSeriesPatch,
  createRecurringRescheduleHandlers,
  parseRecurringRescheduleRequest,
  prepareRecurringReschedule,
  validateRecurringRescheduleAvailability,
} = require("../lib/recurringReschedule.js");

const now = new Date("2026-09-01T08:00:00.000Z"); // 10:00 Europe/Madrid
const siteConfig = { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 };
const baseFields = {
  userId: "user-1",
  name: "Cliente",
  email: "client@example.com",
  phone: "600000000",
  status: "approved",
  duration: "60",
  serviceType: "Entrenamiento",
  sessionType: "Personal",
  assignedTrainer: "trainer-1",
  bonoId: "bono-1",
  minutesDeducted: true,
  minutesDeductedAmount: 60,
  minutesDeductedAt: "2026-08-01T10:00:00.000Z",
  minutesRefunded: false,
  minutesRefundedAmount: null,
  minutesRefundedAt: null,
  minutesRefundReason: null,
  recurrenceSeriesId: "series-1",
  createdAt: "2026-08-01T10:00:00.000Z",
  googleCalendarEventId: "event-1",
  googleCalendarSyncedAt: "2026-08-02T10:00:00.000Z",
  googleCalendarSyncStatus: "synced",
  googleCalendarSyncHash: "hash-1",
};

function occurrence(id, recurrenceIndex, date, status = "approved", time = "10:00") {
  const slot = { date, time };
  return {
    id,
    data: {
      ...baseFields,
      status,
      recurrenceIndex,
      preferredSlots: [slot],
      approvedSlot: slot,
      date,
      time,
    },
  };
}

const occurrences = [
  occurrence("a0", 0, "2026-09-07"),
  occurrence("a1", 1, "2026-09-14"),
  occurrence("a2", 2, "2026-09-21", "cancelled"),
  occurrence("a3", 3, "2026-09-28"),
  occurrence("a4", 4, "2026-10-05", "pending"),
];
const series = {
  id: "series-1",
  status: "approved",
  userId: "user-1",
  intervalDays: 7,
  endDate: "2026-10-05",
};

function prepare(overrides = {}) {
  return prepareRecurringReschedule({
    selectedAppointmentId: "a1",
    preferredSlot: { date: "2026-09-20", time: "19:00" },
    scope: "following",
    actorType: "admin",
    actorUid: "admin-1",
    now,
    series,
    occurrences,
    ...overrides,
  });
}

function emptyOccupancy(draft, count) {
  return new Map(draft.occupancyKeys.map((key) => [
    key,
    count ?? Math.max(0, -(draft.occupancyDelta.get(key) ?? 0)),
  ]));
}

function validate(draft, overrides = {}) {
  return validateRecurringRescheduleAvailability({
    draft,
    siteConfig,
    blockedKeys: new Set(),
    occupancyByKey: emptyOccupancy(draft),
    userAppointments: occurrences,
    ...overrides,
  });
}

assert.deepEqual(parseRecurringRescheduleRequest({
  appointmentId: " a1 ",
  preferredSlot: { date: "2026-09-20", time: "19:00" },
  scope: "single",
}), {
  appointmentId: "a1",
  preferredSlot: { date: "2026-09-20", time: "19:00" },
  scope: "single",
});
assert.equal(parseRecurringRescheduleRequest({ appointmentId: "a1", preferredSlot: {}, scope: "single" }), undefined);
assert.equal(parseRecurringRescheduleRequest({ appointmentId: "a1", preferredSlot: { date: "2026-09-20", time: "19:00" }, scope: "all" }), undefined);

const single = prepare({ scope: "single" });
assert.equal(single.ok, true);
assert.deepEqual(single.draft.affected.map((item) => item.appointment.id), ["a1"]);
assert.deepEqual(single.draft.affected[0].newSlot, { date: "2026-09-20", time: "19:00" });

const following = prepare();
assert.equal(following.ok, true);
assert.deepEqual(following.draft.affected.map((item) => item.appointment.id), ["a1", "a3"]);
assert.deepEqual(following.draft.affected.map((item) => item.newSlot), [
  { date: "2026-09-20", time: "19:00" },
  { date: "2026-10-04", time: "19:00" },
]);
assert.equal(following.draft.seriesEndDate, "2026-10-05", "pending occurrence remains part of the effective series end");

const inconsistentOwner = prepare({ series: { ...series, userId: "other-user" } });
assert.equal(inconsistentOwner.ok, false);
assert.equal(inconsistentOwner.error.reason, "recurring_occurrence_unavailable");

const pastAndPrevious = prepare({
  now: new Date("2026-09-25T08:00:00.000Z"),
  selectedAppointmentId: "a3",
  preferredSlot: { date: "2026-10-01", time: "10:00" },
});
assert.equal(pastAndPrevious.ok, true);
assert.deepEqual(pastAndPrevious.draft.affected.map((item) => item.appointment.id), ["a3"]);

const customerToday = prepare({
  actorType: "customer",
  actorUid: "user-1",
  preferredSlot: { date: "2026-09-01", time: "19:00" },
});
assert.equal(customerToday.ok, false);
assert.equal(customerToday.error.reason, "same_day_change_not_allowed");

const customerTodayPastTarget = prepare({
  actorType: "customer",
  actorUid: "user-1",
  preferredSlot: { date: "2026-09-01", time: "09:00" },
});
assert.equal(customerTodayPastTarget.ok, false);
assert.equal(customerTodayPastTarget.error.reason, "same_day_change_not_allowed");

const customerExistingTodayPast = prepare({
  actorType: "customer",
  actorUid: "user-1",
  selectedAppointmentId: "today",
  preferredSlot: { date: "2026-09-02", time: "19:00" },
  occurrences: [occurrence("today", 0, "2026-09-01", "approved", "09:00")],
  series: { ...series, endDate: "2026-09-01" },
});
assert.equal(customerExistingTodayPast.ok, false);
assert.equal(customerExistingTodayPast.error.reason, "same_day_change_not_allowed");

const adminTodayFuture = prepare({ preferredSlot: { date: "2026-09-01", time: "19:00" } });
assert.equal(adminTodayFuture.ok, true);
const adminTodayPast = prepare({ preferredSlot: { date: "2026-09-01", time: "09:00" } });
assert.equal(adminTodayPast.ok, false);
assert.equal(adminTodayPast.error.reason, "slot_not_future");

const sameSlot = prepare({ scope: "single", preferredSlot: { date: "2026-09-14", time: "10:00" } });
assert.equal(sameSlot.ok, true);
assert.ok(sameSlot.draft.occupancyKeys.length > 0);
assert.ok([...sameSlot.draft.occupancyDelta.values()].every((delta) => delta === 0));
const sameSlotValidation = validate(sameSlot.draft, { occupancyByKey: emptyOccupancy(sameSlot.draft, 1) });
assert.equal(sameSlotValidation.ok, true);
assert.deepEqual(sameSlotValidation.plan.occupancyWrites, []);
const missingCountOnExistingOccupancy = emptyOccupancy(sameSlot.draft, 1);
missingCountOnExistingOccupancy.set(sameSlot.draft.occupancyKeys[0], null);
const missingCountResult = validate(sameSlot.draft, { occupancyByKey: missingCountOnExistingOccupancy });
assert.equal(missingCountResult.ok, false);
assert.equal(missingCountResult.error.reason, "invalid_occupancy");

const invalidOccupancy = validate(following.draft, {
  occupancyByKey: new Map(following.draft.occupancyKeys.map((key, index) => [key, index === 0 ? -1 : 0])),
});
assert.equal(invalidOccupancy.ok, false);
assert.equal(invalidOccupancy.error.reason, "invalid_occupancy");

const fractionalOccupancy = validate(following.draft, {
  occupancyByKey: new Map(following.draft.occupancyKeys.map((key, index) => [key, index === 0 ? 0.5 : 0])),
});
assert.equal(fractionalOccupancy.ok, false);
assert.equal(fractionalOccupancy.error.reason, "invalid_occupancy");

const firstNewKey = following.draft.affected[0].newKeys[0];
const fullOccupancy = emptyOccupancy(following.draft);
fullOccupancy.set(firstNewKey, 2);
const full = validate(following.draft, { occupancyByKey: fullOccupancy });
assert.equal(full.ok, false);
assert.equal(full.error.reason, "slot_full");
assert.equal(full.error.scope, "following");
assert.deepEqual(full.error.problematicSlot, { date: "2026-09-20", time: "19:00" });
assert.equal(full.error.problematicAppointmentId, "a1");

const blocked = validate(following.draft, { blockedKeys: new Set([firstNewKey]) });
assert.equal(blocked.ok, false);
assert.equal(blocked.error.reason, "slot_blocked");
assert.equal(blocked.error.problematicAppointmentId, "a1");

const outside = prepare({ preferredSlot: { date: "2026-09-20", time: "20:00" } });
assert.equal(outside.ok, true);
const outsideResult = validate(outside.draft);
assert.equal(outsideResult.ok, false);
assert.equal(outsideResult.error.reason, "outside_schedule");

const conflictAppointment = occurrence("other", 99, "2026-09-20", "pending", "19:00");
conflictAppointment.data.recurrenceSeriesId = "other-series";
const conflict = validate(following.draft, { userAppointments: [...occurrences, conflictAppointment] });
assert.equal(conflict.ok, false);
assert.equal(conflict.error.reason, "appointment_conflict");
assert.equal(conflict.error.problematicAppointmentId, "a1");

const valid = validate(following.draft);
assert.equal(valid.ok, true);
assert.ok(valid.plan.occupancyWrites.every((write) => write.delta !== 0));
assert.ok(valid.plan.occupancyWrites.every((write) => Number.isInteger(write.finalCount) && write.finalCount >= 0));

const appointmentPatch = buildRecurringAppointmentPatch(
  { date: "2026-09-20", time: "19:00" },
  "admin-1",
  "2026-09-01T08:00:00.000Z",
);
assert.deepEqual(Object.keys(appointmentPatch).sort(), [
  "approvedSlot",
  "date",
  "modifiedAt",
  "modifiedBy",
  "preferredSlots",
  "time",
  "updatedAt",
].sort());

const protectedFields = [
  "status", "assignedTrainer", "duration", "serviceType", "sessionType", "bonoId",
  "minutesDeducted", "minutesDeductedAmount", "minutesDeductedAt", "minutesRefunded",
  "minutesRefundedAmount", "minutesRefundedAt", "minutesRefundReason", "recurrenceSeriesId",
  "recurrenceIndex", "createdAt", "googleCalendarEventId", "googleCalendarSyncedAt",
  "googleCalendarSyncStatus", "googleCalendarSyncHash",
];
protectedFields.forEach((field) => assert.ok(!(field in appointmentPatch), `${field} must not be patched`));

assert.deepEqual(buildRecurringRescheduleSeriesPatch({
  now: "2026-09-01T08:00:00.000Z",
  actorUid: "admin-1",
  scope: "following",
  selectedIndex: 1,
  anchorSlot: { date: "2026-09-20", time: "19:00" },
  currentEndDate: "2026-09-28",
  effectiveEndDate: "2026-10-04",
}), {
  updatedAt: "2026-09-01T08:00:00.000Z",
  lastRescheduledAt: "2026-09-01T08:00:00.000Z",
  lastRescheduledByUid: "admin-1",
  lastRescheduleScope: "following",
  lastRescheduleFromIndex: 1,
  lastRescheduleAnchorSlot: { date: "2026-09-20", time: "19:00" },
  endDate: "2026-10-04",
});

assert.deepEqual(buildRecurringRescheduleActivityLog({
  actorType: "admin",
  actorUid: "admin-1",
  seriesId: "series-1",
  appointmentId: "a1",
  scope: "following",
  affectedAppointmentIds: ["a1", "a3"],
  oldAnchorSlot: { date: "2026-09-14", time: "10:00" },
  newAnchorSlot: { date: "2026-09-20", time: "19:00" },
  createdAt: "2026-09-01T08:00:00.000Z",
}), {
  action: "recurring_appointment_rescheduled",
  actorType: "admin",
  actorUid: "admin-1",
  seriesId: "series-1",
  appointmentId: "a1",
  scope: "following",
  affectedAppointmentIds: ["a1", "a3"],
  affectedCount: 2,
  oldAnchorSlot: { date: "2026-09-14", time: "10:00" },
  newAnchorSlot: { date: "2026-09-20", time: "19:00" },
  createdAt: "2026-09-01T08:00:00.000Z",
});

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
  constructor(db, collectionName) {
    super(db, collectionName);
  }
  doc(id) {
    const nextId = id ?? `auto-${++this.db.autoId}`;
    return new FakeDocumentReference(this.db, `${this.collectionName}/${nextId}`);
  }
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.operations = [];
    this.autoId = 0;
  }
  collection(name) { return new FakeCollection(this, name); }
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
            data: () => data,
          };
        }
        const prefix = `${target.collectionName}/`;
        const docs = [...this.documents.entries()]
          .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
          .map(([path, data]) => ({
            id: path.slice(prefix.length),
            ref: new FakeDocumentReference(this, path),
            exists: true,
            data: () => data,
          }))
          .filter((snap) => target.filters.every(({ field, operator, value }) => {
            const actual = snap.data()[field];
            if (operator === "==") return actual === value;
            if (operator === "in") return value.includes(actual);
            throw new Error(`unsupported operator ${operator}`);
          }));
        return { docs, empty: docs.length === 0 };
      },
      set: (ref, value, options) => {
        firstWriteSeen = true;
        this.operations.push({ type: "write", target: ref.path });
        staged.push({ ref, value, merge: options?.merge === true });
      },
      create: (ref, value) => {
        firstWriteSeen = true;
        this.operations.push({ type: "write", target: ref.path });
        staged.push({ ref, value, merge: false });
      },
    };
    const result = await callback(transaction);
    staged.forEach(({ ref, value, merge }) => {
      const previous = this.documents.get(ref.path) ?? {};
      this.documents.set(ref.path, merge ? { ...previous, ...value } : value);
    });
    return result;
  }
}

function transactionDocuments() {
  const docs = {
    "appointments/a1": occurrences[1].data,
    "appointment_recurrences/series-1": {
      ...series,
      occurrenceCount: 5,
      totalMinutes: 300,
      bonoId: "bono-1",
      startDate: "2026-09-07",
      startTime: "10:00",
    },
    "site_config/main": siteConfig,
  };
  occurrences.forEach((item) => { docs[`appointments/${item.id}`] = item.data; });
  following.draft.occupancyKeys.forEach((key) => {
    docs[`slot_occupancy/${key}`] = {
      date: key.slice(0, 10),
      time: key.slice(11),
      count: Math.max(0, -(following.draft.occupancyDelta.get(key) ?? 0)),
    };
  });
  return docs;
}

async function runHandlerTests() {
  const fixedNow = new Date("2026-09-01T08:00:00.000Z");
  const db = new FakeFirestore(transactionDocuments());
  const handlers = createRecurringRescheduleHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  const response = await handlers.rescheduleRecurringAppointmentFromAdmin({
    auth: { uid: "admin-1", token: {} },
    data: {
      appointmentId: "a1",
      preferredSlot: { date: "2026-09-20", time: "19:00" },
      scope: "following",
    },
  });
  assert.equal(response.success, true);
  assert.deepEqual(response.affectedAppointmentIds, ["a1", "a3"]);
  const firstWrite = db.operations.findIndex((operation) => operation.type === "write");
  assert.ok(firstWrite > 0);
  assert.ok(db.operations.slice(firstWrite).every((operation) => operation.type === "write"));

  const updated = db.documents.get("appointments/a1");
  assert.equal(updated.status, "approved");
  protectedFields.forEach((field) => assert.deepEqual(updated[field], occurrences[1].data[field], `${field} changed`));
  assert.deepEqual(updated.approvedSlot, { date: "2026-09-20", time: "19:00" });
  assert.equal(updated.modifiedAt, fixedNow.toISOString());

  const seriesAfter = db.documents.get("appointment_recurrences/series-1");
  assert.equal(seriesAfter.lastRescheduledAt, fixedNow.toISOString());
  assert.equal(seriesAfter.bonoId, "bono-1");
  const log = [...db.documents.entries()].find(([path]) => path.startsWith("activity_logs/"))[1];
  assert.equal(log.action, "recurring_appointment_rescheduled");
  assert.equal("email" in log, false);
  assert.equal("phone" in log, false);
  assert.equal("bonoId" in log, false);

  const failingDocs = transactionDocuments();
  const fullKey = following.draft.affected[0].newKeys[0];
  failingDocs[`slot_occupancy/${fullKey}`] = {
    date: fullKey.slice(0, 10), time: fullKey.slice(11), count: 2,
  };
  const failingDb = new FakeFirestore(failingDocs);
  const failingHandlers = createRecurringRescheduleHandlers({
    db: failingDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    failingHandlers.rescheduleRecurringAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-20", time: "19:00" },
        scope: "following",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "slot_full",
  );
  assert.deepEqual(failingDb.documents, new Map(Object.entries(failingDocs)), "failed transaction must not persist writes");
}

runHandlerTests()
  .then(() => console.log("recurring reschedule tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
