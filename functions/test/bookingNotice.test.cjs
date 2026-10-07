const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BOOKING_NOTICE_TOO_SHORT,
  checkCustomerModificationSlots,
  isInsideBookingNotice,
  validateOwnReschedule,
} = require("../lib/appointmentLifecycle.js");
const { normalizeMinBookingNoticeHours, normalizeSiteConfig } = require("../lib/siteConfig.js");
const { evaluateSlot } = require("../lib/slotValidation.js");
const { planRecurringAppointments } = require("../lib/recurringAppointments.js");
const { createAppointmentProposalHandlers } = require("../lib/appointmentProposals.js");
const { FakeFirestore, callable } = require("./helpers/transactionalFakes.cjs");

// Monday 5 Oct 2026, 10:00 in Madrid (CEST, UTC+2).
const NOW = new Date("2026-10-05T08:00:00.000Z");
const slot = (date, time) => ({ date, time });

test("config: missing or invalid notice means 0; valid values are integer hours", () => {
  assert.equal(normalizeSiteConfig().minBookingNoticeHours, 0);
  assert.equal(normalizeSiteConfig({}).minBookingNoticeHours, 0, "legacy configs without the field");
  assert.equal(normalizeMinBookingNoticeHours(undefined), 0);
  assert.equal(normalizeMinBookingNoticeHours(null), 0);
  assert.equal(normalizeMinBookingNoticeHours(-5), 0);
  assert.equal(normalizeMinBookingNoticeHours("abc"), 0);
  assert.equal(normalizeMinBookingNoticeHours("24"), 24);
  assert.equal(normalizeMinBookingNoticeHours(12.9), 12);
  assert.equal(normalizeMinBookingNoticeHours(99999), 720);
});

test("0h allows any future slot", () => {
  assert.equal(isInsideBookingNotice(slot("2026-10-05", "10:01"), NOW, 0), false);
  assert.equal(isInsideBookingNotice(slot("2026-10-05", "10:30"), NOW, 0), false);
});

test("24h blocks +23:59 and allows +24:00 or later", () => {
  assert.equal(isInsideBookingNotice(slot("2026-10-06", "09:59"), NOW, 24), true, "+23:59");
  assert.equal(isInsideBookingNotice(slot("2026-10-06", "10:00"), NOW, 24), false, "+24:00");
  assert.equal(isInsideBookingNotice(slot("2026-10-06", "10:30"), NOW, 24), false, "+24:30");
});

test("day and month change", () => {
  // 31 Oct 2026 22:00 Madrid (CET, UTC+1) = 21:00Z; +24h = 1 Nov 22:00 Madrid.
  const now = new Date("2026-10-31T21:00:00.000Z");
  assert.equal(isInsideBookingNotice(slot("2026-11-01", "21:59"), now, 24), true);
  assert.equal(isInsideBookingNotice(slot("2026-11-01", "22:00"), now, 24), false);
});

test("Madrid DST change uses real hours", () => {
  // 24 Oct 2026 12:00 Madrid (CEST) = 10:00Z. +24 real hours = 25 Oct 10:00Z = 11:00 Madrid (CET).
  const now = new Date("2026-10-24T10:00:00.000Z");
  assert.equal(isInsideBookingNotice(slot("2026-10-25", "10:30"), now, 24), true);
  assert.equal(isInsideBookingNotice(slot("2026-10-25", "10:59"), now, 24), true);
  assert.equal(isInsideBookingNotice(slot("2026-10-25", "11:00"), now, 24), false);
  assert.equal(isInsideBookingNotice(slot("2026-10-25", "11:30"), now, 24), false);
  assert.equal(isInsideBookingNotice(slot("2026-10-25", "12:00"), now, 24), false);
});

test("evaluateSlot (createAppointment) rejects inside the notice only when passed", () => {
  const day = {
    config: normalizeSiteConfig({ startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 }),
    blockedTimes: new Set(),
    occupancyByTime: new Map(),
  };
  const at = (date, time, minNoticeHours) => evaluateSlot(day, {
    slot: { date, time },
    durationMinutes: 30,
    appointmentType: "training",
    now: NOW,
    customerAppointments: [],
    ...(minNoticeHours === undefined ? {} : { minNoticeHours }),
  });
  assert.equal(at("2026-10-05", "11:00", 0), undefined, "0h books normally");
  assert.equal(at("2026-10-06", "09:30", 24), BOOKING_NOTICE_TOO_SHORT);
  assert.equal(at("2026-10-06", "10:00", 24), undefined, "exactly +24h is allowed");
  assert.equal(at("2026-10-05", "11:00", 24), BOOKING_NOTICE_TOO_SHORT);
  assert.equal(at("2026-10-05", "11:00"), undefined, "admin callers never pass the notice");
  assert.equal(
    evaluateSlot(day, { slot: slot("2026-10-05", "11:00"), durationMinutes: 30, appointmentType: "nutrition", now: NOW, customerAppointments: [], minNoticeHours: 24 }),
    BOOKING_NOTICE_TOO_SHORT,
    "nutrition follows the same rule",
  );
});

function plan(overrides = {}) {
  return planRecurringAppointments({
    startDate: "2026-10-06",
    startTime: "09:30",
    endDate: "2026-10-20",
    intervalDays: 7,
    durationMinutes: 60,
    now: NOW,
    siteConfig: { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 },
    occupancyByKey: new Map(),
    blockedKeys: new Set(),
    userSlotKeys: new Set(),
    activeBonos: [{
      id: "bono-a",
      estado: "activo",
      minutosTotales: 600,
      minutosRestantes: 600,
      fechaExpiracion: "2026-12-31T22:59:59.999Z",
    }],
    ...overrides,
  });
}

test("customer recurring series respect the notice; admin series do not", () => {
  const blocked = plan({ minBookingNoticeHours: 24 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, BOOKING_NOTICE_TOO_SHORT);
  assert.equal(plan({ minBookingNoticeHours: 24, startDate: "2026-10-06", startTime: "10:00", endDate: "2026-10-20" }).ok, true);
  assert.equal(plan({ minBookingNoticeHours: 0 }).ok, true, "0h books normally");
  assert.equal(plan().ok, true, "admin series never pass the notice");
});

test("customer modifications: current keeps the 24h lock, target respects max(24h, notice)", () => {
  const current = slot("2026-10-20", "10:00");
  // Notice 48h: +30h rejected with the new reason, +48h allowed.
  assert.equal(checkCustomerModificationSlots({ currentSlot: current, targetSlot: slot("2026-10-06", "16:00"), now: NOW, minBookingNoticeHours: 48 }), BOOKING_NOTICE_TOO_SHORT);
  assert.equal(checkCustomerModificationSlots({ currentSlot: current, targetSlot: slot("2026-10-07", "10:00"), now: NOW, minBookingNoticeHours: 48 }), undefined);
  // Notice 12h: the fixed 24h lock still applies to the target.
  assert.equal(checkCustomerModificationSlots({ currentSlot: current, targetSlot: slot("2026-10-05", "23:00"), now: NOW, minBookingNoticeHours: 12 }), "target_locked");
  // The current appointment keeps its own 24h lock regardless of the notice.
  assert.equal(checkCustomerModificationSlots({ currentSlot: slot("2026-10-05", "20:00"), targetSlot: slot("2026-10-10", "10:00"), now: NOW, minBookingNoticeHours: 0 }), "current_locked");
  // Without notice the legacy helper result is unchanged.
  assert.equal(validateOwnReschedule({ userId: "u", status: "pending", ...current }, "u", slot("2026-10-06", "16:00"), NOW.getTime()), undefined);
  assert.equal(validateOwnReschedule({ userId: "u", status: "pending", ...current }, "u", slot("2026-10-06", "16:00"), NOW.getTime(), 48), "booking-notice");
  assert.equal(validateOwnReschedule({ userId: "u", status: "pending", ...current }, "u", slot("2026-10-05", "23:00"), NOW.getTime(), 48), "one-day-lock");
});

test("admin proposals are not limited by the booking notice", async () => {
  const db = new FakeFirestore({
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2, minBookingNoticeHours: 24 },
    "users/admin": { role: "admin", email: "admin@example.com", name: "Admin" },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com" },
    "appointments/appt-1": {
      userId: "user-1",
      name: "Lucía",
      email: "lucia@example.com",
      serviceType: "Bono Mensual de Entrenamiento",
      duration: "60",
      preferredSlots: [slot("2026-10-12", "10:00")],
      date: "2026-10-12",
      time: "10:00",
      status: "pending",
      createdAt: "2026-10-01T10:00:00.000Z",
    },
  });
  const handlers = createAppointmentProposalHandlers({
    db,
    getNowDate: () => NOW,
    requireAdmin: async () => undefined,
  });
  const result = await handlers.proposeAppointmentSlotFromAdmin(callable("admin", {
    appointmentId: "appt-1",
    slot: slot("2026-10-05", "11:00"),
  }));
  assert.equal(result.success, true, "+1h is fine for the admin even with a 24h notice");
});
