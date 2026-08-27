const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  calculateAppointmentRefund,
  getSlotBlocks,
} = require("../lib/appointmentLifecycle.js");
const {
  FIRESTORE_TRANSACTION_MAX_WRITES,
  MAX_RECURRING_OCCURRENCES,
  collectRecurringOccupancyKeys,
  estimateRecurringSeriesWrites,
  generateWeeklyOccurrenceDates,
  parseRecurringAppointmentsData,
  planRecurringAppointments,
} = require("../lib/recurringAppointments.js");

const now = new Date("2026-09-01T08:00:00.000Z");
const siteConfig = { startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 2 };
const activeBono = {
  id: "bono-a",
  estado: "activo",
  minutosTotales: 600,
  minutosRestantes: 600,
  fechaExpiracion: "2026-12-31T22:59:59.999Z",
};

function basePlan(overrides = {}) {
  return planRecurringAppointments({
    startDate: "2026-09-07",
    startTime: "10:00",
    endDate: "2026-09-28",
    intervalWeeks: 1,
    durationMinutes: 60,
    now,
    siteConfig,
    occupancyByKey: new Map(),
    blockedKeys: new Set(),
    userSlotKeys: new Set(),
    activeBonos: [activeBono],
    ...overrides,
  });
}

assert.deepEqual(
  generateWeeklyOccurrenceDates("2026-09-07", 1, "2026-09-28"),
  ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"],
);
assert.deepEqual(
  generateWeeklyOccurrenceDates("2026-09-07", 2, "2026-09-28"),
  ["2026-09-07", "2026-09-21"],
);
assert.deepEqual(generateWeeklyOccurrenceDates("2026-09-28", 1, "2026-09-07"), []);
assert.equal(MAX_RECURRING_OCCURRENCES, 20);
assert.equal(FIRESTORE_TRANSACTION_MAX_WRITES, 500);
assert.equal(estimateRecurringSeriesWrites(20, 80), 103);
assert.ok(estimateRecurringSeriesWrites(20, 80) < FIRESTORE_TRANSACTION_MAX_WRITES);

const parsedPastEnd = parseRecurringAppointmentsData({
  userId: "user-1",
  date: "2026-09-28",
  time: "10:00",
  endDate: "2026-09-07",
  intervalWeeks: 1,
  durationMinutes: 60,
  serviceType: "Bono Mensual de Entrenamiento",
  assignedTrainer: "trainer-1",
  comment: "",
});
assert.equal(parsedPastEnd.ok, false);
assert.match(parsedPastEnd.message, /fecha final no puede ser anterior/i);

const longDates = generateWeeklyOccurrenceDates("2026-09-07", 1, "2027-02-01");
assert.ok(longDates.length > MAX_RECURRING_OCCURRENCES);
const tooLong = basePlan({ endDate: "2027-02-01", activeBonos: [{ ...activeBono, minutosRestantes: 9999, minutosTotales: 9999 }] });
assert.equal(tooLong.ok, false);
assert.deepEqual(tooLong.writes, []);
assert.match(tooLong.message, /20 sesiones/);

const insufficient = basePlan({
  durationMinutes: 60,
  activeBonos: [{ ...activeBono, minutosTotales: 180, minutosRestantes: 180 }],
});
assert.equal(insufficient.ok, false);
assert.deepEqual(insufficient.writes, []);
assert.equal(
  insufficient.message,
  "No hay suficientes minutos en el bono. La serie requiere 240 min y quedan 180 min.",
);

const moreThanEnough = basePlan({
  durationMinutes: 60,
  activeBonos: [{ ...activeBono, minutosTotales: 300, minutosRestantes: 300 }],
});
assert.equal(moreThanEnough.ok, true);
assert.equal(moreThanEnough.writes.bono.minutosRestantes, 60);

const exactMinutes = basePlan({
  durationMinutes: 60,
  activeBonos: [{ ...activeBono, minutosTotales: 240, minutosRestantes: 240 }],
});
assert.equal(exactMinutes.ok, true);
assert.equal(exactMinutes.writes.occurrenceCount, 4);
assert.equal(exactMinutes.writes.totalMinutes, 240);
assert.equal(exactMinutes.writes.minutesDeductedAmount, 60);
assert.equal(exactMinutes.writes.bono.minutosRestantes, 0);
assert.equal(exactMinutes.writes.bono.estado, "agotado");
assert.equal(exactMinutes.writes.dates.length, 4);
exactMinutes.writes.dates.forEach((date, index) => {
  assert.equal(exactMinutes.writes.dates[index], date);
});

const occupancyKeys = collectRecurringOccupancyKeys(["2026-09-07"], "10:00", 60);
assert.deepEqual(occupancyKeys, getSlotBlocks("10:00", 60).map((time) => `2026-09-07_${time}`));
assert.equal(occupancyKeys.length, 4);

const allFree = basePlan({ siteConfig: { ...siteConfig, maxCapacity: 5 } });
assert.equal(allFree.ok, true);

const oneFull = basePlan({
  siteConfig: { ...siteConfig, maxCapacity: 5 },
  occupancyByKey: new Map([["2026-09-28_10:00", 5]]),
});
assert.equal(oneFull.ok, false);
assert.deepEqual(oneFull.writes, []);
assert.equal(oneFull.message, "La franja del 28/09/2026 a las 10:00 esta completa.");

const capacityFourOfFive = basePlan({
  siteConfig: { ...siteConfig, maxCapacity: 5 },
  occupancyByKey: new Map([["2026-09-07_10:00", 4]]),
});
assert.equal(capacityFourOfFive.ok, true);

const blocked = basePlan({
  blockedKeys: new Set(["2026-10-05_10:00"]),
  endDate: "2026-10-05",
  activeBonos: [{ ...activeBono, minutosRestantes: 999, minutosTotales: 999 }],
});
assert.equal(blocked.ok, false);
assert.deepEqual(blocked.writes, []);
assert.equal(blocked.message, "La franja del 05/10/2026 esta bloqueada.");

const conflict = basePlan({
  userSlotKeys: new Set(["2026-10-12_10:00"]),
  endDate: "2026-10-12",
  activeBonos: [{ ...activeBono, minutosRestantes: 999, minutosTotales: 999 }],
});
assert.equal(conflict.ok, false);
assert.deepEqual(conflict.writes, []);
assert.equal(conflict.message, "El cliente ya tiene una cita que se solapa el 12/10/2026.");

const expiredBono = basePlan({
  activeBonos: [{ ...activeBono, fechaExpiracion: "2026-09-20T21:59:59.999Z" }],
});
assert.equal(expiredBono.ok, false);
assert.deepEqual(expiredBono.writes, []);
assert.equal(expiredBono.message, "El bono caduca antes de finalizar la serie.");

const sameDayExpiration = basePlan({
  endDate: "2026-09-28",
  activeBonos: [{ ...activeBono, fechaExpiracion: "2026-09-28T21:59:59.999Z", minutosRestantes: 240, minutosTotales: 240 }],
});
assert.equal(sameDayExpiration.ok, true);

const noBono = basePlan({ activeBonos: [] });
assert.equal(noBono.ok, false);
assert.deepEqual(noBono.writes, []);
assert.match(noBono.message, /no tiene un bono activo/i);

const manyBonos = basePlan({
  activeBonos: [activeBono, { ...activeBono, id: "bono-b" }],
});
assert.equal(manyBonos.ok, false);
assert.deepEqual(manyBonos.writes, []);
assert.match(manyBonos.message, /mas de un bono activo/i);

const pastStart = basePlan({ now: new Date("2026-09-07T10:00:01") });
assert.equal(pastStart.ok, false);
assert.deepEqual(pastStart.writes, []);
assert.match(pastStart.message, /07\/09\/2026/);

const offSchedule = basePlan({ startTime: "21:00" });
assert.equal(offSchedule.ok, false);
assert.deepEqual(offSchedule.writes, []);

const refund = calculateAppointmentRefund(
  { id: "bono-a", estado: "agotado", minutosTotales: 240, minutosRestantes: 0 },
  {
    bonoId: "bono-a",
    minutesDeducted: true,
    minutesDeductedAmount: 60,
    minutesDeductedAt: "2026-09-07T09:00:00.000Z",
    minutesRefundedAt: null,
  },
  "2026-09-08T10:00:00.000Z",
);
assert.equal(refund.ok, true);
assert.equal(refund.minutesRefundedAmount, 60);
assert.equal(refund.remainingMinutes, 60);
assert.equal(refund.bonoStatus, "activo");

const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
const recurringSource = indexSource.slice(
  indexSource.indexOf("export const createRecurringAppointmentsFromAdmin"),
  indexSource.indexOf("export const sendContactMessage"),
);
assert.match(recurringSource, /db\.runTransaction/);
assert.match(recurringSource, /planRecurringAppointments/);
assert.match(recurringSource, /transaction\.get\(ref\)/);
assert.match(recurringSource, /appointment_recurrences/);
assert.match(recurringSource, /recurring_appointments_created/);
assert.match(recurringSource, /accion:\s*"descuento_cita"/);
assert.doesNotMatch(recurringSource, /sendAppointmentStatusPushNotification/);
assert.doesNotMatch(recurringSource, /sendAppointmentMakeNotificationSafely/);
assert.match(indexSource, /export const createRecurringAppointmentsFromAdmin\s*=\s*onCall/);
assert.match(indexSource, /selectExactlyOneActiveBono/);
assert.match(indexSource, /config\.maxCapacity/);
assert.doesNotMatch(indexSource, /const MAX_CAPACITY\s*=\s*2/);

const maxCheckAt = recurringSource.indexOf("occurrenceDates.length > MAX_RECURRING_OCCURRENCES");
const occupancyKeysAt = recurringSource.indexOf("collectRecurringOccupancyKeys");
const occupancyRefsAt = recurringSource.indexOf("occupancyRefs");
const blockedSlotsAt = recurringSource.indexOf("blocked_slots");
const runTransactionAt = recurringSource.indexOf("db.runTransaction");
assert.ok(maxCheckAt > 0, "callable must reject series longer than MAX_RECURRING_OCCURRENCES");
assert.ok(maxCheckAt < occupancyKeysAt, "MAX 20 must be checked before occupancy keys");
assert.ok(maxCheckAt < occupancyRefsAt, "MAX 20 must be checked before occupancyRefs");
assert.ok(maxCheckAt < blockedSlotsAt, "MAX 20 must be checked before blocked_slots queries");
assert.ok(maxCheckAt < runTransactionAt, "MAX 20 must be checked before runTransaction");

console.log("recurring appointment tests passed");
