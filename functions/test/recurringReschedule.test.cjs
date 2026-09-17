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
const { getSlotBlocks } = require("../lib/appointmentLifecycle.js");

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
assert.deepEqual(parseRecurringRescheduleRequest({
  appointmentId: "a1",
  preferredSlot: { date: "2026-09-20", time: "19:00" },
  scope: "series",
}), {
  appointmentId: "a1",
  preferredSlot: { date: "2026-09-20", time: "19:00" },
  scope: "series",
});
assert.equal(parseRecurringRescheduleRequest({
  appointmentId: "a1",
  preferredSlot: { date: "2026-09-20", time: "19:00" },
  scope: "following",
}).scope, "following");
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

const seriesNow = new Date("2026-09-16T08:00:00.000Z"); // 10:00 Europe/Madrid
const fullSeriesOccurrences = [
  occurrence("s0", 0, "2026-09-10"),
  occurrence("s1", 1, "2026-09-17"),
  occurrence("s2", 2, "2026-09-24"),
  occurrence("s3", 3, "2026-10-01"),
  occurrence("s4", 4, "2026-10-08"),
  occurrence("s5", 5, "2026-10-15", "cancelled"),
  occurrence("s6", 6, "2026-10-22", "rejected"),
  occurrence("s7", 7, "2026-10-29", "pending"),
];

function prepareSeries(overrides = {}) {
  return prepare({
    selectedAppointmentId: "s3",
    preferredSlot: { date: "2026-10-02", time: "19:00" },
    scope: "series",
    now: seriesNow,
    occurrences: fullSeriesOccurrences,
    series: { ...series, endDate: "2026-10-29" },
    ...overrides,
  });
}

const wholeSeries = prepareSeries();
assert.equal(wholeSeries.ok, true);
assert.deepEqual(wholeSeries.draft.affected.map((item) => item.appointment.id), ["s1", "s2", "s3", "s4"]);
assert.deepEqual(wholeSeries.draft.affected.map((item) => item.newSlot), [
  { date: "2026-09-18", time: "19:00" },
  { date: "2026-09-25", time: "19:00" },
  { date: "2026-10-02", time: "19:00" },
  { date: "2026-10-09", time: "19:00" },
]);
assert.equal(wholeSeries.draft.affected.some((item) => item.appointment.id === "s0"), false);
assert.equal(wholeSeries.draft.affected.some((item) => ["s5", "s6", "s7"].includes(item.appointment.id)), false);
assert.equal(wholeSeries.draft.seriesEndDate, "2026-10-29");
wholeSeries.draft.affected.forEach((item) => {
  assert.ok(item.oldKeys.length > 0);
  assert.ok(item.newKeys.length > 0);
  item.oldKeys.forEach((key) => assert.equal(wholeSeries.draft.occupancyDelta.get(key), -1));
  item.newKeys.forEach((key) => assert.equal(wholeSeries.draft.occupancyDelta.get(key), 1));
});

const fortnightlySeries = prepareSeries({
  preferredSlot: { date: "2026-10-30", time: "19:00" },
  series: { ...series, intervalDays: 14, endDate: "2026-10-29" },
});
assert.equal(fortnightlySeries.ok, true);
assert.deepEqual(fortnightlySeries.draft.affected.map((item) => item.newSlot.date), [
  "2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13",
]);
assert.equal(fortnightlySeries.draft.seriesEndDate, "2026-11-13");

const seriesWithGapsOccurrences = [
  occurrence("g0", 0, "2026-09-10"),
  occurrence("g1", 1, "2026-09-17"),
  occurrence("g2", 2, "2026-09-24", "cancelled"),
  occurrence("g3", 3, "2026-10-01"),
  occurrence("g4", 4, "2026-10-08"),
  occurrence("g5", 5, "2026-10-15", "rejected"),
  occurrence("g6", 6, "2026-10-22", "pending"),
];
const seriesWithGaps = prepareSeries({
  selectedAppointmentId: "g3",
  occurrences: seriesWithGapsOccurrences,
  series: { ...series, endDate: "2026-10-22" },
});
assert.equal(seriesWithGaps.ok, true);
assert.deepEqual(seriesWithGaps.draft.affected.map((item) => item.appointment.id), ["g1", "g3", "g4"]);
assert.deepEqual(seriesWithGaps.draft.affected.map((item) => item.newSlot.date), [
  "2026-09-18", "2026-10-02", "2026-10-09",
]);

const legacyFromLaterIndex = prepare({
  selectedAppointmentId: "s3",
  preferredSlot: { date: "2026-10-02", time: "19:00" },
  scope: "following",
  now: seriesNow,
  occurrences: fullSeriesOccurrences,
  series: { ...series, endDate: "2026-10-29" },
});
assert.equal(legacyFromLaterIndex.ok, true);
assert.deepEqual(legacyFromLaterIndex.draft.affected.map((item) => item.appointment.id), ["s3", "s4"]);

const lowerDestinationInPast = prepareSeries({
  preferredSlot: { date: "2026-09-23", time: "19:00" },
});
assert.equal(lowerDestinationInPast.ok, false);
assert.equal(lowerDestinationInPast.error.reason, "slot_not_future");
assert.equal(lowerDestinationInPast.error.problematicAppointmentId, "s1");

const lowerDestinationTodayForCustomer = prepareSeries({
  actorType: "customer",
  actorUid: "user-1",
  preferredSlot: { date: "2026-09-30", time: "19:00" },
});
assert.equal(lowerDestinationTodayForCustomer.ok, false);
assert.equal(lowerDestinationTodayForCustomer.error.reason, "same_day_change_not_allowed");
assert.equal(lowerDestinationTodayForCustomer.error.problematicAppointmentId, "s1");

const selectedTodayForSeriesCustomer = prepareSeries({
  actorType: "customer",
  actorUid: "user-1",
  occurrences: fullSeriesOccurrences.map((item) => item.id === "s3"
    ? occurrence("s3", 3, "2026-09-16", "approved", "19:00")
    : item),
});
assert.equal(selectedTodayForSeriesCustomer.ok, false);
assert.equal(selectedTodayForSeriesCustomer.error.reason, "same_day_change_not_allowed");

const anchorTodayForSeriesCustomer = prepareSeries({
  actorType: "customer",
  actorUid: "user-1",
  preferredSlot: { date: "2026-09-16", time: "19:00" },
});
assert.equal(anchorTodayForSeriesCustomer.ok, false);
assert.equal(anchorTodayForSeriesCustomer.error.reason, "same_day_change_not_allowed");

const invalidSlot = (id, recurrenceIndex, date, time = "invalid") => ({
  ...occurrence(id, recurrenceIndex, date),
  data: {
    ...occurrence(id, recurrenceIndex, date).data,
    approvedSlot: { date, time },
    preferredSlots: [{ date: "2026-12-31", time: "10:00" }],
    date: "2026-12-31",
    time: "10:00",
  },
});

const invalidUnknownSlot = invalidSlot("invalid-unknown", 8, "not-a-date");
invalidUnknownSlot.data.preferredSlots = [{ date: "also-invalid", time: "10:00" }];
invalidUnknownSlot.data.date = "still-invalid";

const invalidPastSlot = prepareSeries({
  occurrences: [...fullSeriesOccurrences, invalidSlot("invalid-past", 8, "2026-09-15")],
});
assert.equal(invalidPastSlot.ok, true);
assert.equal(invalidPastSlot.draft.affected.some((item) => item.appointment.id === "invalid-past"), false);

for (const [label, brokenOccurrence] of [
  ["today", invalidSlot("invalid-today", 8, "2026-09-16")],
  ["future", invalidSlot("invalid-future", 8, "2026-11-01")],
  ["unknown", invalidUnknownSlot],
]) {
  const result = prepareSeries({ occurrences: [...fullSeriesOccurrences, brokenOccurrence] });
  assert.equal(result.ok, false, label);
  assert.equal(result.error.reason, "recurring_occurrence_unavailable", label);
  assert.equal(result.error.problematicAppointmentId, brokenOccurrence.id, label);
}

const invalidLowerIndex = prepareSeries({
  occurrences: fullSeriesOccurrences.map((item) => item.id === "s1"
    ? { ...item, data: { ...item.data, recurrenceIndex: undefined } }
    : item),
});
assert.equal(invalidLowerIndex.ok, false);
assert.equal(invalidLowerIndex.error.reason, "recurring_occurrence_unavailable");

const invalidLowerDuration = prepareSeries({
  occurrences: fullSeriesOccurrences.map((item) => item.id === "s1"
    ? { ...item, data: { ...item.data, duration: "15" } }
    : item),
});
assert.equal(invalidLowerDuration.ok, false);
assert.equal(invalidLowerDuration.error.reason, "recurring_occurrence_unavailable");

function validateSeriesDraft(overrides = {}) {
  return validateRecurringRescheduleAvailability({
    draft: wholeSeries.draft,
    siteConfig,
    blockedKeys: new Set(),
    occupancyByKey: emptyOccupancy(wholeSeries.draft),
    userAppointments: fullSeriesOccurrences,
    ...overrides,
  });
}

const firstSeriesNewKey = wholeSeries.draft.affected[0].newKeys[0];
const blockedLowerSeriesOccurrence = validateSeriesDraft({ blockedKeys: new Set([firstSeriesNewKey]) });
assert.equal(blockedLowerSeriesOccurrence.ok, false);
assert.equal(blockedLowerSeriesOccurrence.error.reason, "slot_blocked");
assert.equal(blockedLowerSeriesOccurrence.error.problematicAppointmentId, "s1");

const fullSeriesOccupancy = emptyOccupancy(wholeSeries.draft);
fullSeriesOccupancy.set(firstSeriesNewKey, siteConfig.maxCapacity);
const fullLowerSeriesOccurrence = validateSeriesDraft({ occupancyByKey: fullSeriesOccupancy });
assert.equal(fullLowerSeriesOccurrence.ok, false);
assert.equal(fullLowerSeriesOccurrence.error.reason, "slot_full");
assert.equal(fullLowerSeriesOccurrence.error.problematicAppointmentId, "s1");

const externalSeriesConflict = occurrence("external-series-conflict", 99, "2026-09-18", "pending", "19:00");
externalSeriesConflict.data.recurrenceSeriesId = "other-series";
const conflictingLowerSeriesOccurrence = validateSeriesDraft({
  userAppointments: [...fullSeriesOccurrences, externalSeriesConflict],
});
assert.equal(conflictingLowerSeriesOccurrence.ok, false);
assert.equal(conflictingLowerSeriesOccurrence.error.reason, "appointment_conflict");
assert.equal(conflictingLowerSeriesOccurrence.error.problematicAppointmentId, "s1");

const invalidLowerSeriesOccupancy = emptyOccupancy(wholeSeries.draft);
invalidLowerSeriesOccupancy.set(firstSeriesNewKey, -1);
const invalidLowerSeriesOccupancyResult = validateSeriesDraft({ occupancyByKey: invalidLowerSeriesOccupancy });
assert.equal(invalidLowerSeriesOccupancyResult.ok, false);
assert.equal(invalidLowerSeriesOccupancyResult.error.reason, "invalid_occupancy");

const outsideScheduleSeries = prepareSeries({ preferredSlot: { date: "2026-10-02", time: "20:00" } });
assert.equal(outsideScheduleSeries.ok, true);
const outsideScheduleSeriesResult = validateRecurringRescheduleAvailability({
  draft: outsideScheduleSeries.draft,
  siteConfig,
  blockedKeys: new Set(),
  occupancyByKey: emptyOccupancy(outsideScheduleSeries.draft),
  userAppointments: fullSeriesOccurrences,
});
assert.equal(outsideScheduleSeriesResult.ok, false);
assert.equal(outsideScheduleSeriesResult.error.reason, "outside_schedule");
assert.equal(outsideScheduleSeriesResult.error.problematicAppointmentId, "s1");

const missingFutureIndex = occurrence("missing-index", undefined, "2026-10-12");
const missingFutureIndexResult = prepare({ occurrences: [...occurrences, missingFutureIndex] });
assert.equal(missingFutureIndexResult.ok, false);
assert.equal(missingFutureIndexResult.error.reason, "recurring_occurrence_unavailable");
assert.equal(missingFutureIndexResult.error.problematicAppointmentId, "missing-index");
assert.deepEqual(missingFutureIndexResult.error.problematicSlot, { date: "2026-10-12", time: "10:00" });

const fractionalFutureIndex = occurrence("fractional-index", 5.5, "2026-10-12");
const fractionalFutureIndexResult = prepare({ occurrences: [...occurrences, fractionalFutureIndex] });
assert.equal(fractionalFutureIndexResult.ok, false);
assert.equal(fractionalFutureIndexResult.error.reason, "recurring_occurrence_unavailable");

const ignoredInvalidIndexes = prepare({
  occurrences: [
    ...occurrences,
    occurrence("past-invalid-index", undefined, "2026-08-31"),
    occurrence("pending-invalid-index", undefined, "2026-10-12", "pending"),
    occurrence("cancelled-invalid-index", undefined, "2026-10-19", "cancelled"),
    occurrence("rejected-invalid-index", undefined, "2026-10-26", "rejected"),
  ],
});
assert.equal(ignoredInvalidIndexes.ok, true);

const invalidLaterDurationOccurrences = occurrences.map((item) => item.id === "a3"
  ? { ...item, data: { ...item.data, duration: "0" } }
  : item);
const invalidLaterDuration = prepare({ occurrences: invalidLaterDurationOccurrences });
assert.equal(invalidLaterDuration.ok, false);
assert.equal(invalidLaterDuration.error.reason, "recurring_occurrence_unavailable");
assert.equal(invalidLaterDuration.error.problematicAppointmentId, "a3");

const partialDuration = prepare({
  scope: "single",
  occurrences: occurrences.map((item) => item.id === "a1"
    ? { ...item, data: { ...item.data, duration: "30minutes" } }
    : item),
});
assert.equal(partialDuration.ok, false);
assert.equal(partialDuration.error.reason, "recurring_occurrence_unavailable");

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
        const deleteFields = Object.entries(value)
          .filter(([, fieldValue]) => fieldValue?.constructor?.name === "DeleteTransform")
          .map(([field]) => field);
        staged.push({ ref, value, merge: options?.merge === true, deleteFields });
      },
      create: (ref, value) => {
        firstWriteSeen = true;
        this.operations.push({ type: "write", target: ref.path });
        staged.push({ ref, value, merge: false });
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

function transactionDocuments({
  records = occurrences,
  recurrenceSeries = series,
  draft = following.draft,
} = {}) {
  const docs = {
    "appointment_recurrences/series-1": {
      ...recurrenceSeries,
      occurrenceCount: records.length,
      totalMinutes: records.length * 60,
      bonoId: "bono-1",
      startDate: "2026-09-07",
      startTime: "10:00",
    },
    "site_config/main": siteConfig,
  };
  records.forEach((item) => { docs[`appointments/${item.id}`] = item.data; });
  draft.occupancyKeys.forEach((key) => {
    docs[`slot_occupancy/${key}`] = {
      date: key.slice(0, 10),
      time: key.slice(11),
      count: Math.max(0, -(draft.occupancyDelta.get(key) ?? 0)),
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

  const seriesDocuments = () => transactionDocuments({
    records: fullSeriesOccurrences,
    recurrenceSeries: { ...series, endDate: "2026-10-29" },
    draft: wholeSeries.draft,
  });
  const seriesDb = new FakeFirestore(seriesDocuments());
  const seriesHandlers = createRecurringRescheduleHandlers({
    db: seriesDb,
    requireAdmin: async () => { throw new Error("customer handler must not require admin"); },
    getNowDate: () => seriesNow,
  });
  const seriesResponse = await seriesHandlers.rescheduleOwnRecurringAppointment({
    auth: { uid: "user-1", token: {} },
    data: {
      appointmentId: "s3",
      preferredSlot: { date: "2026-10-02", time: "19:00" },
      scope: "series",
    },
  });
  assert.equal(seriesResponse.success, true);
  assert.equal(seriesResponse.scope, "series");
  assert.deepEqual(seriesResponse.affectedAppointmentIds, ["s1", "s2", "s3", "s4"]);
  wholeSeries.draft.affected.forEach((item) => {
    const updatedOccurrence = seriesDb.documents.get(`appointments/${item.appointment.id}`);
    assert.equal(updatedOccurrence.status, "approved");
    protectedFields.forEach((field) => assert.deepEqual(
      updatedOccurrence[field],
      item.appointment.data[field],
      `series handler changed ${field} on ${item.appointment.id}`,
    ));
  });
  assert.deepEqual(seriesDb.documents.get("appointments/s0").approvedSlot, { date: "2026-09-10", time: "10:00" });
  assert.deepEqual(seriesDb.documents.get("appointments/s5").approvedSlot, { date: "2026-10-15", time: "10:00" });
  const recurringSeriesAfter = seriesDb.documents.get("appointment_recurrences/series-1");
  assert.equal(recurringSeriesAfter.lastRescheduleScope, "series");
  assert.equal(recurringSeriesAfter.lastRescheduleFromIndex, 3);
  assert.equal(recurringSeriesAfter.endDate, "2026-10-29");
  assert.equal(recurringSeriesAfter.bonoId, "bono-1");
  const seriesLog = [...seriesDb.documents.entries()]
    .find(([path, value]) => path.startsWith("activity_logs/") && value.scope === "series")[1];
  assert.deepEqual(seriesLog.affectedAppointmentIds, ["s1", "s2", "s3", "s4"]);
  assert.equal(seriesLog.affectedCount, 4);

  const foreignSeriesDocs = seriesDocuments();
  const foreignSeriesDb = new FakeFirestore(foreignSeriesDocs);
  const foreignSeriesHandlers = createRecurringRescheduleHandlers({
    db: foreignSeriesDb,
    requireAdmin: async () => ({}),
    getNowDate: () => seriesNow,
  });
  await assert.rejects(
    foreignSeriesHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-2", token: {} },
      data: {
        appointmentId: "s3",
        preferredSlot: { date: "2026-10-02", time: "19:00" },
        scope: "series",
      },
    }),
    (error) => error.code === "permission-denied",
  );
  assert.deepEqual(foreignSeriesDb.documents, new Map(Object.entries(foreignSeriesDocs)));

  const failingSeriesDocs = seriesDocuments();
  failingSeriesDocs[`slot_occupancy/${firstSeriesNewKey}`] = {
    date: firstSeriesNewKey.slice(0, 10),
    time: firstSeriesNewKey.slice(11),
    count: siteConfig.maxCapacity,
  };
  const failingSeriesDb = new FakeFirestore(failingSeriesDocs);
  const failingSeriesHandlers = createRecurringRescheduleHandlers({
    db: failingSeriesDb,
    requireAdmin: async () => ({}),
    getNowDate: () => seriesNow,
  });
  await assert.rejects(
    failingSeriesHandlers.rescheduleRecurringAppointmentFromAdmin({
      auth: { uid: "admin-1", token: {} },
      data: {
        appointmentId: "s3",
        preferredSlot: { date: "2026-10-02", time: "19:00" },
        scope: "series",
      },
    }),
    (error) => error.code === "failed-precondition"
      && error.details.reason === "slot_full"
      && error.details.problematicAppointmentId === "s1",
  );
  assert.equal(failingSeriesDb.operations.some((operation) => operation.type === "write"), false);
  assert.deepEqual(failingSeriesDb.documents, new Map(Object.entries(failingSeriesDocs)));

  const customerDb = new FakeFirestore(transactionDocuments());
  const customerHandlers = createRecurringRescheduleHandlers({
    db: customerDb,
    requireAdmin: async () => { throw new Error("customer handler must not require admin"); },
    getNowDate: () => fixedNow,
  });
  const customerResponse = await customerHandlers.rescheduleOwnRecurringAppointment({
    auth: { uid: "user-1", token: {} },
    data: {
      appointmentId: "a1",
      preferredSlot: { date: "2026-09-20", time: "19:00" },
      scope: "following",
    },
  });
  assert.equal(customerResponse.success, true);
  const customerUpdated = customerDb.documents.get("appointments/a1");
  assert.equal(customerUpdated.status, "approved");
  protectedFields.forEach((field) => assert.deepEqual(
    customerUpdated[field],
    occurrences[1].data[field],
    `customer handler changed ${field}`,
  ));

  const approvedSingleDocs = transactionDocuments();
  const approvedSingleBefore = structuredClone(approvedSingleDocs["appointments/a1"]);
  const approvedSingleOldKeys = getSlotBlocks("10:00", 60).map((time) => `2026-09-14_${time}`);
  const approvedSingleNewKeys = getSlotBlocks("19:00", 60).map((time) => `2026-09-20_${time}`);
  const approvedSingleDb = new FakeFirestore(approvedSingleDocs);
  const approvedSingleHandlers = createRecurringRescheduleHandlers({
    db: approvedSingleDb,
    requireAdmin: async () => { throw new Error("customer handler must not require admin"); },
    getNowDate: () => fixedNow,
  });
  const approvedSingleResponse = await approvedSingleHandlers.rescheduleOwnRecurringAppointment({
    auth: { uid: "user-1", token: {} },
    data: {
      appointmentId: "a1",
      preferredSlot: { date: "2026-09-20", time: "19:00" },
      scope: "single",
    },
  });
  assert.deepEqual(approvedSingleResponse, {
    success: true,
    appointmentId: "a1",
    status: "pending",
  });
  const approvedSingleAfter = approvedSingleDb.documents.get("appointments/a1");
  assert.equal(approvedSingleAfter.status, "pending");
  assert.equal("approvedSlot" in approvedSingleAfter, false);
  assert.equal("assignedTrainer" in approvedSingleAfter, false);
  assert.equal(approvedSingleAfter.sessionType, approvedSingleBefore.sessionType);
  assert.equal(approvedSingleAfter.bonoId, approvedSingleBefore.bonoId);
  assert.equal(approvedSingleAfter.minutesDeductedAt, approvedSingleBefore.minutesDeductedAt);
  assert.equal(approvedSingleAfter.googleCalendarEventId, approvedSingleBefore.googleCalendarEventId);
  assert.equal(approvedSingleDb.documents.get("appointments/a3").status, "approved");
  assert.equal(approvedSingleDb.documents.get("appointment_recurrences/series-1").status, "pending");
  approvedSingleOldKeys.forEach((key) => {
    assert.equal(approvedSingleDb.documents.get(`slot_occupancy/${key}`).count, 0);
  });
  approvedSingleNewKeys.forEach((key) => {
    assert.equal(approvedSingleDb.documents.get(`slot_occupancy/${key}`)?.count ?? 0, 0);
  });

  const pendingSingleDocs = transactionDocuments({
    records: occurrences.map((item) => item.id === "a1"
      ? {
        ...item,
        data: {
          ...item.data,
          status: "pending",
          approvedSlot: undefined,
          assignedTrainer: undefined,
        },
      }
      : item),
    recurrenceSeries: { ...series, status: "pending" },
    draft: following.draft,
  });
  const pendingSingleDb = new FakeFirestore(pendingSingleDocs);
  const pendingSingleHandlers = createRecurringRescheduleHandlers({
    db: pendingSingleDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  const pendingSingleResponse = await pendingSingleHandlers.rescheduleOwnRecurringAppointment({
    auth: { uid: "user-1", token: {} },
    data: {
      appointmentId: "a1",
      preferredSlot: { date: "2026-09-20", time: "19:00" },
      scope: "single",
    },
  });
  assert.equal(pendingSingleResponse.status, "pending");
  assert.equal(pendingSingleDb.documents.get("appointments/a1").status, "pending");
  assert.equal(
    pendingSingleDb.operations.some((operation) => operation.type === "write" && operation.target.startsWith("slot_occupancy/")),
    false,
  );

  const lockedSingleDocs = transactionDocuments();
  lockedSingleDocs["appointments/a1"] = {
    ...lockedSingleDocs["appointments/a1"],
    approvedSlot: { date: "2026-09-02", time: "10:00" },
    preferredSlots: [{ date: "2026-09-02", time: "10:00" }],
    date: "2026-09-02",
    time: "10:00",
  };
  const lockedSingleDb = new FakeFirestore(lockedSingleDocs);
  const lockedSingleHandlers = createRecurringRescheduleHandlers({
    db: lockedSingleDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    lockedSingleHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-1", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-20", time: "19:00" },
        scope: "single",
      },
    }),
    (error) => error.code === "failed-precondition"
      && error.details.reason === "one_day_change_not_allowed",
  );
  assert.equal(lockedSingleDb.operations.some((operation) => operation.type === "write"), false);

  const foreignDocs = transactionDocuments();
  const foreignDb = new FakeFirestore(foreignDocs);
  const foreignHandlers = createRecurringRescheduleHandlers({
    db: foreignDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    foreignHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-2", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-20", time: "19:00" },
        scope: "single",
      },
    }),
    (error) => error.code === "permission-denied",
  );
  assert.deepEqual(foreignDb.documents, new Map(Object.entries(foreignDocs)));

  const selectedTodayDocs = transactionDocuments();
  selectedTodayDocs["appointments/a1"] = {
    ...selectedTodayDocs["appointments/a1"],
    approvedSlot: { date: "2026-09-01", time: "19:00" },
    preferredSlots: [{ date: "2026-09-01", time: "19:00" }],
    date: "2026-09-01",
    time: "19:00",
  };
  const selectedTodayDb = new FakeFirestore(selectedTodayDocs);
  const selectedTodayHandlers = createRecurringRescheduleHandlers({
    db: selectedTodayDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    selectedTodayHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-1", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-02", time: "19:00" },
        scope: "single",
      },
    }),
    (error) => error.code === "failed-precondition"
      && error.details.reason === "one_day_change_not_allowed",
  );
  assert.equal(selectedTodayDb.operations.some((operation) => operation.type === "write"), false);

  const targetTodayDocs = transactionDocuments();
  const targetTodayDb = new FakeFirestore(targetTodayDocs);
  const targetTodayHandlers = createRecurringRescheduleHandlers({
    db: targetTodayDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    targetTodayHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-1", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-01", time: "19:00" },
        scope: "single",
      },
    }),
    (error) => error.code === "failed-precondition"
      && error.details.reason === "one_day_change_not_allowed",
  );
  assert.equal(targetTodayDb.operations.some((operation) => operation.type === "write"), false);

  const customerFailingDocs = transactionDocuments();
  customerFailingDocs[`slot_occupancy/${fullKey}`] = {
    date: fullKey.slice(0, 10), time: fullKey.slice(11), count: 2,
  };
  const customerFailingDb = new FakeFirestore(customerFailingDocs);
  const customerFailingHandlers = createRecurringRescheduleHandlers({
    db: customerFailingDb,
    requireAdmin: async () => ({}),
    getNowDate: () => fixedNow,
  });
  await assert.rejects(
    customerFailingHandlers.rescheduleOwnRecurringAppointment({
      auth: { uid: "user-1", token: {} },
      data: {
        appointmentId: "a1",
        preferredSlot: { date: "2026-09-20", time: "19:00" },
        scope: "following",
      },
    }),
    (error) => error.code === "failed-precondition" && error.details.reason === "slot_full",
  );
  assert.deepEqual(
    customerFailingDb.documents,
    new Map(Object.entries(customerFailingDocs)),
    "customer failure must not persist writes",
  );

  for (const [label, mutate] of [
    ["invalid recurrence index", (docs) => { docs["appointments/a3"] = { ...docs["appointments/a3"], recurrenceIndex: undefined }; }],
    ["invalid duration", (docs) => { docs["appointments/a3"] = { ...docs["appointments/a3"], duration: "15" }; }],
  ]) {
    const corruptDocs = transactionDocuments();
    mutate(corruptDocs);
    const corruptDb = new FakeFirestore(corruptDocs);
    const corruptHandlers = createRecurringRescheduleHandlers({
      db: corruptDb,
      requireAdmin: async () => ({}),
      getNowDate: () => fixedNow,
    });
    await assert.rejects(
      corruptHandlers.rescheduleRecurringAppointmentFromAdmin({
        auth: { uid: "admin-1", token: {} },
        data: {
          appointmentId: "a1",
          preferredSlot: { date: "2026-09-20", time: "19:00" },
          scope: "following",
        },
      }),
      (error) => error.code === "failed-precondition"
        && error.details.reason === "recurring_occurrence_unavailable",
      label,
    );
    assert.equal(corruptDb.operations.some((operation) => operation.type === "write"), false, label);
    assert.deepEqual(corruptDb.documents, new Map(Object.entries(corruptDocs)), label);
  }
}

runHandlerTests()
  .then(() => console.log("recurring reschedule tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
