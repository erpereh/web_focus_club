import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { bonoBaseMinutes, bonoEffectiveMinutes } from "./bonoMinutes.js";
import { REFUNDS, REFUND_ACCOUNTS, recordMinuteRefund, refundProjection, reservationIdentity, selectRefundDestination, type MinuteRefund, type RefundSource } from "./minuteRefunds.js";

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    if ("toDate" in value && typeof value.toDate === "function") return value.toDate().toISOString();
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}
export function evidenceHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function databaseProjectId(db: Firestore): string {
  return (db as unknown as { projectId: string }).projectId;
}
interface Evidence { path: string; exists: boolean; updateTime: string | null; hash: string }
function evidence(snap: DocumentSnapshot): Evidence {
  return { path: snap.ref.path, exists: snap.exists, updateTime: snap.updateTime?.toDate().toISOString() ?? null, hash: evidenceHash(snap.data() ?? null) };
}
interface AuditCase {
  appointmentId: string;
  refundId: string;
  userId: string;
  sourceBonoId: string;
  targetBonoId: string | null;
  requested: number;
  credited: number;
  pending: number;
  currentBalance: number | null;
  reconstructedBalance: number | null;
  proposedBalance: number | null;
  proposedCapacity: number | null;
  eligibleForReviewedImport: boolean;
  issues: string[];
  originalDebit: unknown[];
  targetTimeline: unknown[];
  documents: Evidence[];
}
export interface RefundAuditReport { schemaVersion: 1; projectId: string; auditedAt: string; cases: AuditCase[]; reportHash: string }

/** Targeted, read-only accounting reconstruction. A mismatch is never repaired by guessing. */
export async function auditMinuteRefunds(db: Firestore, appointmentIds: string[], projectId: string, now = new Date()): Promise<RefundAuditReport> {
  const cases: AuditCase[] = [];
  for (const appointmentId of appointmentIds) {
    const appointment = await db.collection("appointments").doc(appointmentId).get();
    const deletion = await db.collection("appointment_deletions").doc(appointmentId).get();
    const source = (appointment.data() ?? (deletion.exists ? {
      userId: deletion.data()!.userId, bonoId: deletion.data()!.finance?.bonoId,
      ...deletion.data()!.finance,
      minutesRefundPendingAmount: deletion.data()!.finance?.pendingRefundMinutes,
    } : {})) as RefundSource;
    if (!source.userId || !source.bonoId) throw new Error(`Missing financial identity: ${appointmentId}`);
    const [bonos, appointments, archives, refunds, logs] = await Promise.all([
      db.collection("bonos").where("userId", "==", source.userId).get(),
      db.collection("appointments").where("userId", "==", source.userId).get(),
      db.collection("appointment_deletions").where("userId", "==", source.userId).get(),
      db.collection(REFUNDS).where("appointmentId", "==", appointmentId).get(),
      db.collection("activity_logs").where("appointmentId", "==", appointmentId).get(),
    ]);
    const documents = new Map<string, DocumentSnapshot>([appointment, deletion, ...bonos.docs, ...appointments.docs, ...archives.docs, ...refunds.docs, ...logs.docs].map((s) => [s.ref.path, s]));
    const original = bonos.docs.find((d) => d.id === source.bonoId)?.data();
    const originalDebit = (Array.isArray(original?.historial) ? original.historial : []).filter((h: Record<string, unknown>) => h.appointmentId === appointmentId && h.accion === "descuento_cita" && h.fecha === source.minutesDeductedAt);
    const requested = Number(source.minutesRefundRequestedAmount || source.minutesDeductedAmount || 0);
    const pending = Number(source.minutesRefundPendingAmount ?? source.minutesRefundCappedAmount ?? 0);
    const credited = !appointment.exists ? Number(deletion.data()?.finance?.refundedAmount ?? 0)
      : source.minutesRefundRequestedAt ? Number(source.minutesRefundedAmount ?? 0)
      : Number(source.minutesRefundedAmount ?? 0) - Number(source.minutesRefundCappedAmount ?? 0);
    const issues: string[] = [];
    if (source.appointmentType === "nutrition" || source.cancellationCharge === "charged") issues.push("not_refundable");
    if (source.minutesDeducted !== true || !source.minutesDeductedAt || !Number.isSafeInteger(requested) || requested <= 0
      || !Number.isSafeInteger(credited) || credited < 0 || pending <= 0 || credited + pending !== requested) issues.push("inconsistent_refund_markers");
    if (originalDebit.length !== 1 || Number(originalDebit[0]?.duracion) !== source.minutesDeductedAmount) issues.push("original_debit_not_verified");
    if (refunds.docs.some((d) => d.data().pendingMinutes === 0 || d.data().reviewApproved === true)) issues.push("existing_approved_or_settled_refund");
    const destination = selectRefundDestination(bonos.docs.map((d) => ({ id: d.id, ...d.data() })), source.userId, now);
    const target = "bono" in destination ? bonos.docs.find((d) => d.id === destination.bono.id) : undefined;
    if (!("bono" in destination)) issues.push(destination.reason);
    let balance: number | null = target ? bonoBaseMinutes(target.data()!) : null;
    const timeline: unknown[] = [];
    const targetHistory: Record<string, unknown>[] = Array.isArray(target?.data()?.historial) ? target!.data()!.historial : [];
    for (const h of targetHistory) {
      const id = String(h.appointmentId ?? "");
      const related = appointments.docs.find((d) => d.id === id)?.data();
      const archived = archives.docs.find((d) => d.id === id)?.data()?.finance;
      let delta: number | null = null;
      if (h.accion === "descuento_cita" || h.tipo === "Deducción manual") delta = -Number(h.duracion);
      else if (h.accion === "ajuste_manual") delta = Number(h.delta);
      else if (h.accion === "compensacion_devolucion") delta = Number(h.minutosAbonados);
      else if (h.accion === "devolucion_cita") {
        if (typeof h.minutosAbonados === "number") delta = h.minutosAbonados;
        else if (related) delta = related.minutesRefundRequestedAt ? Number(related.minutesRefundedAmount ?? 0) : Number(related.minutesRefundedAmount ?? 0) - Number(related.minutesRefundCappedAmount ?? 0);
        else if (archived) delta = Number(archived.refundedAmount ?? 0);
        else issues.push(`unverified_history:${id}`);
      } else issues.push(`unrecognized_history:${id}`);
      if (delta !== null && Number.isSafeInteger(delta) && balance !== null) balance += delta;
      else if (delta !== null) issues.push(`invalid_history_amount:${id}`);
      timeline.push({ appointmentId: id, at: h.fecha ?? null, action: h.accion ?? h.tipo ?? null, actualDelta: delta, resultingBalance: balance });
    }
    const currentBalance = target ? Number(target.data()!.minutosRestantes) : null;
    if (target && balance !== currentBalance) issues.push("balance_reconstruction_mismatch");
    if (targetHistory.some((h) => h.appointmentId === appointmentId && h.accion === "compensacion_devolucion")) issues.push("prior_compensation");
    cases.push({ appointmentId, refundId: reservationIdentity(appointmentId, source), userId: source.userId, sourceBonoId: source.bonoId,
      targetBonoId: target?.id ?? null, requested, credited, pending, currentBalance, reconstructedBalance: balance,
      proposedBalance: currentBalance === null ? null : currentBalance + pending,
      proposedCapacity: target ? bonoEffectiveMinutes(target.data()!) + pending : null,
      eligibleForReviewedImport: issues.length === 0, issues, originalDebit, targetTimeline: timeline,
      documents: [...documents.values()].map(evidence).sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  const report = { schemaVersion: 1 as const, projectId, auditedAt: now.toISOString(), cases };
  return { ...report, reportHash: evidenceHash(report) };
}

/** Explicit reviewed import only. It does not call settlement. The normal worker
 * remains responsible for checking the live flag, destination and unique receipt. */
export async function applyReviewedMinuteRefundAudit(db: Firestore, report: RefundAuditReport, options: {
  confirmProject: string; approvedReportHash: string; reviewerUid: string;
}): Promise<string[]> {
  const { reportHash, ...body } = report;
  if (report.schemaVersion !== 1 || reportHash !== evidenceHash(body) || options.approvedReportHash !== reportHash
    || options.confirmProject !== report.projectId || databaseProjectId(db) !== report.projectId) throw new Error("Reviewed report/project confirmation does not match");
  const reviewer = await db.collection("users").doc(options.reviewerUid).get();
  if (reviewer.data()?.role !== "admin") throw new Error("A named administrator must review the report");
  if (report.cases.some((c) => !c.eligibleForReviewedImport || c.pending <= 0 || c.issues.length > 0)) throw new Error("The report contains unresolved inconsistencies");
  const imported: string[] = [];
  for (const item of report.cases) {
    await db.runTransaction(async (tx) => {
      const refundRef = db.collection(REFUNDS).doc(item.refundId);
      const receiptRef = db.collection(`${REFUNDS}/${item.refundId}/movements`).doc(`review_${reportHash}`);
      const [existing, receipt] = await Promise.all([tx.get(refundRef), tx.get(receiptRef)]);
      if (receipt.exists) return; // Retrying the exact reviewed import is harmless even after settlement.
      const accountRef = db.collection(REFUND_ACCOUNTS).doc(item.userId);
      await tx.get(accountRef);
      const snapshots = await Promise.all(item.documents.map((d) => tx.get(db.doc(d.path))));
      for (let index = 0; index < snapshots.length; index += 1) {
        if (evidenceHash(evidence(snapshots[index])) !== evidenceHash(item.documents[index])) throw new Error(`Audit changed: ${item.documents[index].path}; run audit again`);
      }
      const at = new Date().toISOString();
      const sourceSnap = snapshots.find((d) => d.ref.path === `appointments/${item.appointmentId}`);
      const deletionSnap = snapshots.find((d) => d.ref.path === `appointment_deletions/${item.appointmentId}`);
      const source = (sourceSnap?.data() ?? {
        userId: item.userId, bonoId: item.sourceBonoId, ...deletionSnap?.data()?.finance,
        minutesRefundedAt: deletionSnap?.data()?.finance?.previousRefundAt ?? null,
      }) as RefundSource;
      let next: MinuteRefund;
      if (existing.exists) {
        const prior = existing.data() as MinuteRefund;
        if (prior.reviewApproved || prior.pendingMinutes !== item.pending || prior.creditedMinutes !== item.credited) throw new Error("Refund changed since audit");
        next = { ...prior, reviewApproved: true, state: "ready", reason: null, updatedAt: at };
      } else {
        next = { ...recordMinuteRefund(tx, db, db.collection("appointments").doc(item.appointmentId), source, at,
          { credited: item.credited, targetBonoId: item.targetBonoId ?? undefined, historical: true }).refund,
          reviewApproved: true, state: "ready", reason: null, sourceDeleted: !sourceSnap?.exists };
      }
      next.approvedReportHash = reportHash;
      next.reviewerUid = options.reviewerUid;
      tx.set(refundRef, next);
      tx.create(receiptRef, { kind: "review_approved", reportHash, reviewerUid: options.reviewerUid, at,
        requestedMinutes: item.requested, creditedMinutes: item.credited, pendingMinutes: item.pending });
      if (sourceSnap?.exists) tx.set(sourceSnap.ref, refundProjection(item.refundId, next), { merge: true });
      if (deletionSnap?.exists) tx.set(deletionSnap.ref, { finance: { minuteRefundId: item.refundId, pendingRefundMinutes: item.pending } }, { merge: true });
      // Decorate misleading legacy history; the original evidence remains in the reviewed report and request receipt.
      if (item.targetBonoId) {
        const target = snapshots.find((d) => d.ref.path === `bonos/${item.targetBonoId}`);
        const history: Record<string, unknown>[] = target?.data()?.historial ?? [];
        tx.update(db.collection("bonos").doc(item.targetBonoId), { historial: history.map((h) => h.appointmentId === item.appointmentId && h.accion === "devolucion_cita"
          ? { ...h, minutosAbonados: item.credited, tipo: item.credited === 0 ? "Intento de devolución · sin abono" : h.tipo ?? "Devolución de minutos",
            refundId: item.refundId, auditReportHash: reportHash } : h) });
      }
      tx.set(accountRef, { generation: FieldValue.increment(1), nextAttemptAt: at }, { merge: true });
    });
    imported.push(item.refundId);
  }
  return imported;
}
