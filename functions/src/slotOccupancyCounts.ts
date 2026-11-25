import { FieldPath, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { madridCivilSlotToInstant } from "./appointmentLifecycle.js";
import { resolveMaxCapacity } from "./capacityExceptions.js";
import { RELEASE_CONTROL_PATH, RELEASE_QUEUE_PATH } from "./releaseMaintenance.js";
import { normalizeSiteConfig } from "./siteConfig.js";
import { auditHash } from "./slotOccupancyAudit.js";
import { appointmentOccupancyKeys, splitOccupancyKey } from "./slotOccupancy.js";

const PROJECT = "focus-club-f73b8";
export const SCHEMA = "focus-slot-occupancy-reviewed-counts-v1";
export const MODE = "reviewed-counts";
const ALLOWED = new Set(["07:30", "07:45", "08:00", "17:45", "18:00", "18:15", "18:30", "18:45", "19:00"]
  .map(time => "2026-11-26_" + time));
const VALID_KEY = /^\d{4}-\d{2}-\d{2}_\d{2}:(?:00|15|30|45)$/;
const CONFIG = "site_config/main";
const APPOINTMENT_FIELDS = ["status", "duration", "approvedSlot", "preferredSlots", "date", "time"] as const;

type Data = Record<string, unknown>;
type Evidence = { readonly id: string; readonly version: string | null; readonly data: Data | null };
type Difference = { readonly id: string; readonly current: number | null; readonly expected: number };
export interface CountsBackup {
  readonly projectId: string;
  readonly releaseId: string | null;
  readonly epoch: number;
  readonly counters: readonly Evidence[];
}
export interface CountsReport {
  readonly schema: typeof SCHEMA;
  readonly projectId: string;
  readonly releaseId: string | null;
  readonly epoch: number;
  readonly controlVersion: string | null;
  readonly manifestHash: string | null;
  readonly phase: unknown;
  readonly idle: boolean;
  readonly sourcesHash: string;
  readonly countersHash: string;
  readonly unaffectedHash: string;
  readonly backupHash: string;
  readonly differences: readonly Difference[];
  readonly issues: readonly string[];
  readonly validZeros: readonly string[];
  readonly overCapacity: ReadonlyArray<{ key: string; count: number; maxCapacity: number }>;
  readonly appointments: number;
  readonly counters: number;
  readonly reportHash: string;
}

function version(doc: DocumentSnapshot): string | null {
  return doc.updateTime ? `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}` : null;
}
function evidence(doc: DocumentSnapshot): Evidence {
  return { id: doc.id, version: version(doc), data: doc.data() ?? null };
}
function ordered(db: Firestore, collection: string) {
  return db.collection(collection).orderBy(FieldPath.documentId());
}
function validKey(id: string): boolean {
  return VALID_KEY.test(id) && Boolean(madridCivilSlotToInstant(splitOccupancyKey(id)));
}
function reviewedKey(project: string, id: string): boolean {
  return validKey(id) && (project !== PROJECT || ALLOWED.has(id));
}

// An affected counter with unsupported data types requires a separate backup review.
function backupValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(backupValue);
  return typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value).every(backupValue);
}

async function state(tx: Transaction, db: Firestore) {
  const [gate, config, queue, active, pending, appointments, counters, exceptions] = await Promise.all([
    tx.get(db.doc(RELEASE_CONTROL_PATH)), tx.get(db.doc(CONFIG)), tx.get(db.doc(RELEASE_QUEUE_PATH)),
    tx.get(db.collection("release_operations").where("state", "==", "active").limit(1)),
    tx.get(db.collection("release_deferred_events").where("state", "in", ["pending", "ready", "recovering"]).limit(1)),
    tx.get(ordered(db, "appointments").where("status", "in", ["pending", "approved"]).select(...APPOINTMENT_FIELDS)),
    tx.get(ordered(db, "slot_occupancy")), tx.get(ordered(db, "capacity_exceptions")),
  ]);
  const idle = active.empty && pending.empty && Number(queue.get("pending") ?? 0) === 0 && config.get("automaticMinuteRefundsEnabled") !== true;
  const expected = new Map<string, number>();
  const issues: string[] = [];
  for (const appointment of appointments.docs) {
    const keys = appointmentOccupancyKeys(appointment.data());
    if (!keys.length || keys.some(key => !validKey(key))) {
      issues.push("invalid_appointment:" + appointment.id);
      continue;
    }
    for (const key of keys) expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const stored = new Map(counters.docs.map(doc => [doc.id, evidence(doc)]));
  const differences: Difference[] = [];
  const validZeros: string[] = [];
  for (const id of [...new Set([...stored.keys(), ...expected.keys()])].sort()) {
    const data = stored.get(id)?.data;
    const count = data?.count;
    if (data && (!validKey(id) || id !== `${data.date}_${data.time}` || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) {
      issues.push("invalid_counter:" + id);
      continue;
    }
    const current = typeof count === "number" ? count : null;
    const value = expected.get(id) ?? 0;
    if (current === 0 && value === 0) validZeros.push(id);
    if ((current ?? 0) !== value) differences.push({ id, current, expected: value });
  }
  const capacity = normalizeSiteConfig(config.data() ?? {});
  const byDate = new Map(exceptions.docs.map(doc => [doc.id, Number(doc.get("maxCapacity"))]));
  const overCapacity = [...expected.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, count]) => {
    const maxCapacity = resolveMaxCapacity(capacity, byDate, splitOccupancyKey(key).date);
    return count > maxCapacity ? [{ key, count, maxCapacity }] : [];
  });
  return { gate, config, idle, issues, differences, validZeros, overCapacity, stored,
    appointments: appointments.size, counters: counters.size,
    sourcesHash: auditHash([appointments.docs.map(evidence), evidence(config), exceptions.docs.map(evidence)]),
    countersHash: auditHash([...stored.values()]) };
}
type CountsState = Awaited<ReturnType<typeof state>>;

function excludeCounters(current: CountsState, differences: readonly Difference[]): string {
  const targets = new Set(differences.map(item => item.id));
  return auditHash([...current.stored.values()].filter(item => !targets.has(item.id)));
}

export async function auditCounts(db: Firestore, projectId: string): Promise<{ report: CountsReport; backup: CountsBackup }> {
  return db.runTransaction(async tx => {
    const current = await state(tx, db);
    const { gate, idle, sourcesHash, countersHash, differences, issues, validZeros, overCapacity, appointments, counters } = current;
    const releaseId = gate.get("releaseId") ?? null;
    const epoch = Number(gate.get("epoch") ?? 0);
    const entries = differences.map(row => current.stored.get(row.id) ?? { id: row.id, version: null, data: null });
    const backup = { projectId, releaseId, epoch, counters: entries };
    if (entries.some(item => !backupValue(item.data))) issues.push("unsupported_backup_data");
    const body: Omit<CountsReport, "reportHash"> = {
      schema: SCHEMA, projectId, releaseId, epoch, controlVersion: version(gate), manifestHash: gate.get("manifestHash") ?? null,
      phase: gate.get("phase") ?? null, idle, sourcesHash, countersHash, unaffectedHash: excludeCounters(current, differences),
      backupHash: auditHash(backup), differences, issues, validZeros, overCapacity, appointments, counters,
    };
    return { report: { ...body, reportHash: auditHash(body) }, backup };
  }, { readOnly: true });
}

function validateReport(report: CountsReport): void {
  const { reportHash, ...body } = report;
  if (report.schema !== SCHEMA || report.phase !== "frozen" || !report.idle || report.issues.length || !report.releaseId
    || !/^[a-f0-9]{64}$/.test(reportHash) || reportHash !== auditHash(body)
    || report.differences.length > ALLOWED.size || new Set(report.differences.map(row => row.id)).size !== report.differences.length
    || report.differences.some(row => !reviewedKey(report.projectId, row.id)
      || !Number.isSafeInteger(row.expected) || row.expected < 0 || row.expected === (row.current ?? 0))) {
    throw new Error("Informe de conteos inválido o fuera del conjunto revisado.");
  }
}

function validateState(current: CountsState, report: CountsReport): void {
  if (current.gate.get("phase") !== "frozen" || current.gate.get("releaseId") !== report.releaseId || current.gate.get("epoch") !== report.epoch
    || (current.gate.get("manifestHash") ?? null) !== report.manifestHash || current.config.get("maintenanceMode") !== true
    || !current.idle || current.issues.length || current.sourcesHash !== report.sourcesHash) {
    throw new Error("Cambió el mantenimiento, la cola o las fuentes del aforo. Revisar otra auditoría.");
  }
}

function readReceipt(db: Firestore, report: CountsReport) {
  return db.doc(`slot_occupancy_migrations/${report.reportHash}/chunks/0`);
}

function assertApplied(current: CountsState, report: CountsReport, receipt: DocumentSnapshot): void {
  const resulting = report.differences.map(row => current.stored.get(row.id));
  if (receipt.get("mode") !== MODE || receipt.get("reportHash") !== report.reportHash || receipt.get("backupHash") !== report.backupHash
    || receipt.get("epoch") !== report.epoch || receipt.get("releaseId") !== report.releaseId
    || receipt.get("operationsHash") !== auditHash(report.differences) || receipt.get("unaffectedHash") !== report.unaffectedHash
    || !receipt.createTime?.isEqual(receipt.updateTime ?? receipt.createTime)
    || resulting.some(row => row?.version !== version(receipt))
    || receipt.get("resultHash") !== auditHash(resulting.map(row => row?.data)) || current.differences.length
    || excludeCounters(current, report.differences) !== report.unaffectedHash) {
    throw new Error("El recibo o los contadores ya aplicados no coinciden. Mantener mantenimiento cerrado.");
  }
}

export async function applyCounts(db: Firestore, report: CountsReport, backup: CountsBackup,
  options: { confirmProject: string; approvedReportHash: string; reviewerUid: string }): Promise<{ changed: number; alreadyApplied: boolean }> {
  validateReport(report);
  if (options.confirmProject !== report.projectId || options.approvedReportHash !== report.reportHash
    || !/^[^/\s]{1,128}$/.test(options.reviewerUid) || auditHash(backup) !== report.backupHash
    || backup.counters.some(item => !backupValue(item.data))) throw new Error("Falta la confirmación o el respaldo íntegro.");
  return db.runTransaction(async tx => {
    const receiptRef = readReceipt(db, report);
    const [current, receipt, reviewer] = await Promise.all([
      state(tx, db), tx.get(receiptRef), tx.get(db.doc("users/" + options.reviewerUid)),
    ]);
    if (reviewer.get("role") !== "admin") throw new Error("El revisor debe ser administrador.");
    validateState(current, report);
    if (receipt.exists) {
      assertApplied(current, report, receipt);
      return { changed: 0, alreadyApplied: true };
    }
    if (version(current.gate) !== report.controlVersion || current.countersHash !== report.countersHash
      || backup.projectId !== report.projectId || backup.releaseId !== report.releaseId || backup.epoch !== report.epoch
      || backup.counters.length !== report.differences.length
      || auditHash(current.differences) !== auditHash(report.differences)) throw new Error("Cambió un contador o la lista de diferencias.");
    for (const [index, difference] of report.differences.entries()) {
      const actual = current.stored.get(difference.id) ?? { id: difference.id, version: null, data: null };
      if (auditHash(actual) !== auditHash(backup.counters[index])) throw new Error("El respaldo no coincide con los documentos por reparar.");
    }
    for (const difference of report.differences) {
      const ref = db.doc("slot_occupancy/" + difference.id);
      if (difference.current === null) tx.create(ref, { ...splitOccupancyKey(difference.id), count: difference.expected });
      else tx.update(ref, { count: difference.expected });
    }
    // Versions for updated documents are only available after commit. Bind the expected values and untouched versions instead.
    tx.create(receiptRef, { mode: MODE, reportHash: report.reportHash, backupHash: report.backupHash, epoch: report.epoch,
      releaseId: report.releaseId, reviewerUid: options.reviewerUid, operationsHash: auditHash(report.differences),
      unaffectedHash: report.unaffectedHash, resultHash: auditHash(report.differences.map(row => ({
        ...(current.stored.get(row.id)?.data ?? splitOccupancyKey(row.id)), count: row.expected,
      }))), appliedAt: new Date().toISOString() });
    return { changed: report.differences.length, alreadyApplied: false };
  });
}

export async function verifyCounts(db: Firestore, report: CountsReport): Promise<void> {
  validateReport(report);
  await db.runTransaction(async tx => {
    const [current, receipt] = await Promise.all([state(tx, db), tx.get(readReceipt(db, report))]);
    validateState(current, report);
    assertApplied(current, report, receipt);
    const ready = auditHash([current.sourcesHash, current.countersHash]);
    if (current.gate.get("occupancyVerifiedEpoch") === report.epoch && current.gate.get("occupancyAuditHash") === report.reportHash
      && current.gate.get("occupancyAuditMode") === MODE && current.gate.get("occupancyCountsHash") === ready) return;
    tx.update(current.gate.ref, { occupancyVersion: 2, occupancyVerifiedEpoch: report.epoch, occupancyAuditHash: report.reportHash,
      occupancyAuditMode: MODE, occupancyCountsHash: ready, occupancyVerifiedAt: new Date().toISOString() });
  });
}

export async function assertCountsStillVerified(tx: Transaction, db: Firestore, manifestHash: string): Promise<void> {
  const current = await state(tx, db);
  const reportHash = current.gate.get("occupancyAuditHash");
  if (current.gate.get("occupancyAuditMode") !== MODE || current.gate.get("manifestHash") !== manifestHash
    || typeof reportHash !== "string" || !/^[a-f0-9]{64}$/.test(reportHash)
    || !current.idle || current.issues.length || current.differences.length
    || current.gate.get("occupancyCountsHash") !== auditHash([current.sourcesHash, current.countersHash])) {
    throw new Error("La ocupación completa ya no acredita la reapertura.");
  }
  const receipt = await tx.get(db.doc(`slot_occupancy_migrations/${reportHash}/chunks/0`));
  if (receipt.get("mode") !== MODE || receipt.get("reportHash") !== reportHash || receipt.get("epoch") !== current.gate.get("epoch")) {
    throw new Error("Falta el recibo de ocupación de esta época.");
  }
}
