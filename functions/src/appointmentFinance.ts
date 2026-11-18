import { bonoStartInstant } from "./notifications/bonoEvents.js";
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  isBonoExpiredAt,
  isBonoReplaced,
  type LifecycleAppointment,
  type LifecycleBono,
  reconcileAppointmentMinutes,
} from "./appointmentLifecycle.js";
import { recordMinuteRefund, selectRefundDestination } from "./minuteRefunds.js";
import { bonoEffectiveMinutes, validBonoMinutes } from "./bonoMinutes.js";
import { chargeableMinutesOf, isChargedCancellation } from "./cancellationCharge.js";

/**
 * Bono minute movements tied to one appointment. Shared by the callables and
 * the `onAppointmentApproved` trigger so a debit or a refund happens exactly
 * once (markers `minutesDeductedAt` / `minutesRefundedAt`) whichever path
 * reaches it first.
 */

export interface FinanceAppointment extends LifecycleAppointment {
  userId: string;
  /** Set by a charged cancellation: its minutes are never refunded afterwards. */
  cancellationCharge?: unknown;
  serviceType?: string;
  duration?: string | number;
}

export interface FinanceSnapshot {
  exists: boolean;
  id: string;
  ref: DocumentReference;
  data(): unknown;
}

export interface FinanceContext {
  db?: Firestore;
  accountRevision?: number;
  /** The bono recorded on the appointment, when it has one. */
  originalBono?: FinanceSnapshot;
  /** Every `activo` bono of the appointment owner. */
  activeBonos: FinanceSnapshot[];
  latestBonos?: FinanceSnapshot[];
}

// Only financial decisions use these snapshots. History is appended with
// arrayUnion, never replaced. Do not use this projection in series replacement,
// which still reads and preserves the complete history.
export const FINANCE_FIELDS = [
  "userId", "estado", "tamano", "minutosTotales", "minutosRestantes",
  "sesionesTotales", "sesionesRestantes", "modalidad", "fechaExpiracion", "replacedByBonoId",
  "fechaAsignacion", "createdAt", "minutosCapacidadBase", "minutosExtraRecuperados",
] as const;

/** Create INSIDE the transaction callback: retries must read fresh balances. */
export function createFinanceContextReader(transaction: Transaction, db: Firestore) {
  const originals = new Map<string, Promise<FinanceSnapshot>>();
  const accounts = new Map<string, Promise<number>>();
  const activeByUser = new Map<string, Promise<FinanceSnapshot[]>>();
  const latestByUser = new Map<string, Promise<FinanceSnapshot[]>>();
  return async (appointment: { userId: string; bonoId?: string }): Promise<FinanceContext> => {
    let account = accounts.get(appointment.userId);
    if (!account) {
      account = transaction.get(db.collection("minute_refund_accounts").doc(appointment.userId)).then((snap) => Number(snap.data()?.revision ?? 0));
      accounts.set(appointment.userId, account);
    }
    let original = appointment.bonoId ? originals.get(appointment.bonoId) : undefined;
    if (appointment.bonoId && !original) {
      original = transaction.getAll(db.collection("bonos").doc(appointment.bonoId), {
        fieldMask: [...FINANCE_FIELDS],
      }).then(([snap]) => snap);
      originals.set(appointment.bonoId, original);
    }
    let active = activeByUser.get(appointment.userId);
    if (!active) {
      active = transaction.get(db.collection("bonos")
        .where("userId", "==", appointment.userId).where("estado", "==", "activo")
        .select(...FINANCE_FIELDS)).then((snap) => snap.docs);
      activeByUser.set(appointment.userId, active);
    }
    const [originalBono, activeBonos] = await Promise.all([original, active]);
    let latest = latestByUser.get(appointment.userId);
    if (activeBonos.length === 0 && !latest) {
      latest = transaction.get(db.collection("bonos").where("userId", "==", appointment.userId).select(...FINANCE_FIELDS)).then((snap) => snap.docs);
      latestByUser.set(appointment.userId, latest);
    }
    return { db, accountRevision: await account, originalBono, activeBonos, latestBonos: await latest };
  };
}

export const REFUND_ORIGINAL_MISSING = "No se ha encontrado el bono original para devolver los minutos.";
export const REFUND_NO_ACTIVE_BONO = "El bono original fue sustituido y el cliente no tiene un único bono activo al que devolver los minutos.";

type BonoWithUser = LifecycleBono & { userId?: string; historial?: unknown };

function bonoOf(snap: FinanceSnapshot): BonoWithUser & { id: string } {
  return { ...(snap.data() as BonoWithUser), id: snap.id };
}

/** Reads everything a debit or refund may need. Call during the read phase. */
export async function readFinanceContext(
  transaction: Transaction,
  db: Firestore,
  appointment: { userId: string; bonoId?: string },
): Promise<FinanceContext> {
  const [originalBono, activeSnap, account] = await Promise.all([
    appointment.bonoId ? transaction.get(db.collection("bonos").doc(appointment.bonoId)) : Promise.resolve(undefined),
    transaction.get(db.collection("bonos").where("userId", "==", appointment.userId).where("estado", "==", "activo")),
    transaction.get(db.collection("minute_refund_accounts").doc(appointment.userId)),
  ]);
  const activeBonos = activeSnap.docs;
  const latestBonos = activeBonos.length === 0
    ? (await transaction.get(db.collection("bonos").where("userId", "==", appointment.userId).select(...FINANCE_FIELDS))).docs : undefined;
  return { db, accountRevision: Number(account.data()?.revision ?? 0), originalBono, activeBonos, latestBonos };
}

/**
 * A bono is replaced when an admin assigned a newer one: explicitly marked,
 * or (legacy data) left `agotado` while the customer owns another active bono.
 */
export function isReplacedInContext(bono: BonoWithUser & { id: string }, activeBonos: FinanceSnapshot[]): boolean {
  if (isBonoReplaced(bono)) return true;
  return bono.estado === "agotado" && activeBonos.some((snap) => snap.id !== bono.id);
}

export type RefundTarget =
  | { kind: "none" }
  | { kind: "unavailable"; reason: string }
  | { kind: "bono"; snap: FinanceSnapshot; bono: BonoWithUser & { id: string }; redirectedFrom?: string };

/**
 * Where the minutes of `appointment` go back. A replaced bono is never
 * reactivated: the refund goes to the customer's single current active bono
 * instead, or nowhere (flagged for manual handling) when there is none.
 */
export function resolveRefundTarget(appointment: FinanceAppointment, context: FinanceContext, now: Date): RefundTarget {
  if (!appointment.bonoId) return { kind: "none" };
  if (!context.originalBono?.exists) return { kind: "unavailable", reason: REFUND_ORIGINAL_MISSING };
  const original = bonoOf(context.originalBono);
  if (!isReplacedInContext(original, context.activeBonos)) {
    return { kind: "bono", snap: context.originalBono, bono: original };
  }
  const candidates = context.activeBonos
    .filter((snap) => snap.id !== original.id)
    .map((snap) => ({ snap, bono: bonoOf(snap) }))
    .filter(({ bono }) => bono.userId === appointment.userId && !isBonoExpiredAt(bono, now));
  if (candidates.length !== 1) return { kind: "unavailable", reason: REFUND_NO_ACTIVE_BONO };
  return { kind: "bono", snap: candidates[0].snap, bono: candidates[0].bono, redirectedFrom: original.id };
}

export type RefundOutcome =
  | { kind: "not_applicable" }
  /** Cancelled with charge: the consumed minutes stay consumed (`amount` may be 0). */
  | { kind: "charged"; amount: number }
  | { kind: "unavailable"; amount: number; reason: string }
  | { kind: "refunded"; amount: number; cappedMinutes: number; targetBonoId: string; redirectedFrom?: string };

export interface RefundResult {
  refunded: boolean;
  appointmentPatch: Record<string, unknown>;
  outcome: RefundOutcome;
}

const NOT_APPLICABLE: RefundResult = { refunded: false, appointmentPatch: {}, outcome: { kind: "not_applicable" } };

/** Minutes the customer is owed but did not get back: kept for manual review, never credited automatically. */
export function pendingRefundMinutes(outcome: RefundOutcome): number {
  if (outcome.kind === "unavailable") return outcome.amount;
  if (outcome.kind === "refunded") return outcome.cappedMinutes;
  return 0;
}

/**
 * Returns the reserved minutes at most once. Writes the bono and returns the
 * appointment patch (also merged into the appointment unless it is about to be
 * deleted). Never exceeds the bono maximum. Minutes that cannot be returned
 * (no valid bono) or do not fit (capped) are flagged for manual review
 * (`minutesRefundPendingReview`) and never moved to another bono on their own.
 */
export function refundAppointmentMinutesInTransaction(
  transaction: Transaction,
  appointmentRef: DocumentReference,
  appointment: FinanceAppointment,
  context: FinanceContext,
  now: string,
  options: { persistAppointment?: boolean; reason?: string | null } = {},
): RefundResult {
  const persist = options.persistAppointment !== false;
  if (appointment.appointmentType === "nutrition") return NOT_APPLICABLE;
  // Single guard for every later path (trigger, delete, block-and-delete):
  // a charge decided by the admin is never undone by a refund.
  if (isChargedCancellation(appointment)) {
    return { refunded: false, appointmentPatch: {}, outcome: { kind: "charged", amount: chargeableMinutesOf(appointment) } };
  }
  // RequestedAt is a release latch, not a claim that money/minutes were credited.
  // Existing canonical debt survives deletion and must never be recreated.
  const priorPending = Number(appointment.minutesRefundPendingAmount ?? appointment.minutesRefundCappedAmount ?? 0);
  const alreadyRequested = Boolean(appointment.minutesRefundRequestedAt || appointment.minuteRefundId);
  const legacyRefund = Boolean(appointment.minutesRefundedAt);
  if (alreadyRequested || legacyRefund && priorPending <= 0) {
    if (!persist && appointment.minuteRefundId && context.db) {
      transaction.set(context.db.collection("minute_refunds").doc(appointment.minuteRefundId), { sourceDeleted: true }, { merge: true });
    }
    return priorPending > 0
      ? { refunded: false, appointmentPatch: {}, outcome: { kind: "unavailable", amount: priorPending, reason: "Devolución pendiente conservada en el registro financiero." } }
      : NOT_APPLICABLE;
  }
  const reserved = appointment.minutesDeducted === true && Boolean(appointment.minutesDeductedAt);
  const amount = Number(appointment.minutesDeductedAmount ?? 0);
  if (!reserved || !Number.isSafeInteger(amount) || amount <= 0) return NOT_APPLICABLE;
  const db = context.db ?? appointmentRef.firestore;
  if (!db) throw new Error("A Firestore context is required to preserve minute refunds");

  let credited = 0;
  let targetBonoId: string | undefined;
  let reason: string | null = options.reason ?? null;
  const historical = priorPending > 0;
  if (historical) {
    // Do not trust the legacy boolean. Preserve evidence, block auto settlement.
    credited = amount - priorPending;
    targetBonoId = appointment.minutesRefundedToBonoId ?? appointment.bonoId;
    reason = "historical_review_required";
  } else {
    const target = resolveRefundTarget(appointment, context, new Date(now));
    // Restoring an already reserved original bono before its start does not grant
    // a new entitlement or widen its validity (renewal confirmations work this way).
    const originalStart = target.kind === "bono" && target.snap.id === appointment.bonoId
      ? bonoStartInstant(target.bono.fechaAsignacion)?.getTime() : undefined;
    const eligibilityTime = new Date(Math.max(Date.parse(now), originalStart ?? Date.parse(now)));
    const eligible = selectRefundDestination((context.activeBonos.length ? context.activeBonos : context.latestBonos ?? [])
      .map((snap) => bonoOf(snap)), appointment.userId, eligibilityTime);
    // Transfers (including spare capacity on a newer bono) are recovered extras,
    // and are processed only by the flag/review-gated worker.
    if (target.kind === "bono" && "bono" in eligible && eligible.bono.id === target.snap.id && target.snap.id === appointment.bonoId
      && target.bono.userId === appointment.userId && !isBonoExpiredAt(target.bono, new Date(now))
      && !isBonoReplaced(target.bono) && ["activo", "agotado"].includes(target.bono.estado)
      && context.activeBonos.length <= 1 && validBonoMinutes(target.bono)) {
      const current = Number(target.bono.minutosRestantes ?? (target.bono.sesionesRestantes ?? 0) * (target.bono.modalidad === "30min" ? 30 : 60));
      // Pure calculation only for an eligible original: never credit expired or replaced bonos.
      const total = bonoEffectiveMinutes(target.bono);
      credited = Math.max(0, Math.min(amount, total - current));
      targetBonoId = target.snap.id;
      if (credited > 0) transaction.set(target.snap.ref, {
        minutosRestantes: current + credited, estado: "activo",
        historial: FieldValue.arrayUnion({ fecha: now, tipo: appointment.serviceType ?? "",
          duracion: String(credited), minutosAbonados: credited, minutosSolicitados: amount,
          appointmentId: appointmentRef.id, accion: "devolucion_cita" }),
      }, { merge: true });
    } else {
      reason = !appointment.bonoId ? "missing_source_bono"
        : context.originalBono?.exists && bonoOf(context.originalBono).userId !== appointment.userId ? "bono_owner_mismatch"
        : "state" in eligible && eligible.state === "blocked" ? eligible.reason : "automatic_compensation_required";
    }
  }
  const record = recordMinuteRefund(transaction, db, appointmentRef, appointment, now, { credited, targetBonoId, reason, historical });
  transaction.set(db.collection("minute_refund_accounts").doc(appointment.userId), {
    userId: appointment.userId, revision: (context.accountRevision ?? 0) + 1,
  }, { merge: true });
  if (!persist) transaction.set(db.collection("minute_refunds").doc(record.id), { sourceDeleted: true }, { merge: true });
  if (persist) transaction.set(appointmentRef, record.patch, { merge: true });
  return {
    refunded: credited > 0,
    appointmentPatch: record.patch,
    outcome: credited > 0 && targetBonoId
      ? { kind: "refunded", amount, cappedMinutes: record.refund.pendingMinutes, targetBonoId }
      : { kind: "unavailable", amount: record.refund.pendingMinutes, reason: reason ?? "pending_automatic_compensation" },
  };
}

/** Debits `bonoSnap` once; returns the appointment audit fields (undefined when refused). */
export function deductAppointmentMinutesInTransaction(
  transaction: Transaction,
  appointmentRef: DocumentReference,
  appointment: FinanceAppointment,
  bonoSnap: FinanceSnapshot,
  minutes: number,
  now: string,
  persistAppointmentAudit = true,
): Record<string, unknown> | undefined {
  if (!bonoSnap.exists) return undefined;
  let bonoUpdate: { minutosRestantes: number; estado: LifecycleBono["estado"] } | undefined;
  let audit: Record<string, unknown> | undefined;
  const reconciliation = reconcileAppointmentMinutes({
    action: "deduct",
    appointment,
    bono: bonoOf(bonoSnap),
    amount: minutes,
    now,
    transaction: {
      setBono: (_bonoId, patch) => { bonoUpdate = patch; },
      setAppointment: (patch) => { audit = patch; },
    },
  });
  if (!reconciliation.ok || !bonoUpdate || !audit) return undefined;
  const priorPending = Number(appointment.minutesRefundPendingAmount ?? appointment.minutesRefundCappedAmount ?? 0);
  if (priorPending > 0 && !appointment.minuteRefundId) {
    const db = appointmentRef.firestore ?? (appointmentRef as unknown as { db: Firestore }).db;
    recordMinuteRefund(transaction, db, appointmentRef, appointment, now, {
      credited: Number(appointment.minutesDeductedAmount ?? 0) - priorPending,
      historical: true, targetBonoId: appointment.minutesRefundedToBonoId ?? appointment.bonoId,
      reason: "historical_review_required",
    });
  }

  transaction.set(bonoSnap.ref, {
    ...bonoUpdate,
    historial: FieldValue.arrayUnion({
      fecha: now,
      tipo: appointment.serviceType ?? "",
      duracion: String(minutes),
      minutosDescontados: minutes,
      appointmentId: appointmentRef.id,
      accion: "descuento_cita",
    }),
  }, { merge: true });
  if (persistAppointmentAudit) transaction.set(appointmentRef, audit, { merge: true });
  return audit;
}

/**
 * Debit owed when an appointment becomes approved (historical rule of the
 * `onAppointmentApproved` trigger): nothing if minutes are already reserved;
 * otherwise the original bono, or the customer's single active bono. Never a
 * replaced bono. Records why when it cannot debit.
 */
export function applyApprovalDeductionInTransaction(
  transaction: Transaction,
  appointmentRef: DocumentReference,
  appointment: FinanceAppointment,
  minutes: number,
  context: FinanceContext,
  now: string,
): Record<string, unknown> {
  if (appointment.appointmentType === "nutrition") return {};
  if ((appointment.minutesDeductedAt || appointment.minutesDeducted === true) && !appointment.minutesRefundedAt && !appointment.minutesRefundRequestedAt
    && (appointment.minutesRefundPendingAmount ?? appointment.minutesRefundCappedAmount ?? 0) <= 0) return {};

  const skip = (reason: string): Record<string, unknown> => {
    const patch = { minutesDeductionSkippedAt: now, minutesDeductionSkippedReason: reason };
    transaction.set(appointmentRef, patch, { merge: true });
    return patch;
  };

  let bonoSnap: FinanceSnapshot | undefined;
  if (context.originalBono?.exists) {
    const original = bonoOf(context.originalBono);
    if (original.userId !== appointment.userId) {
      return skip("El bono original no pertenece al usuario de esta cita.");
    }
    if (!isReplacedInContext(original, context.activeBonos)) bonoSnap = context.originalBono;
  }
  if (!bonoSnap) {
    if (context.activeBonos.length !== 1) {
      return skip(context.activeBonos.length === 0
        ? "No hay un bono activo para descontar los minutos de esta cita antigua."
        : "Hay más de un bono activo y no se puede elegir uno automáticamente.");
    }
    bonoSnap = context.activeBonos[0];
  }

  const audit = deductAppointmentMinutesInTransaction(transaction, appointmentRef, appointment, bonoSnap, minutes, now);
  if (!audit) return skip("El bono activo está expirado o no tiene minutos suficientes.");
  return audit;
}

export class BonoLedger {
  private readonly working = new Map<string, Record<string, unknown>>();
  private readonly refs = new Map<string, DocumentReference>();

  wrap(snap: FinanceSnapshot | undefined): FinanceSnapshot | undefined {
    if (!snap) return undefined;
    if (snap.exists && !this.working.has(snap.id)) {
      this.working.set(snap.id, { ...(snap.data() as Record<string, unknown>) });
      this.refs.set(snap.id, snap.ref);
    }
    return {
      exists: snap.exists,
      id: snap.id,
      ref: snap.ref,
      data: () => (snap.exists ? { ...this.working.get(snap.id) } : undefined),
    };
  }

  context(context: FinanceContext): FinanceContext {
    return {
      db: context.db,
      accountRevision: context.accountRevision,
      originalBono: this.wrap(context.originalBono),
      activeBonos: context.activeBonos.map((snap) => this.wrap(snap) as FinanceSnapshot),
      latestBonos: context.latestBonos?.map((snap) => this.wrap(snap) as FinanceSnapshot),
    };
  }

  /** Transaction proxy that keeps the working copy in sync with bono writes. */
  transaction(transaction: Transaction): Transaction {
    return new Proxy(transaction, {
      get: (target, property) => {
        if (property !== "set") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (ref: DocumentReference, value: Record<string, unknown>, options?: unknown) => {
          const id = ref.id;
          if (this.refs.has(id) && this.refs.get(id)?.path === ref.path) {
            const next = { ...this.working.get(id) };
            for (const [field, fieldValue] of Object.entries(value)) {
              if (field !== "historial") next[field] = fieldValue;
            }
            this.working.set(id, next);
          }
          return (target.set as (...args: unknown[]) => unknown).call(target, ref, value, options);
        };
      },
    }) as Transaction;
  }
}
