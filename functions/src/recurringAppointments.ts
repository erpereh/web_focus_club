import {
  calculateAppointmentDeduction,
  calculateAppointmentRefund,
  getBonoRemainingMinutes,
  getSlotBlocks,
  isBonoExpiredAt,
  isSlotAtCapacity,
  selectExactlyOneActiveBono,
  slotOccupancyDocId,
  type LifecycleAppointment,
  type LifecycleBono,
} from "./appointmentLifecycle.js";
import { doesSessionFitWithinSchedule, generateTimeSlots, normalizeSiteConfig, type SiteConfig } from "./siteConfig.js";

/**
 * Firestore transactions are treated as having a 500-write maximum.
 * Honor this even if some docs mention the limit was relaxed.
 */
export const FIRESTORE_TRANSACTION_MAX_WRITES = 500;
export const MAX_RECURRING_OCCURRENCES = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export type RecurringDurationMinutes = 30 | 45 | 60;

export interface ParsedRecurringAppointmentsData {
  userId?: string;
  startDate: string;
  startTime: string;
  endDate: string;
  intervalDays: number;
  duration: "30" | "45" | "60";
  durationMinutes: RecurringDurationMinutes;
  serviceType: string;
  assignedTrainer: string;
  comment: string;
}

export interface RecurringOccupancyWrite {
  date: string;
  time: string;
}

export interface RecurringBonoWrite {
  bonoId: string;
  minutosRestantes: number;
  estado: LifecycleBono["estado"];
  minutesDeductedAmount: number;
}

export interface RecurringSeriesWritePlan {
  dates: string[];
  occurrenceCount: number;
  totalMinutes: number;
  occupancyWrites: RecurringOccupancyWrite[];
  bono: RecurringBonoWrite;
  minutesDeductedAmount: number;
}

export type RecurringSeriesPlanResult =
  | { ok: true; writes: RecurringSeriesWritePlan }
  | { ok: false; message: string; writes: [] };

export interface PlanRecurringAppointmentsInput {
  startDate: string;
  startTime: string;
  endDate: string;
  intervalDays: number;
  durationMinutes: number;
  now: Date;
  siteConfig: Partial<SiteConfig>;
  occupancyByKey: Map<string, number>;
  blockedKeys: Set<string>;
  userSlotKeys: Set<string>;
  activeBonos: LifecycleBono[];
  requireBono?: boolean;
}

export interface RecurringEndDateOption {
  endDate: string;
  occurrenceCount: number;
  totalMinutes: number;
}

export interface ReservedOccurrenceMinutes {
  bonoId?: string;
  minutesDeducted?: boolean;
  minutesDeductedAmount?: number;
  minutesRefunded?: boolean;
  minutesRefundedAt?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function addUtcDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatDateEs(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function civilDateFromExpiration(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (isIsoDate(value)) return value;
  const expiration = new Date(value);
  if (Number.isNaN(expiration.getTime())) return undefined;
  const utc = new Date(Date.UTC(expiration.getFullYear(), expiration.getMonth(), expiration.getDate()));
  return utc.toISOString().slice(0, 10);
}

export function generateRecurringOccurrenceDates(
  startDate: string,
  intervalDays: number,
  endDate: string,
): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  if (!Number.isInteger(intervalDays) || intervalDays < 1) return [];
  if (endDate < startDate) return [];

  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addUtcDays(current, intervalDays);
  }
  return dates;
}

export function getRecurringEndDateOptions(input: {
  startDate: string;
  intervalDays: number;
  durationMinutes: number;
  remainingMinutes: number;
  bonoExpirationDate?: string | null;
  maxOccurrences?: number;
}): RecurringEndDateOption[] {
  if (!isIsoDate(input.startDate)) return [];
  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1) return [];
  if (![30, 45, 60].includes(input.durationMinutes) || input.durationMinutes <= 0) return [];

  const maxByMinutes = Math.floor(Math.max(0, input.remainingMinutes) / input.durationMinutes);
  const maxOccurrences = Math.min(
    input.maxOccurrences ?? MAX_RECURRING_OCCURRENCES,
    MAX_RECURRING_OCCURRENCES,
    maxByMinutes,
  );
  if (maxOccurrences < 2) return [];

  const expirationDate = input.bonoExpirationDate ? civilDateFromExpiration(input.bonoExpirationDate) : undefined;
  const options: RecurringEndDateOption[] = [];
  let current = input.startDate;
  for (let index = 0; index < maxOccurrences; index += 1) {
    if (expirationDate && current > expirationDate) break;
    if (index >= 1) {
      options.push({
        endDate: current,
        occurrenceCount: index + 1,
        totalMinutes: (index + 1) * input.durationMinutes,
      });
    }
    current = addUtcDays(current, input.intervalDays);
  }
  return options;
}

export function collectRecurringOccupancyKeys(
  dates: string[],
  startTime: string,
  durationMinutes: number,
): string[] {
  const blocks = getSlotBlocks(startTime, durationMinutes);
  return dates.flatMap((date) => blocks.map((time) => slotOccupancyDocId(date, time)));
}

/**
 * Writes per series: N appointments + occupancy docs + 1 series + 1 bono + 1 activity log.
 * Worst case 60 min = 4 occupancy docs per occurrence → 5N + 3.
 * MAX_RECURRING_OCCURRENCES = 20 → 103 writes, under FIRESTORE_TRANSACTION_MAX_WRITES (500).
 */
export function estimateRecurringSeriesWrites(occurrenceCount: number, occupancyDocCount: number): number {
  return occurrenceCount + occupancyDocCount + 3;
}

function slotDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function normalizeText(value: unknown, fieldName: string, maxLength: number, required = true):
  { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    if (!required && value === undefined) return { ok: true, value: "" };
    return { ok: false, message: `El campo ${fieldName} no es valido.` };
  }
  const text = value.trim();
  if (required && !text) return { ok: false, message: `El campo ${fieldName} es obligatorio.` };
  if (text.length > maxLength) return { ok: false, message: `El campo ${fieldName} es demasiado largo.` };
  return { ok: true, value: text };
}

function parseRecurringCore(data: Record<string, unknown>, requireTrainer: boolean):
  { ok: true; value: ParsedRecurringAppointmentsData } | { ok: false; message: string } {
  const startDate = normalizeText(data.date, "fecha inicial", 10);
  if (!startDate.ok) return startDate;
  const startTime = normalizeText(data.time, "hora", 5);
  if (!startTime.ok) return startTime;
  const endDate = normalizeText(data.endDate, "fecha final", 10);
  if (!endDate.ok) return endDate;
  const serviceType = normalizeText(data.serviceType, "servicio", 180, false);
  if (!serviceType.ok) return serviceType;
  const assignedTrainer = normalizeText(data.assignedTrainer, "entrenador", 128, requireTrainer);
  if (!assignedTrainer.ok) return assignedTrainer;
  const comment = normalizeText(data.comment, "comentario", 1000, false);
  if (!comment.ok) return comment;

  if (!isIsoDate(startDate.value) || !TIME_RE.test(startTime.value) || !isIsoDate(endDate.value)) {
    return { ok: false, message: "La fecha u hora no tiene un formato valido." };
  }

  const durationMinutes = Number(data.durationMinutes ?? data.duration);
  if (![30, 45, 60].includes(durationMinutes)) {
    return { ok: false, message: "La duracion de la cita no es valida." };
  }

  const intervalDays = Number(data.intervalDays);
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    return { ok: false, message: "El intervalo de dias debe ser un entero mayor o igual a 1." };
  }

  if (endDate.value < startDate.value) {
    return { ok: false, message: "La fecha final no puede ser anterior a la fecha inicial." };
  }

  return {
    ok: true,
    value: {
      startDate: startDate.value,
      startTime: startTime.value,
      endDate: endDate.value,
      intervalDays,
      duration: String(durationMinutes) as "30" | "45" | "60",
      durationMinutes: durationMinutes as RecurringDurationMinutes,
      serviceType: serviceType.value,
      assignedTrainer: assignedTrainer.value,
      comment: comment.value,
    },
  };
}

export function parseRecurringAppointmentsData(data: unknown):
  { ok: true; value: ParsedRecurringAppointmentsData } | { ok: false; message: string } {
  if (!isRecord(data)) {
    return { ok: false, message: "Los datos de la serie no son validos." };
  }
  const userId = normalizeText(data.userId, "cliente", 128);
  if (!userId.ok) return userId;
  const parsed = parseRecurringCore(data, true);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, userId: userId.value } };
}

export function parseClientRecurringAppointmentsData(data: unknown):
  { ok: true; value: ParsedRecurringAppointmentsData } | { ok: false; message: string } {
  if (!isRecord(data)) {
    return { ok: false, message: "Los datos de la serie no son validos." };
  }
  return parseRecurringCore(data, false);
}

export function planRecurringAppointments(input: PlanRecurringAppointmentsInput): RecurringSeriesPlanResult {
  const emptyFail = (message: string): RecurringSeriesPlanResult => ({ ok: false, message, writes: [] });

  if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1) {
    return emptyFail("El intervalo de dias debe ser un entero mayor o igual a 1.");
  }
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate) || !TIME_RE.test(input.startTime)) {
    return emptyFail("La fecha u hora no tiene un formato valido.");
  }
  if (input.endDate < input.startDate) {
    return emptyFail("La fecha final no puede ser anterior a la fecha inicial.");
  }
  if (![30, 45, 60].includes(input.durationMinutes)) {
    return emptyFail("La duracion de la cita no es valida.");
  }

  const dates = generateRecurringOccurrenceDates(input.startDate, input.intervalDays, input.endDate);
  if (dates.length === 0) {
    return emptyFail("La serie debe incluir al menos una sesion.");
  }
  if (dates.length < 2) {
    return emptyFail("Un entrenamiento recurrente requiere al menos 2 sesiones.");
  }
  if (dates.length > MAX_RECURRING_OCCURRENCES) {
    return emptyFail(`La serie no puede superar ${MAX_RECURRING_OCCURRENCES} sesiones.`);
  }

  const config = normalizeSiteConfig(input.siteConfig);
  const validTimes = new Set(generateTimeSlots(config));
  const slotBlocks = getSlotBlocks(input.startTime, input.durationMinutes);
  const occupancyByKey = new Map(input.occupancyByKey);
  const userSlotKeys = new Set(input.userSlotKeys);

  for (const date of dates) {
    const slotTime = slotDateTime(date, input.startTime);
    if (Number.isNaN(slotTime.getTime()) || slotTime <= input.now) {
      return emptyFail(`La franja del ${formatDateEs(date)} a las ${input.startTime} ya no esta disponible.`);
    }

    if (!validTimes.has(input.startTime) || !doesSessionFitWithinSchedule(config, input.startTime, input.durationMinutes)) {
      return emptyFail(`La franja del ${formatDateEs(date)} no es valida para el horario configurado.`);
    }

    const occurrenceKeys = slotBlocks.map((time) => slotOccupancyDocId(date, time));
    if (occurrenceKeys.some((key) => input.blockedKeys.has(key))) {
      return emptyFail(`La franja del ${formatDateEs(date)} esta bloqueada.`);
    }

    if (occurrenceKeys.some((key) => isSlotAtCapacity(occupancyByKey.get(key) ?? 0, config.maxCapacity))) {
      return emptyFail(`La franja del ${formatDateEs(date)} a las ${input.startTime} esta completa.`);
    }

    if (occurrenceKeys.some((key) => userSlotKeys.has(key))) {
      return emptyFail(`El cliente ya tiene una cita que se solapa el ${formatDateEs(date)}.`);
    }

    occurrenceKeys.forEach((key) => {
      occupancyByKey.set(key, (occupancyByKey.get(key) ?? 0) + 1);
      userSlotKeys.add(key);
    });
  }

  const occupancyWrites: RecurringOccupancyWrite[] = dates.flatMap((date) => (
    slotBlocks.map((time) => ({ date, time }))
  ));
  const writeCount = estimateRecurringSeriesWrites(dates.length, occupancyWrites.length);
  if (writeCount > FIRESTORE_TRANSACTION_MAX_WRITES) {
    return emptyFail("La serie es demasiado larga para crearse de forma atomica.");
  }

  const requireBono = input.requireBono !== false;
  if (!requireBono) {
    return {
      ok: true,
      writes: {
        dates,
        occurrenceCount: dates.length,
        totalMinutes: dates.length * input.durationMinutes,
        occupancyWrites,
        bono: {
          bonoId: "",
          minutosRestantes: 0,
          estado: "activo",
          minutesDeductedAmount: input.durationMinutes,
        },
        minutesDeductedAmount: input.durationMinutes,
      },
    };
  }

  if (input.activeBonos.length === 0) {
    return emptyFail("El cliente no tiene un bono activo. No se puede crear la serie.");
  }
  const selectedBono = selectExactlyOneActiveBono(input.activeBonos);
  if (!selectedBono) {
    return emptyFail("Hay mas de un bono activo y no se puede elegir uno automaticamente. Deja un unico bono activo antes de crear la serie.");
  }

  if (isBonoExpiredAt(selectedBono, input.now)) {
    return emptyFail("El bono caduca antes de finalizar la serie.");
  }

  const expirationDate = civilDateFromExpiration(selectedBono.fechaExpiracion);
  if (expirationDate && dates.some((date) => date > expirationDate)) {
    return emptyFail("El bono caduca antes de finalizar la serie.");
  }

  const totalMinutes = dates.length * input.durationMinutes;
  const remainingMinutes = getBonoRemainingMinutes(selectedBono);
  if (remainingMinutes < totalMinutes) {
    return emptyFail(
      `No hay suficientes minutos en el bono. La serie requiere ${totalMinutes} min y quedan ${remainingMinutes} min.`,
    );
  }

  const deduction = calculateAppointmentDeduction(selectedBono, totalMinutes, input.now.toISOString());
  if (!deduction.ok) {
    return emptyFail(
      deduction.reason === "insufficient-minutes"
        ? `No hay suficientes minutos en el bono. La serie requiere ${totalMinutes} min y quedan ${remainingMinutes} min.`
        : "El bono caduca antes de finalizar la serie.",
    );
  }

  return {
    ok: true,
    writes: {
      dates,
      occurrenceCount: dates.length,
      totalMinutes,
      occupancyWrites,
      bono: {
        bonoId: selectedBono.id,
        minutosRestantes: deduction.remainingMinutes,
        estado: deduction.bonoStatus,
        minutesDeductedAmount: input.durationMinutes,
      },
      minutesDeductedAmount: input.durationMinutes,
    },
  };
}

export function validateReservedSeriesMinutes(input: {
  seriesBonoId: string;
  seriesUserId: string;
  seriesTotalMinutes: number;
  durationMinutes: number;
  bono?: LifecycleBono & { userId?: string };
  occurrences: ReservedOccurrenceMinutes[];
}): { ok: true } | { ok: false; message: string } {
  if (!input.seriesBonoId) {
    return { ok: false, message: "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto." };
  }
  if (!input.bono) {
    return { ok: false, message: "No se ha encontrado el bono reservado de la serie." };
  }
  if (input.bono.userId && input.bono.userId !== input.seriesUserId) {
    return { ok: false, message: "El bono original no pertenece al usuario de esta serie." };
  }
  if (input.occurrences.length === 0) {
    return { ok: false, message: "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto." };
  }

  let deductedTotal = 0;
  for (const occurrence of input.occurrences) {
    if (occurrence.bonoId !== input.seriesBonoId
      || occurrence.minutesDeducted !== true
      || occurrence.minutesDeductedAmount !== input.durationMinutes
      || occurrence.minutesRefunded === true
      || occurrence.minutesRefundedAt) {
      return { ok: false, message: "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto." };
    }
    deductedTotal += occurrence.minutesDeductedAmount ?? 0;
  }

  if (deductedTotal !== input.seriesTotalMinutes) {
    return { ok: false, message: "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto." };
  }
  return { ok: true };
}

export function planSeriesMinutesRefund(input: {
  bono: LifecycleBono;
  occurrences: LifecycleAppointment[];
  now: string;
}): { ok: true; bono: { minutosRestantes: number; estado: LifecycleBono["estado"] }; appointmentPatches: Record<string, unknown>[] }
  | { ok: false; message: string } {
  let bono = { ...input.bono };
  const appointmentPatches: Record<string, unknown>[] = [];
  for (const occurrence of input.occurrences) {
    const refund = calculateAppointmentRefund(bono, occurrence, input.now);
    if (!refund.ok) {
      return { ok: false, message: "Las citas de esta serie han cambiado y no pueden aprobarse como conjunto." };
    }
    bono = {
      ...bono,
      minutosRestantes: refund.remainingMinutes,
      estado: refund.bonoStatus,
    };
    appointmentPatches.push({
      minutesRefunded: refund.minutesRefunded,
      minutesRefundedAmount: refund.minutesRefundedAmount,
      minutesRefundedAt: refund.minutesRefundedAt,
      minutesRefundReason: null,
    });
  }
  return {
    ok: true,
    bono: { minutosRestantes: bono.minutosRestantes ?? 0, estado: bono.estado },
    appointmentPatches,
  };
}

export function isRecurringBulkManagedTransition(
  before: { status?: string; recurrenceSeriesId?: string },
  after: { status?: string; recurrenceSeriesId?: string },
): "approve" | "reject" | "cancel-pending" | undefined {
  const seriesId = after.recurrenceSeriesId || before.recurrenceSeriesId;
  if (!seriesId) return undefined;
  if (before.status === "pending" && after.status === "approved") return "approve";
  if (before.status === "pending" && after.status === "rejected") return "reject";
  if (before.status === "pending" && after.status === "cancelled") return "cancel-pending";
  return undefined;
}

export function shouldSkipRecurringFinanceReconciliation(
  before: { status?: string; recurrenceSeriesId?: string },
  after: { status?: string; recurrenceSeriesId?: string },
): boolean {
  return Boolean(isRecurringBulkManagedTransition(before, after));
}

export function shouldSkipRecurringStatusNotification(appointment: {
  status?: string;
  recurrenceSeriesId?: string;
}, after?: { status?: string; recurrenceSeriesId?: string }): boolean {
  if (!after) return Boolean(appointment.recurrenceSeriesId);
  return Boolean(isRecurringBulkManagedTransition(appointment, after));
}
