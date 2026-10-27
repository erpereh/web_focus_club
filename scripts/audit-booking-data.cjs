#!/usr/bin/env node
// Read-only audit of booking data (slot_occupancy, appointments, bonos,
// appointment_recurrences). Every Firestore write API is disabled before the
// client is created, so this script cannot modify production.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json \
//     node scripts/audit-booking-data.cjs [--out report.json] [--start YYYY-MM-DD]
//   ... node scripts/audit-booking-data.cjs --series <seriesId> [--out report.json]
//     Runs, in order, every check of the series approval and prints which one fails.
// Requires `npm --prefix functions run build` (reuses the compiled planners).

const fs = require("node:fs");
const path = require("node:path");
const { initializeApp, cert, applicationDefault } = require("firebase-admin/app");
const firestoreModule = require("firebase-admin/firestore");

// ------------------------------------------------------------- write guard
function forbid(name) {
  return function forbiddenWrite() {
    throw new Error(`[audit] Escritura bloqueada (${name}): este script es de solo lectura.`);
  };
}
const guarded = [
  [firestoreModule.DocumentReference.prototype, ["set", "update", "delete", "create"]],
  [firestoreModule.CollectionReference.prototype, ["add"]],
  [firestoreModule.WriteBatch.prototype, ["set", "update", "delete", "create", "commit"]],
  [firestoreModule.Transaction.prototype, ["set", "update", "delete", "create"]],
  [firestoreModule.BulkWriter.prototype, ["set", "update", "delete", "create", "flush", "close"]],
  [firestoreModule.Firestore.prototype, ["runTransaction", "batch", "bulkWriter", "recursiveDelete"]],
];
for (const [proto, methods] of guarded) {
  for (const method of methods) {
    Object.defineProperty(proto, method, { value: forbid(method), writable: false, configurable: false });
  }
}

const libDir = path.join(__dirname, "..", "functions", "lib");
const { planSlotOccupancyReconciliation } = require(path.join(libDir, "slotMigrations.js"));
const {
  getCanonicalSlotBlocks,
  getMadridDateKey,
  getAppointmentEffectiveSlot,
  madridCivilSlotToInstant,
} = require(path.join(libDir, "appointmentLifecycle.js"));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function credential() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && fs.existsSync(keyPath)) return cert(JSON.parse(fs.readFileSync(keyPath, "utf8")));
  return applicationDefault();
}

const ACTIVE = new Set(["pending", "approved"]);

function durationOf(data) {
  const minutes = Number.parseInt(String(data.duration ?? ""), 10);
  return [30, 45, 60].includes(minutes) ? minutes : 0;
}

function summarizeAppointment(id, data) {
  const slot = getAppointmentEffectiveSlot(data);
  return {
    id,
    status: data.status,
    slot: slot ? `${slot.date} ${slot.time}` : null,
    duration: data.duration ?? null,
    appointmentType: data.appointmentType ?? "training",
    recurrenceSeriesId: data.recurrenceSeriesId ?? null,
    createdByAdmin: data.createdByAdmin === true,
    approvedSlot: data.approvedSlot ?? null,
    preferredSlot0: Array.isArray(data.preferredSlots) ? data.preferredSlots[0] ?? null : null,
    updatedAt: data.updatedAt ?? null,
  };
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

// --------------------------------------------------- single series (--series)
// Same checks, in the same order, as approveRecurringAppointmentSeriesFromAdmin
// (functions/src/recurringSeries.ts) and validateReservedSeriesMinutes.
async function inspectSeries(db, seriesId) {
  const seriesSnap = await db.collection("appointment_recurrences").doc(seriesId).get();
  if (!seriesSnap.exists) return { seriesId, exists: false };
  const series = seriesSnap.data();
  const occurrencesSnap = await db.collection("appointments").where("recurrenceSeriesId", "==", seriesId).get();
  const occurrences = occurrencesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const active = occurrences.filter((item) => ACTIVE.has(item.data.status));
  const duration = Number(series.duration);
  const nowMs = Date.now();

  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  check("series_pending", series.status === "pending", series.status);
  check("series_has_bono", Boolean(series.bonoId), series.bonoId ?? null);
  check("series_duration_valid", [30, 45, 60].includes(duration), series.duration ?? null);
  check("active_count_in_range", active.length >= 1 && active.length <= 20, active.length);
  check("active_count_matches_metadata", active.length === series.occurrenceCount, {
    stored: series.occurrenceCount ?? null,
    active: active.length,
  });
  check("total_minutes_matches_metadata", series.totalMinutes === active.length * duration, {
    stored: series.totalMinutes ?? null,
    expected: active.length * duration,
  });

  const seen = new Map();
  const occurrenceProblems = [];
  for (const { id, data } of active) {
    const problems = [];
    const index = data.recurrenceIndex;
    if (!Number.isInteger(index) || index < 0) problems.push("invalid_index");
    else if (seen.has(index)) problems.push(`duplicate_index_with_${seen.get(index)}`);
    else seen.set(index, id);
    if (data.userId !== series.userId) problems.push("user_mismatch");
    if (data.recurrenceSeriesId !== seriesId) problems.push("series_mismatch");
    if (Number(data.duration) !== duration) problems.push(`duration_${data.duration ?? "missing"}`);
    if (data.bonoId !== series.bonoId) problems.push(`bono_${data.bonoId ?? "missing"}`);
    if (data.minutesDeducted !== true) problems.push("not_deducted");
    if (data.minutesDeductedAmount !== duration) problems.push(`deducted_amount_${data.minutesDeductedAmount ?? "missing"}`);
    if (data.minutesRefunded === true || data.minutesRefundedAt) problems.push("already_refunded");
    if (problems.length) occurrenceProblems.push({ id, problems });
  }
  const structural = occurrenceProblems.filter((item) => item.problems.some((problem) =>
    /^(invalid_index|duplicate_index|user_mismatch|series_mismatch|duration_)/.test(problem)));
  check("occurrences_structure_valid", structural.length === 0, structural);

  const bonoSnap = series.bonoId ? await db.collection("bonos").doc(series.bonoId).get() : undefined;
  const bono = bonoSnap?.exists ? bonoSnap.data() : undefined;
  check("bono_exists", Boolean(bono), series.bonoId ?? null);
  check("bono_belongs_to_user", !bono?.userId || bono.userId === series.userId, bono?.userId ?? null);
  const financial = occurrenceProblems.filter((item) => item.problems.some((problem) =>
    /^(bono_|not_deducted|deducted_amount_|already_refunded)/.test(problem)));
  check("occurrences_reservation_valid", financial.length === 0, financial);
  const deductedTotal = active.reduce((total, item) => total + (Number(item.data.minutesDeductedAmount) || 0), 0);
  check("deducted_total_matches_metadata", deductedTotal === series.totalMinutes, {
    stored: series.totalMinutes ?? null,
    deducted: deductedTotal,
  });
  const pendingFuture = active.filter((item) => {
    if (item.data.status !== "pending") return false;
    const slot = getAppointmentEffectiveSlot(item.data);
    const instant = slot ? madridCivilSlotToInstant(slot) : undefined;
    return instant && instant.getTime() > nowMs;
  });
  check("has_pending_future_occurrence", pendingFuture.length > 0, pendingFuture.map((item) => item.id));

  const occurrenceIds = occurrences.map((item) => item.id);
  const [deletionsSnap, seriesLogsSnap, ...appointmentLogSnaps] = await Promise.all([
    db.collection("appointment_deletions").where("appointment.recurrenceSeriesId", "==", seriesId).get(),
    db.collection("activity_logs").where("seriesId", "==", seriesId).get(),
    ...chunks(occurrenceIds, 30).map((ids) => db.collection("activity_logs").where("appointmentId", "in", ids).get()),
  ]);
  const logs = [seriesLogsSnap, ...appointmentLogSnaps]
    .flatMap((snap) => snap.docs)
    .filter((doc, index, all) => all.findIndex((other) => other.id === doc.id) === index)
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        action: data.action ?? null,
        appointmentId: data.appointmentId ?? null,
        previousStatus: data.previousStatus ?? data.oldStatus ?? null,
        newStatus: data.newStatus ?? null,
        at: data.createdAt ?? data.timestamp ?? null,
      };
    })
    .sort((left, right) => String(left.at).localeCompare(String(right.at)));

  // Bono deductions of this series' appointments that no longer exist and were never returned.
  const historial = Array.isArray(bono?.historial) ? bono.historial : [];
  const refunded = new Set(historial.filter((entry) => entry?.accion === "devolucion_cita").map((entry) => entry.appointmentId));
  const existingIds = new Set(occurrenceIds);
  const candidateIds = [...new Set(historial
    .filter((entry) => entry?.appointmentId && entry.accion !== "devolucion_cita" && !existingIds.has(entry.appointmentId))
    .map((entry) => entry.appointmentId))];
  const candidateSnaps = candidateIds.length
    ? await db.getAll(...candidateIds.map((id) => db.collection("appointments").doc(id)))
    : [];
  const missingIds = new Set(candidateSnaps.filter((snap) => !snap.exists).map((snap) => snap.id));
  const orphanDeductions = historial
    .filter((entry) => missingIds.has(entry.appointmentId) && !refunded.has(entry.appointmentId))
    .map((entry) => ({ appointmentId: entry.appointmentId, duracion: entry.duracion ?? null, fecha: entry.fecha ?? null }));

  return {
    seriesId,
    exists: true,
    readOnly: true,
    firstFailedCheck: checks.find((item) => !item.ok)?.name ?? null,
    checks,
    series: {
      status: series.status,
      origin: series.origin ?? null,
      userId: series.userId,
      duration: series.duration,
      bonoId: series.bonoId ?? null,
      occurrenceCount: series.occurrenceCount,
      totalMinutes: series.totalMinutes,
      createdAt: series.createdAt ?? null,
      updatedAt: series.updatedAt ?? null,
      approvedAt: series.approvedAt ?? null,
      lastRescheduledAt: series.lastRescheduledAt ?? null,
      lastRescheduleScope: series.lastRescheduleScope ?? null,
      lastRescheduleAppointmentId: series.lastRescheduleAppointmentId ?? null,
    },
    occurrences: occurrences
      .map(({ id, data }) => ({
        ...summarizeAppointment(id, data),
        recurrenceIndex: data.recurrenceIndex ?? null,
        userId: data.userId ?? null,
        bonoId: data.bonoId ?? null,
        minutesDeducted: data.minutesDeducted ?? null,
        minutesDeductedAmount: data.minutesDeductedAmount ?? null,
        minutesRefunded: data.minutesRefunded ?? null,
        minutesRefundedAt: data.minutesRefundedAt ?? null,
        cancellationReason: data.cancellationReason ?? null,
        problems: occurrenceProblems.find((item) => item.id === id)?.problems ?? [],
      }))
      .sort((left, right) => (left.recurrenceIndex ?? 999) - (right.recurrenceIndex ?? 999)),
    deletionRecords: deletionsSnap.docs.map((doc) => ({
      appointmentId: doc.id,
      deletedAt: doc.data().deletedAt ?? null,
      status: doc.data().appointment?.status ?? null,
      refundStatus: doc.data().finance?.refundStatus ?? null,
    })),
    activityLogs: logs,
    orphanBonoDeductions: orphanDeductions,
  };
}

async function main() {
  initializeApp({ credential: credential(), projectId: process.env.GCLOUD_PROJECT || "focus-club-f73b8" });
  const db = firestoreModule.getFirestore();
  const seriesId = argValue("--series");
  if (seriesId) {
    const report = await inspectSeries(db, seriesId);
    const out = argValue("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const today = getMadridDateKey(new Date());
  const startDate = argValue("--start") ?? today;

  const [appointmentsSnap, occupancySnap, bonosSnap, seriesSnap, configSnap, blockedSnap] = await Promise.all([
    db.collection("appointments").get(),
    db.collection("slot_occupancy").get(),
    db.collection("bonos").get(),
    db.collection("appointment_recurrences").get(),
    db.collection("site_config").doc("main").get(),
    db.collection("blocked_slots").where("date", ">=", startDate).get(),
  ]);

  const config = configSnap.exists ? configSnap.data() : {};
  const maxCapacity = Number.isInteger(config.maxCapacity) ? config.maxCapacity : 2;
  const appointments = appointmentsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const appointmentById = new Map(appointments.map((item) => [item.id, item.data]));
  const occupancyDocuments = occupancySnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const approved = appointments.filter((item) => item.data.status === "approved");

  // ---------------------------------------------------- occupancy (dryRun)
  const plan = planSlotOccupancyReconciliation({ appointments: approved, occupancyDocuments, startDate });
  const contributorsByKey = new Map();
  for (const { id, data } of approved) {
    const slot = getAppointmentEffectiveSlot(data);
    const duration = durationOf(data);
    if (!slot || !duration || slot.date < startDate) continue;
    for (const time of getCanonicalSlotBlocks(slot.time, duration)) {
      const key = `${slot.date}_${time}`;
      if (!contributorsByKey.has(key)) contributorsByKey.set(key, []);
      contributorsByKey.get(key).push(id);
    }
  }
  const actualById = new Map(occupancyDocuments.map((doc) => [doc.id, doc.data]));
  const differences = plan.operations.map((operation) => {
    const actual = actualById.get(operation.id);
    const expectedCount = operation.type === "delete" ? 0 : operation.data.count;
    const actualCount = actual ? actual.count : null;
    return {
      key: operation.id,
      operation: operation.type === "delete" ? "delete" : actual ? "update" : "create",
      expectedCount,
      actualCount,
      actualData: actual ?? null,
      contributors: (contributorsByKey.get(operation.id) ?? []).map((id) => summarizeAppointment(id, appointmentById.get(id))),
      falseFull: typeof actualCount === "number" && actualCount >= maxCapacity && expectedCount < maxCapacity,
    };
  });

  const invalidCounts = occupancyDocuments
    .filter((doc) => !Number.isInteger(doc.data.count) || doc.data.count < 0 || typeof doc.data.date !== "string" || typeof doc.data.time !== "string"
      || doc.id !== `${doc.data.date}_${doc.data.time}`)
    .map((doc) => ({ id: doc.id, data: doc.data }));

  // --------------------------------------------------------- appointments
  const appointmentIssues = [];
  for (const { id, data } of appointments) {
    const issues = [];
    if (!durationOf(data) && ACTIVE.has(data.status)) issues.push("invalid_duration");
    const hasPreferred = Array.isArray(data.preferredSlots) && data.preferredSlots.length > 0;
    if (ACTIVE.has(data.status) && !data.approvedSlot && !hasPreferred) issues.push("legacy_date_time_only");
    if (data.status === "approved" && !data.approvedSlot) issues.push("approved_without_approvedSlot");
    if (data.status === "pending" && data.approvedSlot && hasPreferred
      && (data.approvedSlot.date !== data.preferredSlots[0].date || data.approvedSlot.time !== data.preferredSlots[0].time)) {
      issues.push("pending_with_stale_approvedSlot");
    }
    const training = data.appointmentType !== "nutrition";
    if (training && data.minutesDeducted === true && !data.bonoId) issues.push("deducted_without_bonoId");
    if (training && ["rejected", "cancelled"].includes(data.status) && data.minutesDeducted === true && !data.minutesRefundedAt) {
      issues.push("inactive_not_refunded");
    }
    if (data.minutesDeductionSkippedAt && data.status === "approved") issues.push("approved_deduction_skipped");
    if (issues.length) appointmentIssues.push({ ...summarizeAppointment(id, data), issues, minutesRefundReason: data.minutesRefundReason ?? null });
  }

  // ---------------------------------------------------------------- bonos
  const bonos = bonosSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const activeByUser = new Map();
  for (const bono of bonos) {
    if (bono.data.estado !== "activo") continue;
    if (!activeByUser.has(bono.data.userId)) activeByUser.set(bono.data.userId, []);
    activeByUser.get(bono.data.userId).push(bono.id);
  }
  const multipleActiveBonos = [...activeByUser.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([userId, ids]) => ({ userId, bonoIds: ids }));
  const bonoIssues = [];
  for (const { id, data } of bonos) {
    const issues = [];
    const total = Math.max(Number(data.tamano) || 0, Number(data.minutosTotales) || 0);
    if (typeof data.minutosRestantes === "number" && (data.minutosRestantes < 0 || data.minutosRestantes > total)) {
      issues.push("remaining_out_of_range");
    }
    // Deductions of appointments that no longer exist and were never returned.
    const historial = Array.isArray(data.historial) ? data.historial : [];
    const refunded = new Set(historial.filter((entry) => entry?.accion === "devolucion_cita").map((entry) => entry.appointmentId));
    const orphanDeductions = historial
      .filter((entry) => entry?.appointmentId && entry.accion !== "devolucion_cita" && !appointmentById.has(entry.appointmentId) && !refunded.has(entry.appointmentId))
      .map((entry) => ({ appointmentId: entry.appointmentId, duracion: entry.duracion ?? null, fecha: entry.fecha ?? null }));
    if (orphanDeductions.length) issues.push("deductions_of_deleted_appointments");
    if (issues.length) {
      bonoIssues.push({ id, userId: data.userId, estado: data.estado, minutosRestantes: data.minutosRestantes, total, issues, orphanDeductions });
    }
  }

  // --------------------------------------------------------------- series
  const seriesIssues = [];
  for (const doc of seriesSnap.docs) {
    const series = doc.data();
    const occurrences = appointments.filter((item) => item.data.recurrenceSeriesId === doc.id);
    const active = occurrences.filter((item) => ACTIVE.has(item.data.status));
    const duration = Number.parseInt(String(series.duration ?? ""), 10);
    const expectedMinutes = active.length * duration;
    if (["pending", "approved"].includes(series.status)
      && (series.occurrenceCount !== active.length || series.totalMinutes !== expectedMinutes)) {
      const nowMs = Date.now();
      const startsAt = (item) => {
        const slot = getAppointmentEffectiveSlot(item.data);
        const instant = slot ? madridCivilSlotToInstant(slot) : undefined;
        return instant ? instant.getTime() : undefined;
      };
      const futureActive = active.filter((item) => (startsAt(item) ?? 0) > nowMs);
      const cancelled = occurrences.filter((item) => item.data.status === "cancelled");
      const rejected = occurrences.filter((item) => item.data.status === "rejected");
      const missingDocs = Math.max(0, Number(series.occurrenceCount ?? 0) - occurrences.length);
      const category = futureActive.length > 0
        ? "active_future"
        : active.length > 0 ? "active_past_only" : "historical_no_active";
      const causes = [
        ...(cancelled.length ? ["individual_cancellation"] : []),
        ...(rejected.length ? ["individual_rejection"] : []),
        ...(missingDocs > 0 ? ["deleted_occurrences"] : []),
      ];
      // Operations that require occurrenceCount/totalMinutes to match the active occurrences.
      const blockedOperations = category === "active_future"
        ? series.status === "approved"
          // A customer rescheduling one session turns the series pending again.
          ? ["return_series_to_pending", "approve_series_after_customer_reschedule"]
          : ["approve_series", "replace_pending_series_schedule"]
        : [];
      seriesIssues.push({
        id: doc.id,
        status: series.status,
        origin: series.origin ?? null,
        category,
        causes: causes.length ? causes : ["unknown"],
        blockedOperations,
        occurrenceCount: series.occurrenceCount,
        totalDocs: occurrences.length,
        activeOccurrences: active.length,
        futureActiveOccurrences: futureActive.length,
        nextActiveSlot: futureActive
          .map((item) => getAppointmentEffectiveSlot(item.data))
          .filter(Boolean)
          .map((slot) => `${slot.date} ${slot.time}`)
          .sort()[0] ?? null,
        totalMinutes: series.totalMinutes,
        expectedMinutes,
        cancelledOccurrences: cancelled.map((item) => item.id),
        rejectedOccurrences: rejected.map((item) => item.id),
        missingDocs,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    startDate,
    maxCapacity,
    slotInterval: config.slotInterval ?? null,
    totals: {
      appointments: appointments.length,
      approved: approved.length,
      occupancyDocuments: occupancyDocuments.length,
      bonos: bonos.length,
      series: seriesSnap.size,
      blockedSlotsFromStart: blockedSnap.size,
    },
    occupancyReconciliation: plan.report,
    occupancyDifferences: differences,
    falseFullSlots: differences.filter((item) => item.falseFull),
    invalidOccupancyDocuments: invalidCounts,
    appointmentIssues,
    multipleActiveBonos,
    bonoIssues,
    seriesIssues,
  };

  const out = argValue("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    startDate,
    maxCapacity,
    totals: report.totals,
    reconciliation: plan.report,
    falseFullSlots: report.falseFullSlots.map((item) => `${item.key} real=${item.actualCount} esperado=${item.expectedCount}`),
    differences: differences.length,
    invalidOccupancyDocuments: invalidCounts.length,
    appointmentIssueCounts: appointmentIssues.flatMap((item) => item.issues).reduce((acc, issue) => ({ ...acc, [issue]: (acc[issue] ?? 0) + 1 }), {}),
    multipleActiveBonos: multipleActiveBonos.length,
    bonoIssueCounts: bonoIssues.flatMap((item) => item.issues).reduce((acc, issue) => ({ ...acc, [issue]: (acc[issue] ?? 0) + 1 }), {}),
    seriesIssues: seriesIssues.length,
    seriesByCategory: seriesIssues.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {}),
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit] Error:", error?.message ?? error);
  process.exit(1);
});
