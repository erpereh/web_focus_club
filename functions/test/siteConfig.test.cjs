const assert = require("node:assert/strict");
const {
  DEFAULT_SITE_CONFIG,
  generateTimeSlots,
  normalizeMaxCapacity,
  normalizeSiteConfig,
} = require("../lib/siteConfig.js");

assert.equal(normalizeMaxCapacity(undefined), 2);
assert.equal(normalizeMaxCapacity(null), 2);
assert.equal(normalizeMaxCapacity(NaN), 2);
assert.equal(normalizeMaxCapacity("abc"), 2);
assert.equal(normalizeMaxCapacity(""), 2);
assert.equal(normalizeMaxCapacity(0), 1);
assert.equal(normalizeMaxCapacity(1), 1);
assert.equal(normalizeMaxCapacity(5), 5);
assert.equal(normalizeMaxCapacity(10), 10);
assert.equal(normalizeMaxCapacity(99), 10);
assert.equal(normalizeMaxCapacity("5"), 5);

const legacyConfig = normalizeSiteConfig({
  startHour: 8,
  endHour: 20,
  slotInterval: 30,
  bonoExpirationMonths: 1,
});
assert.equal(legacyConfig.maxCapacity, 2);
assert.equal(legacyConfig.startHour, 8);
assert.equal(legacyConfig.endHour, 20);
assert.equal(legacyConfig.slotInterval, 30);
assert.equal(legacyConfig.bonoExpirationMonths, 1);
assert.equal(DEFAULT_SITE_CONFIG.maxCapacity, 2);
assert.equal(normalizeSiteConfig().maxCapacity, 2);
assert.equal(normalizeSiteConfig({ maxCapacity: 5 }).maxCapacity, 5);

for (const interval of [15, 30, 45, 60]) {
  assert.equal(normalizeSiteConfig({ slotInterval: interval }).slotInterval, interval);
}
assert.equal(normalizeSiteConfig({ slotInterval: 20 }).slotInterval, 30);

assert.deepEqual(generateTimeSlots({ startHour: 7, endHour: 20, slotInterval: 15 }).slice(0, 5), ["07:00", "07:15", "07:30", "07:45", "08:00"]);
assert.deepEqual(generateTimeSlots({ startHour: 7, endHour: 20, slotInterval: 30 }).slice(0, 5), ["07:00", "07:30", "08:00", "08:30", "09:00"]);
assert.deepEqual(generateTimeSlots({ startHour: 7, endHour: 20, slotInterval: 45 }).slice(0, 5), ["07:00", "07:45", "08:30", "09:15", "10:00"]);
assert.deepEqual(generateTimeSlots({ startHour: 7, endHour: 20, slotInterval: 60 }).slice(0, 5), ["07:00", "08:00", "09:00", "10:00", "11:00"]);

console.log("site config tests passed");
