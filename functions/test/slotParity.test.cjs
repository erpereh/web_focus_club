// Server half of the web/server parity check. The web half
// (src/lib/admin-slot-status.test.ts) evaluates the same fixture with the
// admin "Nueva cita" grid; both must reach the same verdict.
const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("./fixtures/slot-parity.json");
const { evaluateSlot, loadSlotDay } = require("../lib/slotValidation.js");
const { normalizeSiteConfig } = require("../lib/siteConfig.js");
const { FakeFirestore } = require("./helpers/transactionalFakes.cjs");

const reader = { get: (target) => target.get() };

for (const testCase of fixture.cases) {
  test(`parity: ${testCase.name}`, async () => {
    const documents = {};
    for (const [time, count] of Object.entries(testCase.occupancy)) {
      documents[`slot_occupancy/${fixture.date}_${time}`] = { date: fixture.date, time, count };
    }
    for (const time of testCase.blocked) {
      documents[`blocked_slots/${fixture.date}_${time}`] = { date: fixture.date, time };
    }
    const db = new FakeFirestore(documents);
    const config = normalizeSiteConfig(fixture.config);
    const day = await loadSlotDay(reader, db, config, fixture.date);
    const customerAppointments = testCase.customerBooked
      ? [{
        id: "other",
        data: {
          status: "approved",
          duration: String(testCase.customerBooked.duration),
          approvedSlot: { date: fixture.date, time: testCase.customerBooked.time },
        },
      }]
      : [];
    const verdict = evaluateSlot(day, {
      slot: { date: fixture.date, time: testCase.time },
      durationMinutes: testCase.duration,
      appointmentType: "training",
      now: new Date("2026-10-14T08:00:00.000Z"),
      customerAppointments,
    });
    assert.equal(verdict ?? null, testCase.expected);
  });
}
