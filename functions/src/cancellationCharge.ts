import type { LifecycleAppointment } from "./appointmentLifecycle.js";

/**
 * How a cancellation treats the bono minutes.
 *
 * - `charged`: the admin keeps the minutes already consumed (same-day
 *   cancellations, which only the admin can make). Never a session done and
 *   never an hour counted for the trainer.
 * - `not_charged`: the reserved minutes go back to the bono.
 *
 * Cancellations written before this field existed have no value and are
 * shown as "Sin clasificar": they are never classified after the fact.
 */
export type CancellationCharge = "charged" | "not_charged";
export type CancellationChargeDecider = "admin" | "customer" | "system";

export const CANCELLATION_CHARGES: readonly CancellationCharge[] = ["charged", "not_charged"];

export interface ChargeableAppointment extends LifecycleAppointment {
  cancellationCharge?: unknown;
}

export function isCancellationCharge(value: unknown): value is CancellationCharge {
  return typeof value === "string" && (CANCELLATION_CHARGES as readonly string[]).includes(value);
}

/** A charged cancellation keeps its minutes forever: no path may refund them. */
export function isChargedCancellation(appointment: ChargeableAppointment): boolean {
  return appointment.cancellationCharge === "charged";
}

/**
 * Minutes a charge keeps: exactly what the appointment had consumed and not
 * got back. Zero when nothing was deducted (admin-created pending request,
 * no bono, nutrition, skipped deduction): a charge never debits anything new.
 */
export function chargeableMinutesOf(appointment: ChargeableAppointment): number {
  if (appointment.appointmentType === "nutrition") return 0;
  if (appointment.minutesRefundedAt) return 0;
  if (appointment.minutesDeducted !== true || !appointment.minutesDeductedAt) return 0;
  const amount = Number(appointment.minutesDeductedAmount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : 0;
}

/** Fields recorded on the appointment by every cancellation written from now on. */
export function cancellationChargePatch(input: {
  charge: CancellationCharge;
  chargedMinutes: number;
  decidedBy: CancellationChargeDecider;
  decidedByUid?: string;
  now: string;
}): Record<string, unknown> {
  return {
    cancellationCharge: input.charge,
    cancellationChargedMinutes: input.charge === "charged" ? Math.max(0, Math.trunc(input.chargedMinutes)) : 0,
    cancellationChargeDecidedBy: input.decidedBy,
    ...(input.decidedByUid ? { cancellationChargeDecidedByUid: input.decidedByUid } : {}),
    cancellationChargeDecidedAt: input.now,
  };
}

/** Customer and automatic cancellations always refund: they are "sin cargo". */
export function notChargedCancellationPatch(
  decidedBy: Exclude<CancellationChargeDecider, "admin">,
  now: string,
  decidedByUid?: string,
): Record<string, unknown> {
  return cancellationChargePatch({ charge: "not_charged", chargedMinutes: 0, decidedBy, decidedByUid, now });
}
