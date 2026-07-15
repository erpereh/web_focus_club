export type BonoStatus = "activo" | "agotado" | "expirado" | "eliminado";

export interface LifecycleBono {
  id: string;
  estado: BonoStatus;
  tamano?: number;
  minutosTotales?: number;
  minutosRestantes?: number;
  sesionesTotales?: number;
  sesionesRestantes?: number;
  modalidad?: string;
  fechaExpiracion?: string;
}

export interface LifecycleAppointment {
  bonoId?: string;
  minutesDeducted?: boolean;
  minutesDeductedAmount?: number;
  minutesDeductedAt?: string | null;
  minutesRefunded?: boolean;
  minutesRefundedAmount?: number | null;
  minutesRefundedAt?: string | null;
  minutesRefundReason?: string | null;
}

export interface LifecycleTransactionAdapter {
  setBono(id: string, patch: { minutosRestantes: number; estado: BonoStatus }): void;
  setAppointment(patch: Record<string, unknown>): void;
}

export interface ReconcileAppointmentMinutesInput {
  action: "deduct" | "refund";
  appointment: LifecycleAppointment;
  bono: LifecycleBono;
  amount?: number;
  now: string;
  transaction: LifecycleTransactionAdapter;
}

export function getBonoTotalMinutes(bono: LifecycleBono): number {
  if (typeof bono.tamano === "number" && typeof bono.minutosTotales === "number") {
    return Math.max(bono.tamano, bono.minutosTotales);
  }
  if (typeof bono.minutosTotales === "number") return bono.minutosTotales;
  if (typeof bono.tamano === "number") return bono.tamano;
  return (bono.sesionesTotales ?? 0) * (bono.modalidad === "30min" ? 30 : 60);
}

export function getBonoRemainingMinutes(bono: LifecycleBono): number {
  const total = getBonoTotalMinutes(bono);
  if (typeof bono.minutosRestantes === "number") return Math.max(0, Math.min(bono.minutosRestantes, total));
  return Math.max(0, Math.min((bono.sesionesRestantes ?? 0) * (bono.modalidad === "30min" ? 30 : 60), total));
}

export function isBonoExpiredAt(bono: LifecycleBono, now: Date): boolean {
  return Boolean(bono.fechaExpiracion && new Date(bono.fechaExpiracion) < now);
}

export function selectExactlyOneActiveBono<T extends { estado: string }>(bonos: T[]): T | undefined {
  return bonos.length === 1 && bonos[0].estado === "activo" ? bonos[0] : undefined;
}

export function calculateAppointmentDeduction(bono: LifecycleBono, amount: number, now: string) {
  if (!Number.isFinite(amount) || amount <= 0 || isBonoExpiredAt(bono, new Date(now))) {
    return { ok: false as const, reason: "unavailable-bono" };
  }
  const remainingMinutes = getBonoRemainingMinutes(bono);
  if (remainingMinutes < amount) return { ok: false as const, reason: "insufficient-minutes" };

  const nextMinutes = remainingMinutes - amount;
  return {
    ok: true as const,
    bonoId: bono.id,
    remainingMinutes: nextMinutes,
    bonoStatus: nextMinutes === 0 ? "agotado" as const : bono.estado,
    minutesDeducted: true as const,
    minutesDeductedAmount: amount,
    minutesDeductedAt: now,
  };
}

export function calculateAppointmentRefund(bono: LifecycleBono, appointment: LifecycleAppointment, now: string) {
  const amount = appointment.minutesDeductedAmount ?? 0;
  if (appointment.minutesDeducted !== true || !appointment.minutesDeductedAt
    || appointment.minutesRefundedAt || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, reason: "not-refundable" };
  }

  const remainingMinutes = Math.min(getBonoTotalMinutes(bono), getBonoRemainingMinutes(bono) + amount);
  return {
    ok: true as const,
    remainingMinutes,
    bonoStatus: bono.estado === "agotado" && !isBonoExpiredAt(bono, new Date(now)) ? "activo" as const : bono.estado,
    minutesRefunded: true as const,
    minutesRefundedAmount: amount,
    minutesRefundedAt: now,
  };
}

/**
 * Performs the mutable portion of a debit/refund through a minimal transaction
 * adapter. Firebase callers add their audit history alongside these writes;
 * tests can run the same lifecycle orchestration in memory.
 */
export function reconcileAppointmentMinutes(input: ReconcileAppointmentMinutesInput):
  { ok: true; appointmentPatch: Record<string, unknown> } | { ok: false; reason: string } {
  if (input.action === "deduct") {
    if ((input.appointment.minutesDeducted === true || Boolean(input.appointment.minutesDeductedAt))
      && !input.appointment.minutesRefundedAt) {
      return { ok: false, reason: "already-deducted" };
    }
    const deduction = calculateAppointmentDeduction(input.bono, input.amount ?? 0, input.now);
    if (!deduction.ok) return deduction;

    const appointmentPatch = {
      bonoId: deduction.bonoId,
      minutesDeducted: true,
      minutesDeductedAmount: deduction.minutesDeductedAmount,
      minutesDeductedAt: deduction.minutesDeductedAt,
      minutesDeductionSkippedAt: null,
      minutesDeductionSkippedReason: null,
      minutesRefunded: false,
      minutesRefundedAmount: null,
      minutesRefundedAt: null,
      minutesRefundReason: null,
    };
    input.transaction.setBono(deduction.bonoId, {
      minutosRestantes: deduction.remainingMinutes,
      estado: deduction.bonoStatus,
    });
    input.transaction.setAppointment(appointmentPatch);
    return { ok: true, appointmentPatch };
  }

  const refund = calculateAppointmentRefund(input.bono, input.appointment, input.now);
  if (!refund.ok) return refund;
  const appointmentPatch = {
    minutesRefunded: refund.minutesRefunded,
    minutesRefundedAmount: refund.minutesRefundedAmount,
    minutesRefundedAt: refund.minutesRefundedAt,
    minutesRefundReason: null,
  };
  input.transaction.setBono(input.bono.id, {
    minutosRestantes: refund.remainingMinutes,
    estado: refund.bonoStatus,
  });
  input.transaction.setAppointment(appointmentPatch);
  return { ok: true, appointmentPatch };
}

export function validateOwnFutureAppointment(
  appointment: { userId: string; status: string; date?: string; time?: string },
  uid: string,
  nowMillis: number,
): "not-owner" | "invalid-status" | "not-future" | undefined {
  if (appointment.userId !== uid) return "not-owner";
  if (appointment.status !== "pending" && appointment.status !== "approved") return "invalid-status";
  const date = appointment.date && appointment.time ? new Date(`${appointment.date}T${appointment.time}:00`) : undefined;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= nowMillis) return "not-future";
  return undefined;
}

/** Validates both the existing effective slot and the requested replacement slot. */
export function validateOwnReschedule(
  appointment: { userId: string; status: string; date?: string; time?: string },
  uid: string,
  preferredSlot: { date: string; time: string },
  nowMillis: number,
): "not-owner" | "invalid-status" | "not-future" | undefined {
  const existingValidation = validateOwnFutureAppointment(appointment, uid, nowMillis);
  if (existingValidation) return existingValidation;
  const preferredDate = new Date(`${preferredSlot.date}T${preferredSlot.time}:00`);
  if (Number.isNaN(preferredDate.getTime()) || preferredDate.getTime() <= nowMillis) return "not-future";
  return undefined;
}

/** Approval metadata that must never survive an approved-to-pending reschedule. */
export function approvalOnlyAppointmentFields(): readonly string[] {
  return [
    "approvedSlot",
    "assignedTrainer",
    "sessionType",
    "trainerNotes",
    "approvedAt",
    "approvedBy",
    "approvedByAdmin",
    "approvalNotes",
  ];
}

export interface RescheduleTransactionAdapter {
  releaseApprovedOccupancy(): void;
  clearApprovalMetadata(fields: readonly string[]): void;
  setAppointment(patch: Record<string, unknown>): void;
}

export interface ReconcileOwnAppointmentRescheduleInput {
  appointment: { userId: string; status: string; date?: string; time?: string };
  uid: string;
  preferredSlot: { date: string; time: string };
  nowMillis: number;
  now: string;
  transaction: RescheduleTransactionAdapter;
}

/**
 * Reconciles the local, transactional portion of an own-appointment reschedule.
 * Availability checks remain Firestore-specific, but every successful approved
 * reschedule releases occupancy and clears approval metadata together.
 */
export function reconcileOwnAppointmentReschedule(input: ReconcileOwnAppointmentRescheduleInput):
  { ok: true } | { ok: false; reason: "not-owner" | "invalid-status" | "not-future" } {
  const validation = validateOwnReschedule(
    input.appointment,
    input.uid,
    input.preferredSlot,
    input.nowMillis,
  );
  if (validation) return { ok: false, reason: validation };

  if (input.appointment.status === "approved") {
    input.transaction.releaseApprovedOccupancy();
    input.transaction.clearApprovalMetadata(approvalOnlyAppointmentFields());
  }
  input.transaction.setAppointment({
    preferredSlots: [input.preferredSlot],
    date: input.preferredSlot.date,
    time: input.preferredSlot.time,
    status: "pending",
    modifiedBy: input.uid,
    modifiedAt: input.now,
    updatedAt: input.now,
  });
  return { ok: true };
}

export function isRescheduleCapacityAvailable(currentCount: number, includesOwnApprovedOccupancy: boolean, maxCapacity: number): boolean {
  return Math.max(0, currentCount - (includesOwnApprovedOccupancy ? 1 : 0)) < maxCapacity;
}

export function shouldReconcileAppointmentTransition(expectedStatus: string, currentStatus: string): boolean {
  return expectedStatus === currentStatus;
}
