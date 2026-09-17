import {
  getAppointmentEffectiveSlot,
  getBonoTotalMinutes,
  getMadridDateKey,
  getSlotBlocks,
  madridCivilSlotToInstant,
  slotOccupancyDocId,
} from "./appointmentLifecycle.js";
import { classifyMadridCivilSlot } from "./appointmentLifecycle.js";

export interface ReplacementSlot {
  date: string;
  time: string;
}

export interface ReplacementAppointmentData {
  userId: string;
  status: string;
  duration: string | number;
  recurrenceSeriesId?: string;
  recurrenceIndex?: number;
  approvedSlot?: ReplacementSlot;
  preferredSlots?: ReplacementSlot[];
  date?: string;
  time?: string;
  bonoId?: string;
  minutesDeducted?: boolean;
  minutesDeductedAmount?: number;
  minutesDeductedAt?: string;
  minutesRefunded?: boolean;
  minutesRefundedAt?: string | null;
}

export interface ReplacementBonoData {
  id?: string;
  estado: string;
  tamano?: number;
  minutosTotales?: number;
  minutosRestantes?: number;
  sesionesTotales?: number;
  sesionesRestantes?: number;
  modalidad?: string;
  fechaExpiracion?: string;
  historial?: unknown;
}

export interface ActiveSeriesMetadata {
  occurrenceCount: number;
  totalMinutes: number;
  futureOccurrenceCount: number;
  futureStartDate?: string;
  futureStartTime?: string;
  futureEndDate?: string;
}

export function isActiveOccurrenceStatus(status: unknown): boolean {
  return status === "pending" || status === "approved";
}

export function isValidScheduleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function isValidScheduleTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isReplacementSlot(value: unknown): value is ReplacementSlot {
  return typeof value === "object"
    && value !== null
    && typeof (value as ReplacementSlot).date === "string"
    && typeof (value as ReplacementSlot).time === "string"
    && isValidScheduleDate((value as ReplacementSlot).date)
    && isValidScheduleTime((value as ReplacementSlot).time);
}

export function replacementDurationMinutes(data: Pick<ReplacementAppointmentData, "duration">): 30 | 45 | 60 | undefined {
  const duration = Number(data.duration);
  return duration === 30 || duration === 45 || duration === 60 ? duration : undefined;
}

export function replacementOccupancyKeys(slot: ReplacementSlot, duration: number): string[] {
  return getSlotBlocks(slot.time, duration).map((time) => slotOccupancyDocId(slot.date, time));
}

export function validReplacementSlot(data: ReplacementAppointmentData): ReplacementSlot | undefined {
  const slot = getAppointmentEffectiveSlot(data);
  return slot && isReplacementSlot(slot) ? slot : undefined;
}

export function safeReplacementCivilDate(data: ReplacementAppointmentData): string | undefined {
  const candidates = [data.approvedSlot?.date, data.preferredSlots?.[0]?.date, data.date];
  return candidates.find((value): value is string => typeof value === "string" && isValidScheduleDate(value));
}

export function isHistoricalReplacementOccurrence(data: ReplacementAppointmentData, now: Date): boolean {
  const slot = validReplacementSlot(data);
  if (slot) return !classifyMadridCivilSlot(slot, now).isFuture;
  const date = safeReplacementCivilDate(data);
  return Boolean(date && date < getMadridDateKey(now));
}

export function firstReplacementIntersection(left: string[], right: Set<string>): string | undefined {
  return left.find((key) => right.has(key));
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function hasValidReservedBonoData(bono: ReplacementBonoData): boolean {
  if (!["activo", "agotado", "expirado", "eliminado"].includes(bono.estado)) return false;
  const totalFields = [bono.tamano, bono.minutosTotales, bono.sesionesTotales]
    .filter((value) => value !== undefined);
  const remainingFields = [bono.minutosRestantes, bono.sesionesRestantes]
    .filter((value) => value !== undefined);
  if (totalFields.length === 0 || !totalFields.every(isNonNegativeInteger)) return false;
  if (!remainingFields.every(isNonNegativeInteger)) return false;
  if (bono.fechaExpiracion !== undefined
    && (typeof bono.fechaExpiracion !== "string" || Number.isNaN(new Date(bono.fechaExpiracion).getTime()))) {
    return false;
  }
  return true;
}

export function getUsableBonoRemainingMinutes(bono: ReplacementBonoData): number | undefined {
  const totalMinutes = getBonoTotalMinutes(bono as Parameters<typeof getBonoTotalMinutes>[0]);
  if (!isNonNegativeInteger(totalMinutes)) return undefined;
  if (bono.minutosRestantes !== undefined) {
    return isNonNegativeInteger(bono.minutosRestantes) && bono.minutosRestantes <= totalMinutes
      ? bono.minutosRestantes
      : undefined;
  }
  if (bono.sesionesRestantes !== undefined) {
    if (!isNonNegativeInteger(bono.sesionesRestantes)) return undefined;
    const minutesPerSession = bono.modalidad === "30min" ? 30 : 60;
    const remainingMinutes = bono.sesionesRestantes * minutesPerSession;
    return isNonNegativeInteger(remainingMinutes) && remainingMinutes <= totalMinutes
      ? remainingMinutes
      : undefined;
  }
  return undefined;
}

export function hasValidFutureReservation(
  appointment: ReplacementAppointmentData,
  seriesBonoId: string,
  duration: number,
): boolean {
  return appointment.bonoId === seriesBonoId
    && appointment.minutesDeducted === true
    && appointment.minutesDeductedAmount === duration
    && typeof appointment.minutesDeductedAt === "string"
    && appointment.minutesDeductedAt.length > 0
    && appointment.minutesRefunded !== true
    && !appointment.minutesRefundedAt;
}

export function replacementHistoryEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

export function copyDefinedFields(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) copy[field] = source[field];
  });
  return copy;
}

export function calculateActiveSeriesMetadata(
  occurrences: Array<{ data: ReplacementAppointmentData; slotOverride?: ReplacementSlot; statusOverride?: string }>,
  now: Date,
): ActiveSeriesMetadata | undefined {
  const active = occurrences.filter((item) => isActiveOccurrenceStatus(item.statusOverride ?? item.data.status));
  let totalMinutes = 0;
  const futureSlots: ReplacementSlot[] = [];
  for (const item of active) {
    const duration = replacementDurationMinutes(item.data);
    if (!duration) return undefined;
    totalMinutes += duration;
    const slot = item.slotOverride ?? validReplacementSlot(item.data);
    const instant = slot ? madridCivilSlotToInstant(slot) : undefined;
    if (slot && instant && instant > now) futureSlots.push(slot);
  }
  futureSlots.sort((left, right) => `${left.date}_${left.time}`.localeCompare(`${right.date}_${right.time}`));
  return {
    occurrenceCount: active.length,
    totalMinutes,
    futureOccurrenceCount: futureSlots.length,
    ...(futureSlots[0] ? {
      futureStartDate: futureSlots[0].date,
      futureStartTime: futureSlots[0].time,
      futureEndDate: futureSlots.at(-1)?.date,
    } : {}),
  };
}

export function planReplacementGroups<T>(managed: T[], desiredCount: number): {
  reused: T[];
  cancelled: T[];
  createdCount: number;
} {
  return {
    reused: managed.slice(0, desiredCount),
    cancelled: managed.slice(desiredCount),
    createdCount: Math.max(0, desiredCount - managed.length),
  };
}
