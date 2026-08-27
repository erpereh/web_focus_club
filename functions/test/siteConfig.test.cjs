const assert = require("node:assert/strict");
const {
  DEFAULT_SITE_CONFIG,
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

console.log("site config tests passed");
