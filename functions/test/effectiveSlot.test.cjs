// Server half of the effective-slot parity check (web half:
// src/lib/effective-slot-parity.test.ts). Also exercises the legacy data the
// old browser "back to pending" left behind through conflicts, blocking,
// occupancy and the calendar.
const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("./fixtures/effective-slot.json");
const { getAppointmentEffectiveSlot } = require("../lib/appointmentLifecycle.js");
const { resolveAppointmentSlot } = require("../lib/googleCalendarSync.js");
const { appointmentOccupancyKeys } = require("../lib/slotOccupancy.js");
const { appointmentRangeKeys, evaluateSlot } = require("../lib/slotValidation.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");

/** Rule of app_focus_club `schedulingSlot` (portal_models.dart), ignoring open proposals. */
function flutterSchedulingSlot(appointment) {
  const legacy = appointment.date && appointment.time ? { date: appointment.date, time: appointment.time } : null;
  const preferred = appointment.preferredSlots?.[0] ?? null;
  if (appointment.status === "pending") return preferred ?? legacy;
  return appointment.approvedSlot ?? preferred ?? legacy;
}

for (const testCase of fixture.cases) {
  test(`effective slot: ${testCase.name}`, () => {
    assert.deepEqual(getAppointmentEffectiveSlot(testCase.appointment) ?? null, testCase.expected);
    if (testCase.appointment.status && !("flutter" in testCase) && !testCase.name.startsWith("malformed")) {
      assert.deepEqual(flutterSchedulingSlot(testCase.appointment), testCase.expected, "must match the published app");
    }
    if (["pending", "approved"].includes(testCase.appointment.status)) {
      assert.deepEqual(resolveAppointmentSlot(testCase.appointment) ?? null, testCase.expected, "calendar sync");
    }
  });
}

const DAY = "2030-01-15";
const stalePending = {
  status: "pending",
  approvedSlot: { date: DAY, time: "12:00" },
  preferredSlots: [{ date: DAY, time: "10:00" }],
  duration: "60",
};

test("legacy pending with a leftover approvedSlot: conflicts use the requested slot", () => {
  const keys = [...appointmentRangeKeys(stalePending)];
  assert.deepEqual(keys, [`${DAY}_10:00`, `${DAY}_10:15`, `${DAY}_10:30`, `${DAY}_10:45`]);
  const day = { config: normalizeSiteConfig({ startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2 }), blockedTimes: new Set(), occupancyByTime: new Map() };
  const base = { durationMinutes: 60, appointmentType: "training", now: new Date("2026-10-15T08:00:00Z"), customerAppointments: [{ id: "old", data: stalePending }] };
  assert.equal(evaluateSlot(day, { ...base, slot: { date: DAY, time: "10:30" } }), "appointment_conflict");
  assert.equal(evaluateSlot(day, { ...base, slot: { date: DAY, time: "12:00" } }), undefined, "the old approved slot is free");
});

test("legacy pending with a leftover approvedSlot: block overlap uses the requested slot", () => {
  assert.deepEqual(appointmentOccupancyKeys(stalePending), [`${DAY}_10:00`, `${DAY}_10:15`, `${DAY}_10:30`, `${DAY}_10:45`]);
});

test("approved appointments keep occupying their approvedSlot", () => {
  const approved = { ...stalePending, status: "approved" };
  assert.deepEqual(appointmentOccupancyKeys(approved), [`${DAY}_12:00`, `${DAY}_12:15`, `${DAY}_12:30`, `${DAY}_12:45`]);
});
