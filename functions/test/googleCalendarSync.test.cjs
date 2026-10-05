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
// Admin appointment emails stay in the legacy triggers...
assert.match(indexSource, /sendAppointmentEmailSafely\(event\.id,\s*appointmentId,\s*after,\s*action,\s*"admin",\s*ADMIN_NOTIFICATION_EMAIL\)/);
assert.match(indexSource, /sendAppointmentEmailSafely\(\s*event\.id,\s*appointmentId,\s*appointment,\s*"deleted",\s*"admin",\s*ADMIN_NOTIFICATION_EMAIL,\s*"deleted",?\s*\)/);
// ...while every customer appointment notice goes through the central layer.
assert.doesNotMatch(indexSource, /sendAppointmentEmailSafely\([^)]*,\s*"customer",/);
assert.equal(indexSource.includes("onAppointmentStatusPushNotification"), false);
assert.equal(indexSource.includes("sendUserPushNotification"), false);
assert.match(indexSource, /export const onAppointmentCustomerNotification\s*=\s*onDocumentWritten/);
assert.match(indexSource, /export const onBonoCustomerNotification\s*=\s*onDocumentWritten/);
assert.match(indexSource, /export const onNotificationOutboxCreated\s*=\s*onDocumentCreated/);
for (const scheduled of ["bonoExpiryWarningsScheduled", "expireOverdueBonosScheduled", "appointmentRemindersScheduled", "retryNotificationDeliveriesScheduled"]) {
  assert.match(indexSource, new RegExp(`export const ${scheduled}\\s*=\\s*onSchedule`));
}
assert.match(indexSource, /timeZone:\s*"Europe\/Madrid"/);
assert.equal(indexSource.includes('"pending" | "confirmed" | "deleted"'), false);
assert.equal(indexSource.includes('"rejected" | "confirmed" | "deleted"'), false);
assert.equal(indexSource.includes('action: "pending"'), false);
assert.equal(indexSource.includes('action: "rejected"'), false);

// Notifications are Brevo + FCM + Firestore only: no Make webhooks or Resend
// anywhere in the functions source or its dependencies.
const LEGACY_EMAIL = /MAKE_[A-Z_]*WEBHOOK_URL|RESEND_API_KEY|sendMakeWebhook|sendWelcomeWebhook|\bResend\b|make\.com|"resend"/;
function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}
for (const file of [...sourceFiles(path.join(__dirname, "../src")), path.join(__dirname, "../package.json")]) {
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), LEGACY_EMAIL, `${path.basename(file)} still references Make/Resend`);
}
assert.match(indexSource, /import \{ BREVO_API_KEY/);
// 7 migrated email functions + 3 notification triggers + 2 email-capable schedulers.
assert.equal((indexSource.match(/secrets:\s*\[BREVO_API_KEY\]/g) ?? []).length, 12);

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
