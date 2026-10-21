import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  isBonoExpiredAt,
  isBonoReplaced,
  type LifecycleAppointment,
  type LifecycleBono,
  reconcileAppointmentMinutes,
} from "./appointmentLifecycle.js";
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
  /** The bono recorded on the appointment, when it has one. */
  originalBono?: FinanceSnapshot;
  /** Every `activo` bono of the appointment owner. */
  activeBonos: FinanceSnapshot[];
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
  const [originalBono, activeSnap] = await Promise.all([
    appointment.bonoId ? transaction.get(db.collection("bonos").doc(appointment.bonoId)) : Promise.resolve(undefined),
    transaction.get(db.collection("bonos").where("userId", "==", appointment.userId).where("estado", "==", "activo")),
  ]);
  return {
    originalBono: originalBono as FinanceSnapshot | undefined,
    activeBonos: (activeSnap as unknown as { docs: FinanceSnapshot[] }).docs,
  };
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
  const alreadyRefunded = Boolean(appointment.minutesRefundedAt);
  const reserved = appointment.minutesDeducted === true && Boolean(appointment.minutesDeductedAt);
  if (alreadyRefunded || !reserved) return NOT_APPLICABLE;
  const amount = Number(appointment.minutesDeductedAmount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return NOT_APPLICABLE;

  const target = resolveRefundTarget(appointment, context, new Date(now));
  if (target.kind === "none") return NOT_APPLICABLE;
  if (target.kind === "unavailable") {
    const patch = {
      minutesRefundReason: target.reason,
      minutesRefundPendingReview: true,
      minutesRefundPendingAmount: amount,
    };
    if (persist) transaction.set(appointmentRef, patch, { merge: true });
    return { refunded: false, appointmentPatch: patch, outcome: { kind: "unavailable", amount, reason: target.reason } };
  }

  let bonoPatch: { minutosRestantes: number; estado: LifecycleBono["estado"] } | undefined;
  let appointmentPatch: Record<string, unknown> | undefined;
  const result = reconcileAppointmentMinutes({
    action: "refund",
    appointment,
    bono: target.bono,
    now,
    transaction: {
      setBono: (_id, patch) => { bonoPatch = patch; },
      setAppointment: (patch) => { appointmentPatch = patch; },
    },
  });
  if (!result.ok || !bonoPatch || !appointmentPatch) return NOT_APPLICABLE;

  transaction.set(target.snap.ref, {
    ...bonoPatch,
    historial: FieldValue.arrayUnion({
      fecha: now,
      tipo: appointment.serviceType ?? "",
      duracion: String(appointment.duration ?? ""),
      appointmentId: appointmentRef.id,
      accion: "devolucion_cita",
      ...(target.redirectedFrom ? { sourceBonoId: target.redirectedFrom } : {}),
    }),
  }, { merge: true });

  const cappedMinutes = Number((appointmentPatch as Record<string, unknown>).minutesRefundCappedAmount ?? 0);
  const patch: Record<string, unknown> = {
    ...appointmentPatch,
    ...(options.reason !== undefined ? { minutesRefundReason: options.reason } : {}),
    ...(target.redirectedFrom ? { minutesRefundedToBonoId: target.snap.id } : {}),
    ...(cappedMinutes > 0 ? { minutesRefundPendingReview: true, minutesRefundPendingAmount: cappedMinutes } : {}),
  };
  if (persist) transaction.set(appointmentRef, patch, { merge: true });
  return {
    refunded: true,
    appointmentPatch: patch,
    outcome: {
      kind: "refunded",
      amount,
      cappedMinutes,
      targetBonoId: target.snap.id,
      ...(target.redirectedFrom ? { redirectedFrom: target.redirectedFrom } : {}),
    },
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

  transaction.set(bonoSnap.ref, {
    ...bonoUpdate,
    historial: FieldValue.arrayUnion({
      fecha: now,
      tipo: appointment.serviceType ?? "",
      duracion: String(appointment.duration ?? ""),
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
  if ((appointment.minutesDeductedAt || appointment.minutesDeducted === true) && !appointment.minutesRefundedAt) return {};

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
