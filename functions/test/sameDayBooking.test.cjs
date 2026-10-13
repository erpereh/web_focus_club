const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BOOKING_NOTICE_TOO_SHORT,
  SAME_DAY_BOOKING_DISABLED,
  SAME_DAY_BOOKING_MESSAGE,
  isSameDayBookingBlocked,
} = require("../lib/appointmentLifecycle.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");
const { evaluateSlot, SLOT_REJECTION_MESSAGES } = require("../lib/slotValidation.js");
const { planRecurringAppointments } = require("../lib/recurringAppointments.js");
const { createAppointmentProposalHandlers } = require("../lib/appointmentProposals.js");
const { createRecurringSeriesHandlers } = require("../lib/recurringSeries.js");
const { FakeFirestore, callable, rejectsWithReason } = require("./helpers/transactionalFakes.cjs");

// Monday 5 Oct 2026, 10:00 in Madrid (CEST, UTC+2).
const NOW = new Date("2026-10-05T08:00:00.000Z");
const slot = (date, time) => ({ date, time });

test("config: missing, legacy or non-boolean values keep same-day booking allowed", () => {
  assert.equal(normalizeSiteConfig().blockSameDayBooking, false);
  assert.equal(normalizeSiteConfig({}).blockSameDayBooking, false, "legacy configs without the field");
  assert.equal(normalizeSiteConfig({ blockSameDayBooking: "true" }).blockSameDayBooking, false);
  assert.equal(normalizeSiteConfig({ blockSameDayBooking: 1 }).blockSameDayBooking, false);
  assert.equal(normalizeSiteConfig({ blockSameDayBooking: true }).blockSameDayBooking, true);
  assert.equal(SLOT_REJECTION_MESSAGES.same_day_booking_disabled, SAME_DAY_BOOKING_MESSAGE);
});

test("blocks any time today in Madrid only when enabled", () => {
  assert.equal(isSameDayBookingBlocked(slot("2026-10-05", "10:30"), NOW, true), true);
  assert.equal(isSameDayBookingBlocked(slot("2026-10-05", "23:30"), NOW, true), true, "late tonight still today");
  assert.equal(isSameDayBookingBlocked(slot("2026-10-06", "08:00"), NOW, true), false, "tomorrow");
  assert.equal(isSameDayBookingBlocked(slot("2026-10-05", "10:30"), NOW, false), false);
  assert.equal(isSameDayBookingBlocked(slot("2026-10-05", "10:30"), NOW, undefined), false);
});

test("midnight boundary uses the Madrid calendar day, not UTC", () => {
  // 23:59 Madrid (CEST) on the 5th = 21:59Z.
  const beforeMidnight = new Date("2026-10-05T21:59:00.000Z");
  assert.equal(isSameDayBookingBlocked(slot("2026-10-05", "23:59"), beforeMidnight, true), true);
  assert.equal(isSameDayBookingBlocked(slot("2026-10-06", "00:00"), beforeMidnight, true), false);
  // 00:00 Madrid on the 6th = 22:00Z on the 5th (UTC is still the 5th).
  const atMidnight = new Date("2026-10-05T22:00:00.000Z");
  assert.equal(isSameDayBookingBlocked(slot("2026-10-06", "09:00"), atMidnight, true), true);
  assert.equal(isSameDayBookingBlocked(slot("2026-10-07", "09:00"), atMidnight, true), false);
  // Winter time (CET, UTC+1): 00:30 Madrid on 2 Nov = 23:30Z on 1 Nov.
  const winter = new Date("2026-11-01T23:30:00.000Z");
  assert.equal(isSameDayBookingBlocked(slot("2026-11-02", "10:00"), winter, true), true);
  assert.equal(isSameDayBookingBlocked(slot("2026-11-01", "23:45"), winter, true), false);
});

const day = {
  config: normalizeSiteConfig({ startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 }),
  blockedTimes: new Set(),
  occupancyByTime: new Map(),
};
const evaluate = (date, time, extra = {}) => evaluateSlot(day, {
  slot: { date, time },
  durationMinutes: 30,
  appointmentType: "training",
  now: NOW,
  customerAppointments: [],
  ...extra,
});

test("evaluateSlot (createAppointment): training and nutrition rejected today with the specific reason", () => {
  assert.equal(evaluate("2026-10-05", "19:00", { blockSameDayBooking: true }), SAME_DAY_BOOKING_DISABLED);
  assert.equal(evaluate("2026-10-05", "19:00", { blockSameDayBooking: true, appointmentType: "nutrition" }), SAME_DAY_BOOKING_DISABLED);
  assert.equal(evaluate("2026-10-06", "08:00", { blockSameDayBooking: true }), undefined, "tomorrow early morning is fine");
  assert.equal(evaluate("2026-10-05", "19:00", { blockSameDayBooking: false }), undefined);
  assert.equal(evaluate("2026-10-05", "19:00"), undefined, "admin callers never pass the flag");
  assert.equal(evaluate("2026-10-05", "09:00", { blockSameDayBooking: true }), "slot_not_future", "past stays past");
});

test("same-day block and booking notice apply independently", () => {
  // Notice 48h + same-day off: tomorrow blocked by the notice only.
  assert.equal(evaluate("2026-10-06", "10:00", { minNoticeHours: 48, blockSameDayBooking: false }), BOOKING_NOTICE_TOO_SHORT);
  // Notice 1h + same-day on: today 19:00 is beyond the notice but still blocked.
  assert.equal(evaluate("2026-10-05", "19:00", { minNoticeHours: 1, blockSameDayBooking: true }), SAME_DAY_BOOKING_DISABLED);
  // Notice 24h + same-day on: tomorrow 09:30 blocked by the notice, not by same-day.
  assert.equal(evaluate("2026-10-06", "09:30", { minNoticeHours: 24, blockSameDayBooking: true }), BOOKING_NOTICE_TOO_SHORT);
  assert.equal(evaluate("2026-10-06", "10:00", { minNoticeHours: 24, blockSameDayBooking: true }), undefined);
});

function plan(overrides = {}) {
  return planRecurringAppointments({
    startDate: "2026-10-05",
    startTime: "18:00",
    endDate: "2026-10-19",
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

test("customer series with an occurrence today is rejected as a whole, naming the date", () => {
  const blocked = plan({ blockSameDayBooking: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, SAME_DAY_BOOKING_DISABLED);
  assert.equal(blocked.problemDate, "2026-10-05");
  assert.equal(blocked.problemTime, "18:00");
  assert.match(blocked.message, /05\/10\/2026/);
  assert.deepEqual(blocked.writes, [], "nothing is planned");
  assert.equal(plan({ blockSameDayBooking: true, startDate: "2026-10-06", endDate: "2026-10-20" }).ok, true, "starting tomorrow is fine");
  assert.equal(plan({ blockSameDayBooking: false }).ok, true);
  assert.equal(plan().ok, true, "admin series never pass the flag");
});

function seriesDocuments(config) {
  return {
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2, ...config },
    "users/user-1": { uid: "user-1", name: "Lucía", email: "lucia@example.com", phone: "600000000" },
    "services/service-1": { title: "Entrenamiento personal", active: true },
    "bonos/bono-1": {
      userId: "user-1",
      estado: "activo",
      minutosTotales: 600,
      tamano: 600,
      minutosRestantes: 600,
      fechaExpiracion: "2026-12-31T22:59:59.999Z",
      historial: [],
    },
  };
}

function seriesHandlers(db) {
  return createRecurringSeriesHandlers({
    db,
    requireAdmin: async () => ({}),
    getNowDate: () => NOW,
    appointmentSlotKeys: () => new Set(),
    defaultServiceType: "Entrenamiento personal",
  });
}

const seriesRequest = (date, endDate) => callable("user-1", {
  date,
  time: "18:00",
  endDate,
  intervalDays: 7,
  duration: "60",
  serviceType: "Entrenamiento personal",
});

test("createRecurringAppointments rejects today's series with reason and date, writing nothing", async () => {
  const db = new FakeFirestore(seriesDocuments({ blockSameDayBooking: true }));
  const error = await rejectsWithReason(
    seriesHandlers(db).createRecurringAppointments(seriesRequest("2026-10-05", "2026-10-19")),
    SAME_DAY_BOOKING_DISABLED,
    "failed-precondition",
  );
  assert.equal(error.details.date, "2026-10-05");
  assert.equal(error.details.time, "18:00");
  assert.equal(db.writes.length, 0, "no appointment, occupancy or bono write");
});

test("createRecurringAppointments still works from tomorrow, and today when the flag is off", async () => {
  const onDb = new FakeFirestore(seriesDocuments({ blockSameDayBooking: true }));
  const fromTomorrow = await seriesHandlers(onDb).createRecurringAppointments(seriesRequest("2026-10-06", "2026-10-20"));
  assert.equal(fromTomorrow.success, true);

  const legacyDb = new FakeFirestore(seriesDocuments({}));
  const today = await seriesHandlers(legacyDb).createRecurringAppointments(seriesRequest("2026-10-05", "2026-10-19"));
  assert.equal(today.success, true, "configs without the field keep the legacy behaviour");
});

test("admin proposals for today are not limited by the same-day block", async () => {
  const db = new FakeFirestore({
    "site_config/main": { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2, blockSameDayBooking: true },
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
    slot: slot("2026-10-05", "18:00"),
  }));
  assert.equal(result.success, true);
});
