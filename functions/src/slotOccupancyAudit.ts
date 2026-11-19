import { createHash } from "node:crypto";
import { FieldPath, type Firestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAppointmentEffectiveSlot } from "./appointmentLifecycle.js";
import { planSlotOccupancyReconciliation, type MigrationOperation, type StoredMigrationDocument } from "./slotMigrations.js";
import { RELEASE_CONTROL_PATH, RELEASE_QUEUE_PATH } from "./releaseMaintenance.js";
import { normalizeSiteConfig } from "./siteConfig.js";
import { resolveMaxCapacity } from "./capacityExceptions.js";

const PAGE_SIZE = 500;
const CHUNK_SIZE = 400;
const SCHEMA = "focus-slot-occupancy-v2";
type Data = Record<string, unknown>;
type Evidence = { path: string; version: string | null; hash: string; data: Data };
export interface SlotAuditReport {
  schema: string;
  projectId: string;
  createdAt: string;
  releaseId: string | null;
  epoch: number;
  controlVersion: string | null;
  frozen: boolean;
  appointments: Evidence[];
  occupancy: Evidence[];
  configuration: Evidence[];
  operations: MigrationOperation[];
  issues: string[];
  overCapacity: Array<{ key: string; count: number; maxCapacity: number }>;
  summary: ReturnType<typeof planSlotOccupancyReconciliation>["report"];
  reportHash: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function auditHash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function version(snap: DocumentSnapshot): string | null {
  return snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
}
function projection(data: Data): Data {
  return Object.fromEntries(["status", "duration", "approvedSlot", "preferredSlots", "date", "time"]
    .filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
}
function evidence(snap: DocumentSnapshot, appointment = false): Evidence {
  const data = appointment ? projection(snap.data() ?? {}) : snap.data() ?? {};
  return { path: snap.ref.path, version: version(snap), hash: auditHash(data), data };
}
async function scan(db: Firestore, name: string, activeOnly = false): Promise<DocumentSnapshot[]> {
  const result: DocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(name).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (activeOnly) query = query.where("status", "in", ["pending", "approved"]);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    result.push(...page.docs);
    if (page.size < PAGE_SIZE) return result;
    cursor = page.docs.at(-1);
  }
}

export async function auditSlotOccupancy(db: Firestore, projectId: string): Promise<SlotAuditReport> {
  const gateBefore = await db.doc(RELEASE_CONTROL_PATH).get();
  const [appointments, occupancy, config, exceptions] = await Promise.all([
    scan(db, "appointments", true), scan(db, "slot_occupancy"),
    db.collection("site_config").doc("main").get(), scan(db, "capacity_exceptions"),
  ]);
  const gateAfter = await db.doc(RELEASE_CONTROL_PATH).get();
  if (version(gateBefore) !== version(gateAfter)) throw new Error("El mantenimiento cambió durante la auditoría. Repetirla.");
  const sources: StoredMigrationDocument[] = appointments.map((snap) => ({ id: snap.id, data: projection(snap.data() ?? {}) }));
  const actual = occupancy.map((snap) => ({ id: snap.id, data: snap.data() ?? {} }));
  const plan = planSlotOccupancyReconciliation({ appointments: sources, occupancyDocuments: actual, startDate: "0001-01-01", endDate: "9999-12-31" });
  const issues = sources.filter(({ data }) => !getAppointmentEffectiveSlot(data)).map(({ id }) => `invalid_appointment:${id}`);
  if (plan.report.invalidAppointments) issues.push(`invalid_appointments:${plan.report.invalidAppointments}`);
  for (const { id, data } of actual) if (id !== `${data.date}_${data.time}` || !/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(id)
    || !Number.isSafeInteger(data.count) || Number(data.count) < 0) issues.push(`invalid_counter:${id}`);
  const capacity = normalizeSiteConfig(config.data() ?? {});
  const byDate = new Map(exceptions.map((snap) => [snap.id, Number(snap.data()?.maxCapacity)]));
  const expected = new Map(actual.map((doc) => [doc.id, doc.data]));
  for (const op of plan.operations) {
    if (op.type === "delete") expected.delete(op.id);
    else expected.set(op.id, op.data ?? {});
  }
  const overCapacity = [...expected].flatMap(([key, data]) => {
    const maxCapacity = resolveMaxCapacity(capacity, byDate, String(data.date));
    return Number(data.count) > maxCapacity ? [{ key, count: Number(data.count), maxCapacity }] : [];
  });
  const control = gateAfter.data() ?? {};
  const report: Omit<SlotAuditReport, "reportHash"> = {
    schema: SCHEMA, projectId, createdAt: new Date().toISOString(), releaseId: control.releaseId ?? null,
    epoch: control.epoch ?? 0, controlVersion: version(gateAfter), frozen: control.phase === "frozen",
    appointments: appointments.map((snap) => evidence(snap, true)), occupancy: occupancy.map((snap) => evidence(snap)),
    configuration: [config, ...exceptions].map((snap) => evidence(snap)), operations: plan.operations,
    issues, overCapacity, summary: plan.report,
  };
  return { ...report, reportHash: auditHash(report) };
}

export interface ApplySlotAuditOptions { confirmProject: string; approvedReportHash: string; reviewerUid: string }
function validateReport(report: SlotAuditReport, options: ApplySlotAuditOptions): void {
  const { reportHash, ...body } = report;
  if (report.schema !== SCHEMA || !report.frozen || !report.releaseId || report.issues.length
    || report.projectId !== options.confirmProject || !options.reviewerUid || options.reviewerUid.includes("/")
    || options.approvedReportHash !== reportHash || auditHash(body) !== reportHash) {
    throw new Error("Informe no válido, sin revisión o de otro proyecto. No se ha escrito nada.");
  }
  const derived = planSlotOccupancyReconciliation({
    appointments: report.appointments.map((item) => ({ id: item.path.split("/")[1], data: item.data })),
    occupancyDocuments: report.occupancy.map((item) => ({ id: item.path.split("/")[1], data: item.data })),
    startDate: "0001-01-01", endDate: "9999-12-31",
  });
  if (derived.report.invalidAppointments || auditHash(derived.operations) !== auditHash(report.operations)
    || report.operations.some((op) => !/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(op.id))) {
    throw new Error("Las operaciones no se derivan de las evidencias revisadas.");
  }
}
function sameEvidence(snap: DocumentSnapshot, expected: Evidence, appointment = false): boolean {
  return version(snap) === expected.version && auditHash(appointment ? projection(snap.data() ?? {}) : snap.data() ?? {}) === expected.hash;
}

export async function applyReviewedSlotOccupancyAudit(db: Firestore, report: SlotAuditReport, options: ApplySlotAuditOptions): Promise<{ chunks: number; replayed: number }> {
  validateReport(report, options);
  // A complete membership check catches additions and removals, including legacy shapes.
  const current = await scan(db, "appointments", true);
  const byPath = new Map(current.map((snap) => [snap.ref.path, snap]));
  if (current.length !== report.appointments.length || report.appointments.some((item) => !byPath.has(item.path) || !sameEvidence(byPath.get(item.path)!, item, true))) {
    throw new Error("Las citas han cambiado. Generar y revisar otra auditoría.");
  }
  const original = new Map(report.occupancy.map((item) => [item.path, item]));
  let replayed = 0;
  const chunks = Math.max(1, Math.ceil(report.operations.length / CHUNK_SIZE));
  for (let chunk = 0; chunk < chunks; chunk++) {
    const operations = report.operations.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);
    const dates = new Set(operations.map((op) => op.date));
    const sources = report.appointments.filter((item) => dates.has(getAppointmentEffectiveSlot(item.data)?.date ?? ""));
    await db.runTransaction(async (tx) => {
      const receiptRef = db.collection("slot_occupancy_migrations").doc(report.reportHash).collection("chunks").doc(String(chunk));
      const [gate, reviewer, receipt, ...inputs] = await Promise.all([
        tx.get(db.doc(RELEASE_CONTROL_PATH)), tx.get(db.collection("users").doc(options.reviewerUid)), tx.get(receiptRef),
        ...sources.map((item) => tx.get(db.doc(item.path))), ...report.configuration.map((item) => tx.get(db.doc(item.path))),
        ...operations.map((op) => tx.get(db.collection("slot_occupancy").doc(op.id))),
      ]);
      if (gate.data()?.phase !== "frozen" || gate.data()?.releaseId !== report.releaseId || gate.data()?.epoch !== report.epoch
        || reviewer.data()?.role !== "admin") throw new Error("Mantenimiento o revisor no válidos. Mantener el bloqueo cerrado.");
      const evidenceInputs = [...sources, ...report.configuration];
      if (evidenceInputs.some((item, index) => !sameEvidence(inputs[index], item, index < sources.length))) throw new Error("Una evidencia ha cambiado. No continuar con este informe.");
      const counters = inputs.slice(evidenceInputs.length);
      if (receipt.exists) {
        if (receipt.data()?.reportHash !== report.reportHash || receipt.data()?.operationsHash !== auditHash(operations)) throw new Error("Recibo de migración inconsistente.");
        if (operations.some((op, index) => op.type === "delete" ? counters[index].exists : !counters[index].exists || auditHash(counters[index].data()) !== auditHash(op.data))) throw new Error("Los contadores ya confirmados han cambiado.");
        replayed++;
        return;
      }
      for (const [index, op] of operations.entries()) {
        const before = original.get(`slot_occupancy/${op.id}`);
        if (before ? !sameEvidence(counters[index], before) : counters[index].exists) throw new Error("Un contador ha cambiado. No sobrescribirlo.");
      }
      for (const op of operations) {
        const ref = db.collection("slot_occupancy").doc(op.id);
        if (op.type === "delete") tx.delete(ref);
        else tx.set(ref, op.data!);
      }
      if (chunk === 0) tx.set(db.doc(RELEASE_CONTROL_PATH), {
        occupancyVerifiedEpoch: null, occupancyAuditHash: null,
      }, { merge: true });
      tx.create(receiptRef, { reportHash: report.reportHash, operationsHash: auditHash(operations), reviewerUid: options.reviewerUid,
        releaseId: report.releaseId, epoch: report.epoch, count: operations.length, completedAt: new Date().toISOString() });
    });
  }
  return { chunks, replayed };
}

export async function verifySlotOccupancyAudit(db: Firestore, report: SlotAuditReport): Promise<void> {
  const { reportHash, ...body } = report;
  if (report.schema !== SCHEMA || auditHash(body) !== reportHash) throw new Error("Informe alterado.");
  const fresh = await auditSlotOccupancy(db, report.projectId);
  if (!fresh.frozen || fresh.releaseId !== report.releaseId || fresh.epoch !== report.epoch || fresh.issues.length || fresh.operations.length) {
    throw new Error("La ocupación no está reconciliada. Mantener mantenimiento cerrado.");
  }
  if (auditHash(fresh.appointments) !== auditHash(report.appointments) || auditHash(fresh.configuration) !== auditHash(report.configuration)) {
    throw new Error("Las evidencias cambiaron después de aplicar. Generar y revisar otra auditoría antes de reabrir.");
  }
  const chunks = Math.max(1, Math.ceil(report.operations.length / CHUNK_SIZE));
  const receipts = await db.collection("slot_occupancy_migrations").doc(report.reportHash).collection("chunks").get();
  if (receipts.size !== chunks || receipts.docs.some((receipt) => {
    const index = Number(receipt.id), data = receipt.data();
    return !Number.isSafeInteger(index) || index < 0 || index >= chunks || data.reportHash !== report.reportHash
      || data.releaseId !== report.releaseId || data.epoch !== report.epoch
      || data.operationsHash !== auditHash(report.operations.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
  })) throw new Error("Faltan recibos de aplicación o son inconsistentes. No marcar preparada.");
  await db.runTransaction(async (tx) => {
    const ref = db.doc(RELEASE_CONTROL_PATH);
    const [snap, queue, active] = await Promise.all([
      tx.get(ref), tx.get(db.doc(RELEASE_QUEUE_PATH)),
      tx.get(db.collection("release_operations").where("state", "==", "active").limit(1)),
    ]);
    if (snap.data()?.phase !== "frozen" || snap.data()?.epoch !== report.epoch || snap.data()?.releaseId !== report.releaseId
      || version(snap) !== fresh.controlVersion || Number(queue.data()?.pending ?? 0) !== 0 || !active.empty) {
      throw new Error("El mantenimiento ha cambiado o quedan eventos por recuperar. Mantener cerrado y volver a verificar.");
    }
    tx.set(ref, { occupancyVersion: 2, occupancyVerifiedEpoch: report.epoch, occupancyAuditHash: report.reportHash, occupancyVerifiedAt: new Date().toISOString() }, { merge: true });
  });
}
