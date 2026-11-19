import { runAppointmentTransaction } from "./appointmentTransaction.js";
import { auditMinuteRefunds, databaseProjectId } from "./minuteRefundAudit.js";
import { AggregateField, FieldPath, FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { bonoEffectiveMinutes, validBonoMinutes } from "./bonoMinutes.js";
import { REFUNDS, REFUND_ACCOUNTS, REFUND_FLAG, wakeMinuteRefunds } from "./minuteRefunds.js";

interface AdminRequest { auth?: { uid: string }; data: unknown }
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function createMinuteRefundAdminHandlers(deps: { db: Firestore; requireAdmin: (uid: string) => Promise<unknown> }) {
  const { db } = deps;
  async function admin(request: AdminRequest): Promise<string> {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    await deps.requireAdmin(request.auth.uid);
    return request.auth.uid;
  }
  async function legacyRefunds() {
    const [appointments, capped, archives] = await Promise.all([
      db.collection("appointments").where("minutesRefundPendingAmount", ">", 0).select("userId", "bonoId", "minutesDeductedAmount", "minutesRefundPendingAmount", "minutesRefundCappedAmount", "minutesRefundedAmount", "minuteRefundId", "createdAt").get(),
      db.collection("appointments").where("minutesRefundCappedAmount", ">", 0).select("userId", "bonoId", "minutesDeductedAmount", "minutesRefundPendingAmount", "minutesRefundCappedAmount", "minutesRefundedAmount", "minuteRefundId", "createdAt").get(),
      db.collection("appointment_deletions").where("finance.pendingRefundMinutes", ">", 0).select("userId", "finance", "deletedAt").get(),
    ]);
    const rows = new Map<string, Record<string, unknown>>();
    for (const doc of [...appointments.docs, ...capped.docs, ...archives.docs]) {
      const source = doc.data();
      const finance = source.finance ?? source;
      if (finance.minuteRefundId) continue;
      const pending = Number(finance.pendingRefundMinutes ?? finance.minutesRefundPendingAmount ?? finance.minutesRefundCappedAmount ?? 0);
      const requested = Number(finance.minutesDeductedAmount ?? pending);
      if (pending <= 0) continue;
      rows.set(doc.id, { id: `legacy:${doc.id}`, appointmentId: doc.id, userId: source.userId,
        sourceBonoId: finance.bonoId ?? null, targetBonoId: null, requestedMinutes: requested,
        creditedMinutes: Math.max(0, requested - pending), pendingMinutes: pending, state: "awaiting_review",
        reason: "historical_review_required", historical: true, reviewApproved: false,
        sourceDeleted: Boolean(source.finance), createdAt: source.createdAt ?? source.deletedAt ?? "", updatedAt: source.createdAt ?? source.deletedAt ?? "" });
    }
    return [...rows.values()];
  }
  async function summary(legacyRowsPromise = legacyRefunds()) {
    const pending = db.collection(REFUNDS).where("pendingMinutes", ">", 0);
    const [totals, blocked, waiting, config, legacy] = await Promise.all([
      pending.aggregate({ count: AggregateField.count(), minutes: AggregateField.sum("pendingMinutes") }).get(),
      db.collection(REFUNDS).where("state", "in", ["blocked", "awaiting_review"]).count().get(),
      db.collection(REFUNDS).where("state", "==", "waiting_bono").count().get(),
      db.collection("site_config").doc("main").get(),
      legacyRowsPromise,
    ]);
    return { count: totals.data().count + legacy.length, minutes: totals.data().minutes + legacy.reduce((sum, row) => sum + Number(row.pendingMinutes), 0), blocked: blocked.data().count + legacy.length, waiting: waiting.data().count,
      enabled: config.data()?.[REFUND_FLAG] === true };
  }
  return {
    async getMinuteRefundsFromAdmin(request: AdminRequest) {
      await admin(request);
      const data = record(request.data);
      let query = db.collection(REFUNDS).orderBy(FieldPath.documentId());
      if (typeof data.userId === "string" && data.userId) query = query.where("userId", "==", data.userId);
      if (typeof data.state === "string" && data.state) {
        if (!["settled", "ready", "paused", "waiting_bono", "blocked", "awaiting_review"].includes(data.state)) throw new HttpsError("invalid-argument", "Estado no válido.");
        query = query.where("state", "==", data.state);
      }
      if (data.deletedOnly === true) query = query.where("sourceDeleted", "==", true);
      const legacyCursor = typeof data.cursor === "string" && data.cursor.startsWith("legacy:") ? data.cursor : null;
      if (typeof data.cursor === "string" && data.cursor && !legacyCursor) query = query.startAfter(data.cursor);
      const legacyPromise = legacyRefunds();
      const [snap, totals, legacy] = await Promise.all([
        legacyCursor ? Promise.resolve({ docs: [], size: 0 }) : query.limit(50).get(), summary(legacyPromise), legacyPromise,
      ]);
      const matchingLegacy = legacy.filter((row) => (!data.userId || row.userId === data.userId)
        && (!data.state || data.state === "awaiting_review") && (!data.deletedOnly || row.sourceDeleted)
        && (!legacyCursor || String(row.id) > legacyCursor)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const legacyItems = matchingLegacy.slice(0, 50 - snap.size);
      const nextCursor = snap.size === 50 ? snap.docs.at(-1)!.id
        : matchingLegacy.length > legacyItems.length ? String(legacyItems.at(-1)!.id) : null;
      return { legacyItems, items: snap.docs.map((d) => ({ id: d.id, ...d.data() })), nextCursor, summary: totals };
    },
    async auditMinuteRefundsFromAdmin(request: AdminRequest) {
      await admin(request);
      const ids = record(request.data).appointmentIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || !ids.every((id) => typeof id === "string" && id.length <= 256 && !id.includes("/"))) {
        throw new HttpsError("invalid-argument", "Indica entre 1 y 20 citas.");
      }
      return auditMinuteRefunds(db, ids, databaseProjectId(db));
    },
    async getMinuteRefundSummaryFromAdmin(request: AdminRequest) { await admin(request); return summary(); },
    async getMinuteRefundDetailFromAdmin(request: AdminRequest) {
      await admin(request);
      const id = record(request.data).refundId;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "Devolución no válida.");
      const ref = db.collection(REFUNDS).doc(id);
      const [snap, movements] = await Promise.all([ref.get(), ref.collection("movements").orderBy("at").limit(100).get()]);
      if (!snap.exists) throw new HttpsError("not-found", "No existe la devolución.");
      return { id, ...snap.data(), movements: movements.docs.map((d) => ({ id: d.id, ...d.data() })) };
    },
    async retryMinuteRefundFromAdmin(request: AdminRequest) {
      const uid = await admin(request);
      const id = record(request.data).refundId;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new HttpsError("invalid-argument", "Devolución no válida.");
      const snap = await db.collection(REFUNDS).doc(id).get();
      if (!snap.exists) throw new HttpsError("not-found", "No existe la devolución.");
      if (snap.data()?.reviewApproved !== true) throw new HttpsError("failed-precondition", "Esta devolución histórica requiere un informe revisado.");
      await wakeMinuteRefunds(db, snap.data()!.userId);
      await db.collection("activity_logs").add({ action: "minute_refund_retry_requested", adminUid: uid, refundId: id, createdAt: new Date().toISOString() });
      return { success: true };
    },
    async mutateBonoFromAdmin(request: AdminRequest) {
      const uid = await admin(request);
      const data = record(request.data);
      if (typeof data.bonoId !== "string" || !data.bonoId || data.bonoId.includes("/")) throw new HttpsError("invalid-argument", "Bono no válido.");
      if (typeof data.requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(data.requestId)) throw new HttpsError("invalid-argument", "Identificador de operación no válido.");
      const ref = db.collection("bonos").doc(data.bonoId);
      const operationRef = db.collection("bono_admin_operations").doc(data.requestId);
      const payload = JSON.stringify([data.bonoId, data.action, data.delta ?? null, data.fechaAsignacion ?? null, data.fechaExpiracion ?? null]);
      return runAppointmentTransaction(db, async (tx) => {
        const [snap, operation] = await Promise.all([tx.get(ref), tx.get(operationRef)]);
        if (operation.exists) {
          if (operation.data()?.payload !== payload || operation.data()?.actorUid !== uid) throw new HttpsError("already-exists", "La operación ya se usó para otro cambio.");
          return { success: true, alreadyApplied: true };
        }
        if (!snap.exists) throw new HttpsError("not-found", "Bono no encontrado.");
        const bono = snap.data()!;
        const accountRef = db.collection(REFUND_ACCOUNTS).doc(bono.userId);
        const [account, active] = await Promise.all([tx.get(accountRef), tx.get(db.collection("bonos").where("userId", "==", bono.userId).where("estado", "==", "activo"))]);
        const at = new Date().toISOString();
        const patch: Record<string, unknown> = {};
        if (data.action === "adjust") {
          const delta = Number(data.delta);
          if (![-45, -30, 30, 45].includes(delta)) throw new HttpsError("invalid-argument", "Ajuste no válido.");
          if (!validBonoMinutes(bono) || bono.replacedByBonoId || !["activo", "agotado"].includes(bono.estado)
            || bono.fechaExpiracion && Date.parse(bono.fechaExpiracion) < Date.now()
            || active.docs.some((d) => d.id !== snap.id)) throw new HttpsError("failed-precondition", "El bono no admite ajustes; revisa su vigencia y los bonos activos.");
          const before = Number(bono.minutosRestantes ?? 0);
          const after = before + delta;
          if (after < 0 || after > bonoEffectiveMinutes(bono)) throw new HttpsError("failed-precondition", "El ajuste supera el saldo o la capacidad efectiva del bono.");
          Object.assign(patch, { minutosRestantes: after, estado: after > 0 ? "activo" : "agotado",
            historial: FieldValue.arrayUnion({ fecha: at, tipo: delta > 0 ? "Abono manual" : "Deducción manual", duracion: String(Math.abs(delta)),
              ...(delta > 0 ? { minutosAbonados: delta } : {}), delta, appointmentId: "manual", accion: "ajuste_manual", operationId: data.requestId, actorUid: uid }) });
        } else if (data.action === "delete") {
          patch.estado = "eliminado";
        } else if (data.action === "dates") {
          const start = Date.parse(String(data.fechaAsignacion));
          const end = Date.parse(String(data.fechaExpiracion));
          if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new HttpsError("invalid-argument", "Fechas no válidas.");
          patch.fechaAsignacion = data.fechaAsignacion;
          patch.fechaExpiracion = data.fechaExpiracion;
          if (typeof data.notificationBulkOperationId === "string") patch.notificationBulkOperationId = data.notificationBulkOperationId;
          if (["activo", "agotado"].includes(bono.estado) && end < Date.now()) patch.estado = "expirado";
        } else throw new HttpsError("invalid-argument", "Acción no válida.");
        tx.update(ref, patch);
        tx.set(accountRef, { userId: bono.userId, revision: Number(account.data()?.revision ?? 0) + 1 }, { merge: true });
        tx.create(operationRef, { payload, actorUid: uid, bonoId: snap.id, action: data.action, createdAt: at });
        tx.create(db.collection("activity_logs").doc(), { action: "bono_financial_change", adminUid: uid, bonoId: snap.id, operationId: data.requestId,
          change: data.action, delta: data.delta ?? null, createdAt: at });
        return { success: true, alreadyApplied: false };
      });
    },
  };
}
