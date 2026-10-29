// Contract with the published Android/iOS app (app_focus_club). The app must
// keep working without an update, so these names, payloads, response keys,
// error reasons and document shapes are frozen. Taken from
// app_focus_club/lib/features/client/data/portal_repository.dart,
// portal_models.dart and portal_availability.dart.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const src = (file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
const indexSource = src("index.ts");
const { SLOT_REJECTION_MESSAGES } = require("../lib/slotValidation.js");
const { CONFIRMATION_REJECTION_MESSAGES } = require("../lib/appointmentProposals.js");

const CALLABLES_USED_BY_APP = [
  "createAppointment",
  "createRecurringAppointments",
  "cancelOwnAppointment",
  "respondToAppointmentConfirmation",
  "cancelOwnRecurringAppointmentSeries",
  "updateOwnAppointmentSlot",
  "rescheduleOwnRecurringAppointment",
  "replaceOwnRecurringSeriesSchedule",
  "createSupportConversation",
  "sendSupportMessage",
  "markSupportConversationRead",
  "submitCustomerSuggestion",
];

test("every callable the app invokes is still exported as onCall in europe-west1", () => {
  assert.match(indexSource, /const REGION = "europe-west1";/);
  for (const name of CALLABLES_USED_BY_APP) {
    const match = new RegExp(`export const ${name} = onCall(?:<[^>]+>)?\\(\\s*\\{[^}]*region: REGION`).exec(indexSource);
    assert.ok(match, `${name} must stay an onCall in REGION`);
  }
});

test("slot rejection reasons mapped by the app keep their codes", () => {
  for (const reason of [
    "slot_not_future", "outside_schedule", "slot_blocked", "slot_full", "appointment_conflict",
    "trainer_unavailable", "trainer_not_nutrition", "professional_conflict",
    "booking_notice_too_short", "same_day_booking_disabled",
  ]) {
    assert.ok(SLOT_REJECTION_MESSAGES[reason], reason);
    assert.ok(CONFIRMATION_REJECTION_MESSAGES[reason], reason);
  }
  // Used by the app's recurring mapping; now also produced for corrupt counters.
  assert.ok(SLOT_REJECTION_MESSAGES.invalid_occupancy);
});

test("reasons read from details.reason by the app are still produced", () => {
  const sources = ["index.ts", "customerBooking.ts", "appointmentProposals.ts", "recurringReschedule.ts", "recurringSeries.ts", "appointmentLifecycle.ts"]
    .map(src).join("\n");
  for (const reason of [
    "same_day_change_not_allowed", "one_day_change_not_allowed", "invalid_occupancy",
    "recurring_occurrence_unavailable", "series_unavailable", "bono_unavailable", "insufficient_bono_minutes",
    "invalid_financial_reservation", "invalid_series_length",
    "already_responded", "proposal_not_pending", "no_confirmation_pending", "appointment_not_pending",
  ]) {
    assert.ok(sources.includes(`"${reason}"`), reason);
  }
});

test("createAppointment keeps the app payload: duration as string, preferredSlot, reason, appointmentType", () => {
  // index.ts exports it unchanged; the handler lives in customerBooking.ts.
  const exported = indexSource.slice(indexSource.indexOf("export const createAppointment ="), indexSource.indexOf("export const cancelOwnAppointment"));
  assert.match(exported, /customerBooking\.createAppointment/);
  const body = src("customerBooking.ts");
  assert.match(body, /String\(data\.duration\)/);
  assert.match(body, /\["30", "45", "60"\]/);
  assert.match(body, /isTimeSlot\(data\.preferredSlot\)/);
  assert.match(body, /data\.reason/);
  assert.match(body, /parseAppointmentTypeInput\(data\.appointmentType\)/);
  assert.match(body, /return \{ appointmentId \};/);
});

test("app-facing payload keys of the other callables are unchanged", () => {
  const cancelOwn = indexSource.slice(indexSource.indexOf("export const cancelOwnAppointment"), indexSource.indexOf("export const updateOwnAppointmentSlot"));
  assert.match(cancelOwn, /request\.data\.appointmentId/);
  assert.match(cancelOwn, /return \{ success: true, appointmentId \};/);
  const updateOwn = indexSource.slice(indexSource.indexOf("export const updateOwnAppointmentSlot"), indexSource.indexOf("export const onUserProfileCreatedWelcomeEmail"));
  assert.match(updateOwn, /request\.data\.preferredSlot/);
  const proposals = src("appointmentProposals.ts");
  assert.match(proposals, /action !== "accept" && action !== "decline"/);
  const series = src("recurringSeries.ts");
  assert.match(series, /seriesIdFrom/);
});

test("replaceOwnRecurringSeriesSchedule still returns every key the app validates", () => {
  const source = src("recurringReschedule.ts");
  for (const key of [
    "success", "seriesId", "affectedAppointmentIds", "reusedAppointmentIds", "createdAppointmentIds",
    "cancelledAppointmentIds", "occurrenceCount", "totalMinutes", "status",
  ]) {
    assert.match(source, new RegExp(`\\b${key}\\b`), key);
  }
});

test("every server write to slot_occupancy keeps {date, time, count:int} (no blind increments)", () => {
  const files = fs.readdirSync(path.join(__dirname, "../src")).filter((file) => file.endsWith(".ts"));
  for (const file of files) {
    const source = src(file);
    assert.doesNotMatch(source, /count:\s*FieldValue\.increment/, `${file} must write absolute counts`);
    const writes = [...source.matchAll(/collection\("slot_occupancy"\)\.doc\([^)]*\)\),?\s*\{([^}]*)\}/g)];
    for (const [, body] of writes) {
      assert.match(body, /date/, file);
      assert.match(body, /time/, file);
      assert.match(body, /count/, file);
    }
  }
});

test("appointment and bono states stay within the values the app parses", () => {
  // Modules added by the booking audit (index.ts also writes contact/email statuses).
  const files = ["adminAppointmentStatus.ts", "appointmentFinance.ts", "slotOccupancy.ts", "seriesMetadata.ts"].map(src).join("\n");
  const statuses = [...files.matchAll(/status: "([a-z_]+)"/g)].map((match) => match[1]);
  for (const status of statuses) {
    assert.ok(["pending", "approved", "rejected", "cancelled"].includes(status), `appointment status ${status}`);
  }
  const estados = [...files.matchAll(/estado: "([a-z]+)"/g)].map((match) => match[1]);
  for (const estado of estados) {
    assert.ok(["activo", "agotado", "expirado", "eliminado"].includes(estado), `bono estado ${estado}`);
  }
});

test("Firestore rules keep app reads and leave seat counters to Functions", () => {
  const rules = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
  const block = /match \/slot_occupancy\/\{slotId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? "";
  assert.match(block, /allow read: if isVerified\(\) \|\| isAdmin\(\);/);
  assert.match(block, /allow write: if false;/);
  // Per-date capacity is read like the counters; the published apps never query it.
  const exceptions = /match \/capacity_exceptions\/\{date\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? "";
  assert.match(exceptions, /allow read: if isVerified\(\) \|\| isAdmin\(\);/);
  assert.match(exceptions, /allow write: if false;/);
  // site_config stays publicly readable: every published app reads it before signing in.
  const config = /match \/site_config\/\{docId\} \{([\s\S]*?)\n    \}/.exec(rules)?.[1] ?? "";
  assert.match(config, /allow read: if true;/);
});
