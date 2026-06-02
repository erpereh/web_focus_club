const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCalendarSyncHash,
  normalizeAppointmentStatus,
  normalizeDurationMinutes,
  resolveAppointmentSlot,
} = require("../lib/googleCalendarSync.js");

assert.equal(normalizeAppointmentStatus("pending"), "pending");
assert.equal(normalizeAppointmentStatus("pendiente"), "pending");
assert.equal(normalizeAppointmentStatus("aprobada"), "approved");
assert.equal(normalizeAppointmentStatus("rechazada"), "rejected");

assert.equal(normalizeDurationMinutes("45"), 45);
assert.equal(normalizeDurationMinutes("90"), 30);
assert.deepEqual(
  resolveAppointmentSlot({
    status: "approved",
    approvedSlot: { date: "2026-06-10", time: "10:00" },
    preferredSlots: [{ date: "2026-06-11", time: "11:00" }],
  }),
  { date: "2026-06-10", time: "10:00" },
);
assert.deepEqual(
  resolveAppointmentSlot({
    status: "pending",
    preferredSlots: [{ date: "2026-06-11", time: "11:00" }],
  }),
  { date: "2026-06-11", time: "11:00" },
);

const baseHashInput = {
  appointmentId: "appointment-a",
  appointment: {
    status: "pending",
    serviceType: "Entrenamiento",
    duration: "30",
    preferredSlots: [{ date: "2026-06-11", time: "11:00" }],
    googleCalendarSyncStatus: "error",
  },
  client: { name: "Ana", email: "ana@example.com", phone: "600000000" },
  trainerName: "Sandra",
};

const hashA = buildCalendarSyncHash(baseHashInput);
const hashB = buildCalendarSyncHash({
  ...baseHashInput,
  appointment: {
    ...baseHashInput.appointment,
    googleCalendarSyncStatus: "synced",
    googleCalendarSyncError: null,
  },
});
const hashC = buildCalendarSyncHash({
  ...baseHashInput,
  appointment: {
    ...baseHashInput.appointment,
    duration: "45",
  },
});

assert.equal(hashA, hashB);
assert.notEqual(hashA, hashC);

const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
assert.match(indexSource, /new google\.auth\.GoogleAuth/);
assert.match(indexSource, /secrets:\s*\[GOOGLE_CALENDAR_ID\]/);
assert.equal(indexSource.includes("serviceAccount:"), false);

console.log("googleCalendarSync helper tests passed");
