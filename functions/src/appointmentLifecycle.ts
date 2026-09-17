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

export const MADRID_TIME_ZONE = "Europe/Madrid";
export const SAME_DAY_CHANGE_NOT_ALLOWED = "same_day_change_not_allowed" as const;
export const SAME_DAY_CHANGE_MESSAGE = "Las citas no se pueden modificar ni cancelar el mismo día.";
export const ONE_DAY_CHANGE_NOT_ALLOWED = "one_day_change_not_allowed" as const;
export const ONE_DAY_CHANGE_MESSAGE = "Esta cita ya está dentro del plazo de 24 horas previo al entrenamiento y no puede modificarse.";
export const CUSTOMER_RESCHEDULE_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ClientAppointmentMutationBlockReason =
  | "not-owner"
  | "invalid-status"
  | typeof SAME_DAY_CHANGE_NOT_ALLOWED;

export interface AppointmentSlotLike {
  date?: string;
  time?: string;
}

export interface EffectiveAppointmentSlot {
  date: string;
  time: string;
}

export interface AppointmentEffectiveDateSource {
  approvedSlot?: AppointmentSlotLike | null;
  preferredSlots?: AppointmentSlotLike[];
  date?: string;
  time?: string;
  userId?: string;
  status?: string;
}

/** Calendar day in Europe/Madrid. Formats `now` only; appointment dateKeys stay YYYY-MM-DD strings. */
export function getMadridDateKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("No se ha podido calcular la fecha en Europe/Madrid.");
  }
  return `${year}-${month}-${day}`;
}

export function isSameDayInMadrid(dateKey: string, now: Date): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey === getMadridDateKey(now);
}

export interface MadridCivilSlotState {
  isValid: boolean;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
}

function getMadridTimeKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!hour || !minute) {
    throw new Error("No se ha podido calcular la hora en Europe/Madrid.");
  }
  return `${hour}:${minute}`;
}

interface CivilDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const madridCivilFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MADRID_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parseCivilSlot(slot: AppointmentSlotLike): CivilDateTimeParts | undefined {
  const date = slot.date ?? "";
  const time = slot.time ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return undefined;
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day) {
    return undefined;
  }
  return { year, month, day, hour, minute };
}

function madridParts(instant: Date): CivilDateTimeParts & { second: number } {
  const parts = madridCivilFormatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function madridOffsetMilliseconds(instant: Date): number {
  const parts = madridParts(instant);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - instant.getTime();
}

/**
 * Resolves a Europe/Madrid civil slot to a real instant without using the
 * server timezone. Non-existent DST wall times are invalid; repeated wall
 * times resolve to their earliest real instant.
 */
export function madridCivilSlotToInstant(slot: AppointmentSlotLike): Date | undefined {
  const civil = parseCivilSlot(slot);
  if (!civil) return undefined;
  const civilAsUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute);
  const probeOffsets = new Set<number>();
  [-48, -24, 0, 24, 48].forEach((hours) => {
    probeOffsets.add(madridOffsetMilliseconds(new Date(civilAsUtc + hours * 60 * 60 * 1000)));
  });
  const candidates = [...probeOffsets]
    .map((offset) => new Date(civilAsUtc - offset))
    .filter((candidate) => {
      const parts = madridParts(candidate);
      return parts.year === civil.year
        && parts.month === civil.month
        && parts.day === civil.day
        && parts.hour === civil.hour
        && parts.minute === civil.minute
        && parts.second === 0;
    })
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0];
}

/** Inclusive real-time lock window for customer reschedules. Invalid slots fail closed. */
export function isInsideCustomerRescheduleLockWindow(slot: AppointmentSlotLike, now: Date): boolean {
  const appointmentStart = madridCivilSlotToInstant(slot);
  return !appointmentStart
    || appointmentStart.getTime() - now.getTime() <= CUSTOMER_RESCHEDULE_LOCK_WINDOW_MS;
}

/** Compares a civil gym slot against the Madrid wall clock without parsing it in the server timezone. */
export function classifyMadridCivilSlot(slot: AppointmentSlotLike, now: Date): MadridCivilSlotState {
  const date = slot.date ?? "";
  const time = slot.time ?? "";
  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && parsedDate.getUTCFullYear() === year
    && parsedDate.getUTCMonth() === month - 1
    && parsedDate.getUTCDate() === day;
  const validTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!validDate || !validTime) {
    return { isValid: false, isToday: false, isPast: false, isFuture: false };
  }

  const today = getMadridDateKey(now);
  const isToday = isSameDayInMadrid(date, now);
  const isFuture = date > today || (isToday && time > getMadridTimeKey(now));
  return {
    isValid: true,
    isToday,
    isPast: !isFuture,
    isFuture,
  };
}

function isEffectiveSlot(value: AppointmentSlotLike | null | undefined): value is EffectiveAppointmentSlot {
  return Boolean(
    value
    && typeof value.date === "string"
    && typeof value.time === "string"
    && value.date.length > 0
    && value.time.length > 0,
  );
}

/** Canonical appointment date/time: approvedSlot, else first preferred slot, else legacy date/time. */
export function getAppointmentEffectiveSlot(
  appointment: AppointmentEffectiveDateSource,
): EffectiveAppointmentSlot | undefined {
  const legacy = appointment.date && appointment.time
    ? { date: appointment.date, time: appointment.time }
    : undefined;
  const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0] ?? legacy;
  return isEffectiveSlot(slot) ? { date: slot.date, time: slot.time } : undefined;
}

export function isClientSameDayChange(appointment: AppointmentEffectiveDateSource, now: Date): boolean {
  const slot = getAppointmentEffectiveSlot(appointment);
  return Boolean(slot && isSameDayInMadrid(slot.date, now));
}

export function seriesHasSameDayOccurrence(
  occurrences: AppointmentEffectiveDateSource[],
  now: Date,
): boolean {
  return occurrences.some((occurrence) => isClientSameDayChange(occurrence, now));
}

/**
 * Client cancel/modify pre-checks. Same-day is evaluated after owner/status and
 * BEFORE the legacy not-future datetime check, so a past clock time today still blocks.
 */
export function clientOwnAppointmentMutationBlockedReason(
  appointment: AppointmentEffectiveDateSource & { userId: string; status: string },
  uid: string,
  now: Date,
): ClientAppointmentMutationBlockReason | undefined {
  if (appointment.userId !== uid) return "not-owner";
  if (appointment.status !== "pending" && appointment.status !== "approved") return "invalid-status";
  if (isClientSameDayChange(appointment, now)) return SAME_DAY_CHANGE_NOT_ALLOWED;
  return undefined;
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
): "not-owner" | "invalid-status" | "not-future" | "one-day-lock" | undefined {
  if (appointment.userId !== uid) return "not-owner";
  if (appointment.status !== "pending" && appointment.status !== "approved") return "invalid-status";
  const existingSlot = { date: appointment.date, time: appointment.time };
  const existingDate = madridCivilSlotToInstant(existingSlot);
  const preferredDate = madridCivilSlotToInstant(preferredSlot);
  if (!existingDate || existingDate.getTime() <= nowMillis
    || !preferredDate || preferredDate.getTime() <= nowMillis) {
    return "not-future";
  }
  const now = new Date(nowMillis);
  if (isInsideCustomerRescheduleLockWindow(existingSlot, now)
    || isInsideCustomerRescheduleLockWindow(preferredSlot, now)) {
    return "one-day-lock";
  }
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
  { ok: true } | { ok: false; reason: "not-owner" | "invalid-status" | "not-future" | "one-day-lock" } {
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

export function slotOccupancyDocId(date: string, time: string): string {
  return `${date}_${time}`;
}

/** 15-minute blocks plus legacy 30-minute floors. Same helper used by occupancy writes. */
export function getSlotBlocks(startTime: string, durationMinutes: number): string[] {
  const [hours, minutes] = startTime.split(":").map(Number);
  const startTotal = hours * 60 + minutes;
  const numBlocks = Math.ceil(durationMinutes / 15);
  const blocks = new Set<string>();

  for (let index = 0; index < numBlocks; index += 1) {
    const total = startTotal + index * 15;
    const legacyTotal = Math.floor(total / 30) * 30;
    [total, legacyTotal].forEach((blockTotal) => {
      blocks.add(`${String(Math.floor(blockTotal / 60)).padStart(2, "0")}:${String(blockTotal % 60).padStart(2, "0")}`);
    });
  }

  return Array.from(blocks);
}

export function isSlotAtCapacity(currentCount: number, maxCapacity: number): boolean {
  return currentCount >= maxCapacity;
}

export function isRescheduleCapacityAvailable(currentCount: number, includesOwnApprovedOccupancy: boolean, maxCapacity: number): boolean {
  return !isSlotAtCapacity(
    Math.max(0, currentCount - (includesOwnApprovedOccupancy ? 1 : 0)),
    maxCapacity,
  );
}

export function shouldReconcileAppointmentTransition(expectedStatus: string, currentStatus: string): boolean {
  return expectedStatus === currentStatus;
}
