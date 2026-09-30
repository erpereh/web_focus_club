const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildCalendarSyncHash,
  buildCalendarEventPayload,
  normalizeAppointmentStatus,
  normalizeDurationMinutes,
  resolveAppointmentSlot,
  shouldDeleteRecurringPendingCalendarEvent,
} = require("../lib/googleCalendarSync.js");

assert.equal(shouldDeleteRecurringPendingCalendarEvent({
  beforeStatus: "approved",
  afterStatus: "pending",
  recurrenceSeriesId: "series-1",
  eventId: "event-1",
}), true);
assert.equal(shouldDeleteRecurringPendingCalendarEvent({
  beforeStatus: undefined,
  afterStatus: "pending",
  recurrenceSeriesId: "series-1",
  eventId: undefined,
}), false);
assert.equal(shouldDeleteRecurringPendingCalendarEvent({
  beforeStatus: "pending",
  afterStatus: "approved",
  recurrenceSeriesId: "series-1",
  eventId: "event-1",
}), false);

assert.equal(normalizeAppointmentStatus("pending"), "pending");
assert.equal(normalizeAppointmentStatus("pendiente"), "pending");
assert.equal(normalizeAppointmentStatus("aprobada"), "approved");
assert.equal(normalizeAppointmentStatus("rechazada"), "rejected");
assert.equal(normalizeAppointmentStatus("cancelada"), "cancelled");
assert.equal(buildCalendarEventPayload({
  appointmentId: "appointment-cancelled",
  appointment: {
    status: "cancelled",
    duration: "30",
    preferredSlots: [{ date: "2026-06-11", time: "11:00" }],
  },
  client: { name: "Ana", email: "ana@example.com", phone: "600000000" },
  trainerName: "Sandra",
}), undefined);

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

const notificationsSource = fs.readFileSync(path.join(__dirname, "../src/email/notifications.ts"), "utf8");
assert.match(notificationsSource, /ADMIN_NOTIFICATION_EMAIL\s*=\s*"infofocusclub2026@gmail\.com"/);
assert.match(notificationsSource, /SUGGESTIONS_RECIPIENT_EMAIL\s*=\s*"info@focusclub\.es"/);
assert.match(indexSource, /onDocumentCreated/);
assert.match(indexSource, /export const onAppointmentCreated/);
assert.match(indexSource, /recipientType:\s*"customer"\s*\|\s*"admin",\s*\n\s*recipientEmail:\s*string/);
assert.match(indexSource, /customerName:\s*appointment\.name/);
assert.match(indexSource, /customerEmail:\s*appointment\.email/);
assert.match(indexSource, /customerPhone:\s*appointment\.phone/);
assert.match(indexSource, /status:\s*appointmentStatus/);
assert.match(indexSource, /"confirmed",\s*\n\s*"admin",\s*\n\s*ADMIN_NOTIFICATION_EMAIL/);
assert.match(indexSource, /sendAppointmentEmailSafely\(event\.id,\s*appointmentId,\s*after,\s*action,\s*"customer",\s*after\.email\)/);
assert.match(indexSource, /sendAppointmentEmailSafely\(event\.id,\s*appointmentId,\s*after,\s*action,\s*"admin",\s*ADMIN_NOTIFICATION_EMAIL\)/);
assert.match(indexSource, /sendAppointmentEmailSafely\(\s*event\.id,\s*appointmentId,\s*appointment,\s*"deleted",\s*"customer",\s*appointment\.email,\s*"deleted",?\s*\)/);
assert.match(indexSource, /sendAppointmentEmailSafely\(\s*event\.id,\s*appointmentId,\s*appointment,\s*"deleted",\s*"admin",\s*ADMIN_NOTIFICATION_EMAIL,\s*"deleted",?\s*\)/);
assert.equal(indexSource.includes('"pending" | "confirmed" | "deleted"'), false);
assert.equal(indexSource.includes('"rejected" | "confirmed" | "deleted"'), false);
assert.equal(indexSource.includes('action: "pending"'), false);
assert.equal(indexSource.includes('action: "rejected"'), false);

// Email infrastructure is Brevo only: no Make webhooks or Resend left.
for (const legacy of ["MAKE_WEBHOOK_URL", "MAKE_WELCOME_WEBHOOK_URL", "RESEND_API_KEY", "sendMakeWebhook", "sendWelcomeWebhook", "Resend"]) {
  assert.equal(indexSource.includes(legacy), false, `${legacy} should be removed`);
}
assert.match(indexSource, /import \{ BREVO_API_KEY/);
assert.equal((indexSource.match(/secrets:\s*\[BREVO_API_KEY\]/g) ?? []).length, 7);

assert.match(indexSource, /function getWelcomeCustomerName/);
assert.match(indexSource, /export const onUserProfileCreatedWelcomeEmail\s*=\s*onDocumentCreated/);
assert.match(indexSource, /document:\s*"users\/\{uid\}"/);
assert.match(indexSource, /sendWelcomeEmail\(emailDeps\(\)/);
assert.match(indexSource, /welcomeEmailSentAt/);
assert.match(indexSource, /welcomeEmailStatus:\s*"sent"/);
assert.match(indexSource, /welcomeEmailStatus:\s*"failed"/);
assert.match(indexSource, /welcomeEmailLastAttemptAt/);
assert.match(indexSource, /welcomeEmailLastError/);

console.log("googleCalendarSync helper tests passed");
