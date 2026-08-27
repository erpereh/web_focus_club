import {
  calculateAppointmentDeduction,
  getBonoRemainingMinutes,
  getSlotBlocks,
  isBonoExpiredAt,
  isSlotAtCapacity,
  selectExactlyOneActiveBono,
  slotOccupancyDocId,
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
  userId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  intervalWeeks: number;
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
  intervalWeeks: number;
  durationMinutes: number;
  now: Date;
  siteConfig: Partial<SiteConfig>;
  occupancyByKey: Map<string, number>;
  blockedKeys: Set<string>;
  userSlotKeys: Set<string>;
  activeBonos: LifecycleBono[];
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

export function generateWeeklyOccurrenceDates(
  startDate: string,
  intervalWeeks: number,
  endDate: string,
): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1) return [];
  if (endDate < startDate) return [];

  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addUtcDays(current, intervalWeeks * 7);
  }
  return dates;
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

function bonoExpirationDate(bono: LifecycleBono): string | undefined {
  if (!bono.fechaExpiracion) return undefined;
  const expiration = new Date(bono.fechaExpiracion);
  if (Number.isNaN(expiration.getTime())) return undefined;
  const localYear = expiration.getFullYear();
  const localMonth = expiration.getMonth();
  const localDay = expiration.getDate();
  const utc = new Date(Date.UTC(localYear, localMonth, localDay));
  return utc.toISOString().slice(0, 10);
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

export function parseRecurringAppointmentsData(data: unknown):
  { ok: true; value: ParsedRecurringAppointmentsData } | { ok: false; message: string } {
  if (!isRecord(data)) {
    return { ok: false, message: "Los datos de la serie no son validos." };
  }

  const userId = normalizeText(data.userId, "cliente", 128);
  if (!userId.ok) return userId;
  const startDate = normalizeText(data.date, "fecha inicial", 10);
  if (!startDate.ok) return startDate;
  const startTime = normalizeText(data.time, "hora", 5);
  if (!startTime.ok) return startTime;
  const endDate = normalizeText(data.endDate, "fecha final", 10);
  if (!endDate.ok) return endDate;
  const serviceType = normalizeText(data.serviceType, "servicio", 180);
  if (!serviceType.ok) return serviceType;
  const assignedTrainer = normalizeText(data.assignedTrainer, "entrenador", 128);
  if (!assignedTrainer.ok) return assignedTrainer;
  const comment = normalizeText(data.comment, "comentario", 1000, false);
  if (!comment.ok) return comment;

  if (!isIsoDate(startDate.value) || !TIME_RE.test(startTime.value) || !isIsoDate(endDate.value)) {
    return { ok: false, message: "La fecha u hora no tiene un formato valido." };
  }

  const durationMinutes = Number(data.durationMinutes);
  if (![30, 45, 60].includes(durationMinutes)) {
    return { ok: false, message: "La duracion de la cita no es valida." };
  }

  const intervalWeeks = Number(data.intervalWeeks);
  if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1) {
    return { ok: false, message: "El intervalo de semanas debe ser un entero mayor o igual a 1." };
  }

  if (endDate.value < startDate.value) {
    return { ok: false, message: "La fecha final no puede ser anterior a la fecha inicial." };
  }

  return {
    ok: true,
    value: {
      userId: userId.value,
      startDate: startDate.value,
      startTime: startTime.value,
      endDate: endDate.value,
      intervalWeeks,
      duration: String(durationMinutes) as "30" | "45" | "60",
      durationMinutes: durationMinutes as RecurringDurationMinutes,
      serviceType: serviceType.value,
      assignedTrainer: assignedTrainer.value,
      comment: comment.value,
    },
  };
}

export function planRecurringAppointments(input: PlanRecurringAppointmentsInput): RecurringSeriesPlanResult {
  const emptyFail = (message: string): RecurringSeriesPlanResult => ({ ok: false, message, writes: [] });

  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1) {
    return emptyFail("El intervalo de semanas debe ser un entero mayor o igual a 1.");
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

  const dates = generateWeeklyOccurrenceDates(input.startDate, input.intervalWeeks, input.endDate);
  if (dates.length === 0) {
    return emptyFail("La serie debe incluir al menos una sesion.");
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

  const expirationDate = bonoExpirationDate(selectedBono);
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
