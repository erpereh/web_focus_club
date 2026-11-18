import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { bonoBaseMinutes, bonoEffectiveMinutes, validBonoMinutes, type BonoMinutes } from "./bonoMinutes.js";
import { bonoExpiryInstant, bonoStartInstant } from "./notifications/bonoEvents.js";

export const REFUNDS = "minute_refunds";
export const REFUND_ACCOUNTS = "minute_refund_accounts";
export const REFUND_FLAG = "automaticMinuteRefundsEnabled";
export const REFUND_BATCH = 25;
export const RECOVERY_BATCH = 50;
export type RefundState = "settled" | "ready" | "paused" | "waiting_bono" | "blocked" | "awaiting_review";

export interface RefundSource {
  userId: string;
  bonoId?: string;
  appointmentType?: unknown;
  cancellationCharge?: unknown;
  minutesDeducted?: boolean;
  minutesDeductedAt?: string | null;
  minutesDeductedAmount?: number;
  minuteRefundId?: string | null;
  minutesRefundRequestedAt?: string | null;
  minutesRefundRequestedAmount?: number;
  minutesRefundedAt?: string | null;
  minutesRefundedAmount?: number | null;
  minutesRefundPendingAmount?: number;
  minutesRefundCappedAmount?: number;
  minutesRefundedToBonoId?: string | null;
}

export interface MinuteRefund {
  sourceDeleted?: boolean;
  userId: string;
  appointmentId: string;
  reservationId: string;
  sourceBonoId: string | null;
  deductedAt: string;
  requestedMinutes: number;
  creditedMinutes: number;
  pendingMinutes: number;
  state: RefundState;
  reason: string | null;
  historical: boolean;
  reviewApproved: boolean;
  approvedReportHash?: string;
  reviewerUid?: string;
  createdAt: string;
  updatedAt: string;
  lastCreditedAt: string | null;
  targetBonoId: string | null;
  version: number;
}

export function reservationIdentity(appointmentId: string, source: RefundSource): string {
  return createHash("sha256").update(JSON.stringify([appointmentId, source.bonoId ?? null, source.minutesDeductedAt])).digest("hex");
}

export function refundProjection(id: string, refund: MinuteRefund): Record<string, unknown> {
  return {
    minuteRefundId: id,
    minutesRefundRequestedAt: refund.createdAt,
    minutesRefundRequestedAmount: refund.requestedMinutes,
    minutesRefundedAmount: refund.creditedMinutes,
    minutesRefundPendingAmount: refund.pendingMinutes,
    minutesRefundCappedAmount: refund.pendingMinutes,
    minutesRefunded: refund.pendingMinutes === 0 && refund.creditedMinutes > 0,
    minutesRefundedAt: refund.lastCreditedAt,
    minutesRefundedToBonoId: refund.targetBonoId,
    minutesRefundStatus: refund.state,
    minutesRefundReason: refund.reason,
    minutesRefundPendingReview: refund.state === "blocked" || refund.state === "awaiting_review",
  };
}

/** Called in the source transaction after reading the appointment. Its latch and
 * the immutable create make cancellation/deletion/trigger retries the same claim.
 * This never checks the feature flag: durable recognition is always enabled. */
export function recordMinuteRefund(
  tx: Transaction, db: Firestore, ref: DocumentReference, source: RefundSource,
  now: string, input: { credited: number; targetBonoId?: string; reason?: string | null; historical?: boolean },
): { id: string; refund: MinuteRefund; patch: Record<string, unknown> } {
  const id = reservationIdentity(ref.id, source);
  const historical = input.historical === true;
  const requested = (source.minutesRefundRequestedAmount ?? 0) > 0 ? source.minutesRefundRequestedAmount! : source.minutesDeductedAmount ?? 0;
  if (!Number.isSafeInteger(requested) || requested <= 0 || requested > (source.minutesDeductedAmount ?? 0)
    || !Number.isSafeInteger(input.credited) || input.credited < 0 || input.credited > requested) {
    throw new Error("Invalid refund accounting");
  }
  const refund: MinuteRefund = {
    userId: source.userId, appointmentId: ref.id, reservationId: id,
    sourceBonoId: source.bonoId ?? null, deductedAt: source.minutesDeductedAt!,
    requestedMinutes: requested, creditedMinutes: input.credited, pendingMinutes: requested - input.credited,
    state: historical ? "awaiting_review" : input.credited === requested ? "settled" : "ready",
    reason: input.reason ?? null, historical, reviewApproved: !historical,
    createdAt: now, updatedAt: now, lastCreditedAt: input.credited > 0 ? historical ? source.minutesRefundedAt ?? null : now : null,
    targetBonoId: input.targetBonoId ?? null, version: 0,
  };
  if (!historical && ["missing_source_bono", "bono_owner_mismatch", "multiple_active_bonos", "invalid_bono_dates", "invalid_bono_accounting", "ambiguous_latest_bono"].includes(input.reason ?? "")) refund.state = "blocked";
  const refundRef = db.collection(REFUNDS).doc(id);
  tx.create(refundRef, refund);
  tx.create(db.collection(`${REFUNDS}/${id}/movements`).doc("request"), {
    kind: historical ? "historical_evidence" : "request", requestedMinutes: requested,
    creditedMinutes: input.credited, pendingMinutes: refund.pendingMinutes,
    targetBonoId: refund.targetBonoId, at: now, actor: "source_transaction",
    ...(historical ? { legacyEvidence: {
      minutesRefundedAt: source.minutesRefundedAt ?? null,
      minutesRefundedAmount: source.minutesRefundedAmount ?? null,
      minutesRefundCappedAmount: source.minutesRefundCappedAmount ?? null,
    } } : {}),
  });
  if (refund.pendingMinutes > 0) {
    tx.set(db.collection(REFUND_ACCOUNTS).doc(source.userId), {
      userId: source.userId, pendingMinutes: FieldValue.increment(refund.pendingMinutes),
      generation: FieldValue.increment(1), nextAttemptAt: now,
    }, { merge: true });
  }
  return { id, refund, patch: refundProjection(id, refund) };
}

interface RefundBono extends BonoMinutes {
  id: string;
  userId?: string;
  estado?: string;
  fechaAsignacion?: string;
  fechaExpiracion?: string;
  createdAt?: string;
  replacedByBonoId?: string | null;
}

export function selectRefundDestination(bonos: RefundBono[], userId: string, now: Date):
  { bono: RefundBono } | { state: "waiting_bono" | "blocked"; reason: string; wakeAt?: string } {
  if (bonos.some((b) => b.userId !== userId)) return { state: "blocked", reason: "bono_owner_mismatch" };
  const active = bonos.filter((b) => b.estado === "activo");
  if (active.length > 1) return { state: "blocked", reason: "multiple_active_bonos" };
  const ranked = [...bonos].sort((a, b) => (b.createdAt ?? b.fechaAsignacion ?? "").localeCompare(a.createdAt ?? a.fechaAsignacion ?? ""));
  const selected = active[0] ?? ranked[0];
  if (!selected) return { state: "waiting_bono", reason: "no_valid_bono" };
  if (!active.length && ranked[1] && (ranked[1].createdAt ?? ranked[1].fechaAsignacion) === (selected.createdAt ?? selected.fechaAsignacion)) {
    return { state: "blocked", reason: "ambiguous_latest_bono" };
  }
  if (selected.replacedByBonoId || !["activo", "agotado"].includes(selected.estado ?? "")) {
    return { state: "waiting_bono", reason: "no_valid_bono" };
  }
  const end = bonoExpiryInstant(selected.fechaExpiracion);
  if (selected.fechaExpiracion && !end) return { state: "blocked", reason: "invalid_bono_dates" };
  if (end && end.getTime() < now.getTime()) return { state: "waiting_bono", reason: "bono_expired" };
  const start = selected.fechaAsignacion ? bonoStartInstant(selected.fechaAsignacion)?.getTime() : undefined;
  if (selected.fechaAsignacion && (start === undefined || !Number.isFinite(start))) return { state: "blocked", reason: "invalid_bono_dates" };
  if (start !== undefined && start > now.getTime()) return { state: "waiting_bono", reason: "bono_not_started", wakeAt: new Date(start).toISOString() };
  if (!validBonoMinutes(selected)) return { state: "blocked", reason: "invalid_bono_accounting" };
  return { bono: selected };
}

/** One receipt, balance, extra capacity and source projections commit together.
 * Flag and review authorization are re-read inside this very transaction. */
export async function settleMinuteRefund(db: Firestore, id: string, now?: Date): Promise<{ credited: number; state: RefundState; wakeAt?: string }> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection(REFUNDS).doc(id);
    const [snap, config] = await Promise.all([tx.get(ref), tx.get(db.collection("site_config").doc("main"))]);
    if (!snap.exists) return { credited: 0, state: "settled" as const };
    const refund = snap.data() as MinuteRefund;
    if (![refund.pendingMinutes, refund.requestedMinutes, refund.creditedMinutes, refund.version].every((n) => Number.isSafeInteger(n) && n >= 0)
      || refund.requestedMinutes !== refund.creditedMinutes + refund.pendingMinutes) {
      tx.update(ref, { state: "blocked", reason: "invalid_refund_accounting", updatedAt: (now ?? new Date()).toISOString() });
      return { credited: 0, state: "blocked" as const };
    }
    if (refund.pendingMinutes === 0) return { credited: 0, state: "settled" as const };
    if (!refund.reviewApproved) return { credited: 0, state: "awaiting_review" as const };
    if (refund.historical) {
      const hash = refund.approvedReportHash;
      const review = typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
        ? await tx.get(db.collection(`${REFUNDS}/${id}/movements`).doc(`review_${hash}`)) : undefined;
      if (!review?.exists || review.data()?.kind !== "review_approved" || review.data()?.reviewerUid !== refund.reviewerUid) {
        tx.update(ref, { reviewApproved: false, state: "awaiting_review", reason: "historical_review_required" });
        return { credited: 0, state: "awaiting_review" as const };
      }
    }
    if (config.data()?.[REFUND_FLAG] !== true) return { credited: 0, state: "paused" as const };
    const accountRef = db.collection(REFUND_ACCOUNTS).doc(refund.userId);
    const appointmentRef = db.collection("appointments").doc(refund.appointmentId);
    const deletionRef = db.collection("appointment_deletions").doc(refund.appointmentId);
    const [account, bonos, appointment, deletion] = await Promise.all([
      tx.get(accountRef), tx.get(db.collection("bonos").where("userId", "==", refund.userId).select(
        "userId", "estado", "tamano", "minutosTotales", "minutosRestantes", "minutosCapacidadBase", "minutosExtraRecuperados",
        "sesionesTotales", "sesionesRestantes", "modalidad", "fechaAsignacion", "fechaExpiracion", "createdAt", "replacedByBonoId")),
      tx.get(appointmentRef), tx.get(deletionRef),
    ]);
    const original = bonos.docs.find((d) => d.id === refund.sourceBonoId)
      ?? (refund.sourceBonoId ? await tx.get(db.collection("bonos").doc(refund.sourceBonoId)) : undefined);
    if (!refund.sourceBonoId || original?.exists && original.data()?.userId !== refund.userId) {
      tx.update(ref, { state: "blocked", reason: !refund.sourceBonoId ? "missing_source_bono" : "bono_owner_mismatch" });
      return { credited: 0, state: "blocked" as const };
    }
    const checkedAt = now ?? new Date();
    const destination = selectRefundDestination(bonos.docs.map((d) => ({ id: d.id, ...d.data() } as RefundBono)), refund.userId, checkedAt);
    if (!("bono" in destination)) {
      tx.update(ref, { state: destination.state, reason: destination.reason, updatedAt: checkedAt.toISOString() });
      return { credited: 0, ...destination };
    }
    const bono = destination.bono;
    const amount = refund.pendingMinutes;
    const base = bonoBaseMinutes(bono);
    const extras = (bono.minutosExtraRecuperados ?? 0) + amount;
    const capacity = base + extras;
    const before = bono.minutosRestantes ?? (bono.sesionesRestantes ?? 0) * (bono.modalidad === "30min" ? 30 : 60);
    const after = before + amount;
    if (!Number.isSafeInteger(capacity) || !Number.isSafeInteger(after) || after > capacity) throw new Error("Refund capacity exceeded");
    const at = checkedAt.toISOString();
    const next: MinuteRefund = { ...refund, creditedMinutes: refund.creditedMinutes + amount, pendingMinutes: 0,
      state: "settled", reason: null, targetBonoId: bono.id, updatedAt: at, lastCreditedAt: at, version: refund.version + 1 };
    const movementId = `credit_${next.version}`;
    tx.create(db.collection(`${REFUNDS}/${id}/movements`).doc(movementId), {
      kind: "recovered_credit", at, actor: "automatic", amount, targetBonoId: bono.id,
      balanceBefore: before, balanceAfter: after, capacityBefore: bonoEffectiveMinutes(bono), capacityAfter: capacity,
    });
    tx.update(db.collection("bonos").doc(bono.id), {
      minutosCapacidadBase: base, minutosExtraRecuperados: extras, minutosTotales: capacity, minutosRestantes: after, estado: "activo",
      historial: FieldValue.arrayUnion({ fecha: at, tipo: "Minutos recuperados", duracion: String(amount),
        minutosAbonados: amount, appointmentId: refund.appointmentId, refundId: id, movementId,
        accion: "compensacion_devolucion", sourceBonoId: refund.sourceBonoId }),
    });
    tx.update(ref, next);
    const source = appointment.data() as RefundSource | undefined;
    // An appointment can have another debit cycle by now: never overwrite it.
    if (source && reservationIdentity(refund.appointmentId, source) === refund.reservationId) tx.set(appointmentRef, refundProjection(id, next), { merge: true });
    const archiveFinance = deletion.data()?.finance;
    const archiveMatches = archiveFinance?.minuteRefundId
      ? archiveFinance.minuteRefundId === id
      : archiveFinance && reservationIdentity(refund.appointmentId, {
        userId: refund.userId, bonoId: archiveFinance.bonoId, minutesDeductedAt: archiveFinance.minutesDeductedAt,
      }) === refund.reservationId;
    if (deletion.exists && archiveMatches) tx.set(deletionRef, {
      finance: { pendingRefundMinutes: 0, cappedMinutes: 0, refundedAmount: next.creditedMinutes, refundStatus: "refunded", refundedToBonoId: bono.id, refundReason: null, minuteRefundId: id },
      manualReview: null,
      expiresAt: Timestamp.fromDate(new Date(Date.UTC(checkedAt.getUTCFullYear() + 2, checkedAt.getUTCMonth(), checkedAt.getUTCDate()))),
    }, { merge: true });
    tx.set(accountRef, { pendingMinutes: FieldValue.increment(-amount), revision: Number(account.data()?.revision ?? 0) + 1 }, { merge: true });
    return { credited: amount, state: "settled" as const };
  });
}

/** No scans of appointments or bonos. Waiting/review debts have no retry timer. */
export async function drainMinuteRefunds(db: Firestore, userId: string, now?: Date, expectedGeneration?: number): Promise<number> {
  const jobNow = now ?? new Date();
  const config = await db.collection("site_config").doc("main").get();
  if (config.data()?.[REFUND_FLAG] !== true) return 0;
  const accountRef = db.collection(REFUND_ACCOUNTS).doc(userId);
  const account = await accountRef.get();
  if (Number(account.data()?.pendingMinutes ?? 0) <= 0) {
    if (account.data()?.nextAttemptAt) await db.runTransaction(async (tx) => {
      const current = await tx.get(accountRef);
      if (Number(current.data()?.pendingMinutes ?? 0) <= 0) tx.set(accountRef, { nextAttemptAt: null }, { merge: true });
    });
    return 0;
  }
  const generation = Number(account.data()?.generation ?? 0);
  if (expectedGeneration !== undefined && generation !== expectedGeneration) return 0;
  const dueAt = account.data()?.nextAttemptAt;
  if (dueAt === null || typeof dueAt === "string" && dueAt > jobNow.toISOString()) return 0;
  let credited = 0;
  let wakeAt: string | null = null;
  let halted = false;
  try {
    const debts = await db.collection(REFUNDS).where("userId", "==", userId).where("pendingMinutes", ">", 0)
      .where("reviewApproved", "==", true).orderBy("pendingMinutes").limit(REFUND_BATCH + 1).get();
    for (const debt of debts.docs.slice(0, REFUND_BATCH)) {
      const result = await settleMinuteRefund(db, debt.id, now);
      credited += result.credited;
      if (result.wakeAt && (!wakeAt || result.wakeAt < wakeAt)) wakeAt = result.wakeAt;
      if (["waiting_bono", "blocked", "paused", "awaiting_review"].includes(result.state)) { halted = true; break; }
    }
    await db.runTransaction(async (tx) => {
      const current = await tx.get(accountRef);
      if (Number(current.data()?.generation ?? 0) !== generation) return;
      const continuation = debts.size > REFUND_BATCH && credited > 0 && !halted && Number(current.data()?.pendingMinutes ?? 0) > 0;
      tx.set(accountRef, {
        nextAttemptAt: wakeAt, attempts: 0,
        ...(continuation ? { generation: FieldValue.increment(1), nextAttemptAt: jobNow.toISOString() } : {}),
      }, { merge: true });
    });
    return credited;
  } catch (error) {
    const attempts = Math.min(Number(account.data()?.attempts ?? 0) + 1, 12);
    await accountRef.set({ attempts, nextAttemptAt: new Date(jobNow.getTime() + Math.min(6 * 3_600_000, 60_000 * 2 ** attempts)).toISOString() }, { merge: true });
    throw error;
  }
}

export async function recoverDueMinuteRefunds(db: Firestore, now?: Date): Promise<number> {
  const recoveryNow = now ?? new Date();
  const config = await db.collection("site_config").doc("main").get();
  if (config.data()?.[REFUND_FLAG] !== true) return 0;
  const due = await db.collection(REFUND_ACCOUNTS).where("nextAttemptAt", ">", "").where("nextAttemptAt", "<=", recoveryNow.toISOString())
    .orderBy("nextAttemptAt").limit(RECOVERY_BATCH).get();
  let credited = 0;
  for (const account of due.docs) {
    try { credited += await drainMinuteRefunds(db, account.id, now); }
    catch (error) { console.error("[MinuteRefund] Recovery deferred", { userId: account.id, error: String(error) }); }
  }
  return credited;
}

export async function wakeMinuteRefunds(db: Firestore, userId: string, now = new Date()): Promise<void> {
  const ref = db.collection(REFUND_ACCOUNTS).doc(userId);
  await db.runTransaction(async (tx) => {
    const account = await tx.get(ref);
    if (Number(account.data()?.pendingMinutes ?? 0) <= 0) return;
    const config = await tx.get(db.collection("site_config").doc("main"));
    if (config.data()?.[REFUND_FLAG] !== true) return;
    tx.set(ref, { generation: FieldValue.increment(1), nextAttemptAt: now.toISOString() }, { merge: true });
  });
}
