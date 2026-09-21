import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  calculateAppointmentDeduction,
  calculateAppointmentRefund,
  classifyMadridCivilSlot,
  getBonoTotalMinutes,
  getAppointmentEffectiveSlot,
  getMadridDateKey,
  getCanonicalSlotBlocks,
  isBonoExpiredAt,
  isInsideCustomerRescheduleLockWindow,
  isSameDayInMadrid,
  madridCivilSlotToInstant,
  slotOccupancyDocId,
} from "./appointmentLifecycle.js";
import {
  addUtcDays,
  civilDateFromExpiration,
  generateRecurringOccurrenceDates,
  MAX_RECURRING_OCCURRENCES,
} from "./recurringAppointments.js";
import {
  calculateActiveSeriesMetadata,
  copyDefinedFields,
  firstReplacementIntersection,
  getUsableBonoRemainingMinutes,
  hasValidFutureReservation,
  hasValidReservedBonoData,
  isActiveOccurrenceStatus,
  isHistoricalReplacementOccurrence,
  isNonNegativeInteger,
  planReplacementGroups,
  replacementDurationMinutes,
  replacementHistoryEntries,
  safeReplacementCivilDate,
  validReplacementSlot,
  type ReplacementAppointmentData,
  type ReplacementBonoData,
} from "./recurringScheduleReplacement.js";
import {
  doesSessionFitWithinSchedule,
  generateTimeSlots,
  normalizeSiteConfig,
  type SiteConfig,
} from "./siteConfig.js";

export type RecurringRescheduleScope = "single" | "series" | "following";
export type RecurringRescheduleActorType = "admin" | "customer";
export type RecurringRescheduleReason =
  | "one_day_change_not_allowed"
  | "same_day_change_not_allowed"
  | "slot_blocked"
  | "slot_full"
  | "appointment_conflict"
  | "outside_schedule"
  | "slot_not_future"
  | "invalid_occupancy"
  | "recurring_occurrence_unavailable";

export interface RecurringRescheduleSlot {
  date: string;
  time: string;
}

export interface RecurringRescheduleRequest {
  appointmentId: string;
  preferredSlot: RecurringRescheduleSlot;
  scope: RecurringRescheduleScope;
}

export interface ReplaceOwnRecurringSeriesScheduleRequest {
  appointmentId: string;
  startSlot: RecurringRescheduleSlot;
  intervalDays: number;
  endDate: string;
}

export interface RecurringAppointmentData {
  userId: string;
  status: string;
  duration: string;
  recurrenceSeriesId?: string;
  recurrenceIndex?: number;
  approvedSlot?: RecurringRescheduleSlot;
  preferredSlots?: RecurringRescheduleSlot[];
  date?: string;
  time?: string;
  [key: string]: unknown;
}

export interface RecurringAppointmentRecord {
  id: string;
  data: RecurringAppointmentData;
}

export interface RecurringSeriesData {
  id: string;
  userId: string;
  status: string;
  intervalDays: number;
  endDate: string;
  duration?: string | number;
  bonoId?: string;
  serviceType?: string;
  startDate?: string;
  startTime?: string;
  assignedTrainer?: string | null;
  occurrenceCount?: number;
  totalMinutes?: number;
  [key: string]: unknown;
}

export interface RecurringRescheduleError {
  reason: RecurringRescheduleReason;
  message: string;
  scope: RecurringRescheduleScope;
  problematicSlot?: RecurringRescheduleSlot;
  problematicAppointmentId?: string;
}

export interface AffectedRecurringAppointment {
  appointment: RecurringAppointmentRecord;
  oldSlot: RecurringRescheduleSlot;
  newSlot: RecurringRescheduleSlot;
  oldKeys: string[];
  newKeys: string[];
}

export interface RecurringRescheduleDraft {
  scope: RecurringRescheduleScope;
  selectedAppointmentId: string;
  selectedIndex: number;
  oldAnchorSlot: RecurringRescheduleSlot;
  newAnchorSlot: RecurringRescheduleSlot;
  affected: AffectedRecurringAppointment[];
  occupancyKeys: string[];
  occupancyDelta: Map<string, number>;
  targetDates: string[];
  seriesEndDate: string;
}

export interface RecurringOccupancyWrite {
  key: string;
  date: string;
  time: string;
  delta: number;
  finalCount: number;
}

export interface RecurringReschedulePlan {
  occupancyWrites: RecurringOccupancyWrite[];
}

type DraftResult = { ok: true; draft: RecurringRescheduleDraft } | { ok: false; error: RecurringRescheduleError };
type AvailabilityResult = { ok: true; plan: RecurringReschedulePlan } | { ok: false; error: RecurringRescheduleError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isValidTimeKey(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isSlot(value: unknown): value is RecurringRescheduleSlot {
  return isRecord(value)
    && typeof value.date === "string"
    && typeof value.time === "string"
    && isValidDateKey(value.date)
    && isValidTimeKey(value.time);
}

export function parseRecurringRescheduleRequest(value: unknown): RecurringRescheduleRequest | undefined {
  if (!isRecord(value) || typeof value.appointmentId !== "string") return undefined;
  const appointmentId = value.appointmentId.trim();
  if (!appointmentId || appointmentId.length > 256 || !isSlot(value.preferredSlot)) return undefined;
  if (value.scope !== "single" && value.scope !== "series" && value.scope !== "following") return undefined;
  return { appointmentId, preferredSlot: value.preferredSlot, scope: value.scope };
}

export function parseReplaceOwnRecurringSeriesScheduleRequest(
  value: unknown,
): ReplaceOwnRecurringSeriesScheduleRequest | undefined {
  if (!isRecord(value)
    || typeof value.appointmentId !== "string"
    || !isSlot(value.startSlot)
    || typeof value.endDate !== "string"
    || !isValidDateKey(value.endDate)
    || typeof value.intervalDays !== "number"
    || !Number.isInteger(value.intervalDays)
    || value.intervalDays < 1) {
    return undefined;
  }
  const appointmentId = value.appointmentId.trim();
  return appointmentId && appointmentId.length <= 256
    ? { appointmentId, startSlot: value.startSlot, intervalDays: value.intervalDays, endDate: value.endDate }
    : undefined;
}

function planError(
  scope: RecurringRescheduleScope,
  reason: RecurringRescheduleReason,
  message: string,
  problematicSlot?: RecurringRescheduleSlot,
  problematicAppointmentId?: string,
): { ok: false; error: RecurringRescheduleError } {
  return {
    ok: false,
    error: {
      scope,
      reason,
      message,
      ...(problematicSlot ? { problematicSlot } : {}),
      ...(problematicAppointmentId ? { problematicAppointmentId } : {}),
    },
  };
}

function durationMinutes(appointment: RecurringAppointmentData): number {
  const duration = Number(appointment.duration);
  return [30, 45, 60].includes(duration) ? duration : 0;
}

function effectiveSlot(appointment: RecurringAppointmentData): RecurringRescheduleSlot | undefined {
  const slot = getAppointmentEffectiveSlot(appointment);
  return slot && isSlot(slot) ? slot : undefined;
}

function effectiveCivilDateKey(appointment: RecurringAppointmentData): string | undefined {
  const candidates = [
    appointment.approvedSlot?.date,
    appointment.preferredSlots?.[0]?.date,
    appointment.date,
  ];
  return candidates.find((date): date is string => typeof date === "string" && isValidDateKey(date));
}

function slotKeys(slot: RecurringRescheduleSlot, duration: number): string[] {
  return getCanonicalSlotBlocks(slot.time, duration).map((time) => slotOccupancyDocId(slot.date, time));
}

function firstIntersection(left: string[], right: Set<string>): string | undefined {
  return left.find((key) => right.has(key));
}

function displaySlot(slot: RecurringRescheduleSlot): string {
  const [year, month, day] = slot.date.split("-");
  return `${day}/${month}/${year} a las ${slot.time}`;
}

export function prepareRecurringReschedule(input: {
  selectedAppointmentId: string;
  preferredSlot: RecurringRescheduleSlot;
  scope: RecurringRescheduleScope;
  actorType: RecurringRescheduleActorType;
  actorUid: string;
  now: Date;
  series: RecurringSeriesData;
  occurrences: RecurringAppointmentRecord[];
}): DraftResult {
  const selected = input.occurrences.find((item) => item.id === input.selectedAppointmentId);
  if (!selected || selected.data.status !== "approved" || !selected.data.recurrenceSeriesId) {
    return planError(input.scope, "recurring_occurrence_unavailable", "La cita recurrente ya no se puede modificar.");
  }
  if (input.series.status !== "approved"
    || selected.data.recurrenceSeriesId !== input.series.id
    || selected.data.userId !== input.series.userId) {
    return planError(input.scope, "recurring_occurrence_unavailable", "La serie ya no se puede modificar.");
  }
  if (input.actorType === "customer" && selected.data.userId !== input.actorUid) {
    return planError(input.scope, "recurring_occurrence_unavailable", "No puedes modificar la cita de otro usuario.");
  }
  const selectedIndex = selected.data.recurrenceIndex;
  const selectedSlot = effectiveSlot(selected.data);
  const selectedDuration = durationMinutes(selected.data);
  if (!Number.isInteger(selectedIndex) || (selectedIndex ?? -1) < 0 || !selectedSlot || !selectedDuration) {
    return planError(input.scope, "recurring_occurrence_unavailable", "Los datos de la cita recurrente no son validos.");
  }
  const selectedState = classifyMadridCivilSlot(selectedSlot, input.now);
  if (input.actorType === "customer" && selectedState.isToday) {
    return planError(
      input.scope,
      "same_day_change_not_allowed",
      "Las citas no se pueden modificar ni cancelar el mismo dia.",
      selectedSlot,
      selected.id,
    );
  }
  if (!selectedState.isFuture) {
    return planError(input.scope, "slot_not_future", "Solo se pueden modificar citas que aun no hayan ocurrido.", selectedSlot, selected.id);
  }
  if (!Number.isInteger(input.series.intervalDays) || input.series.intervalDays <= 0) {
    return planError(input.scope, "recurring_occurrence_unavailable", "El intervalo de la serie no es valido.");
  }
  const anchorState = classifyMadridCivilSlot(input.preferredSlot, input.now);
  if (input.actorType === "customer" && isSameDayInMadrid(input.preferredSlot.date, input.now)) {
    return planError(
      input.scope,
      "same_day_change_not_allowed",
      "Las citas no se pueden modificar ni cancelar el mismo dia.",
      input.preferredSlot,
      selected.id,
    );
  }
  if (!anchorState.isValid || !anchorState.isFuture) {
    return planError(input.scope, "slot_not_future", "La nueva franja debe estar en el futuro.", input.preferredSlot, selected.id);
  }

  const ordered = [...input.occurrences].sort((left, right) =>
    (left.data.recurrenceIndex ?? Number.MAX_SAFE_INTEGER) - (right.data.recurrenceIndex ?? Number.MAX_SAFE_INTEGER));

  const seriesFutureApprovedIds = new Set<string>();
  if (input.scope === "series") {
    const today = getMadridDateKey(input.now);
    for (const item of ordered) {
      if (item.data.status !== "approved" || item.data.recurrenceSeriesId !== input.series.id) continue;
      const slot = effectiveSlot(item.data);
      if (!slot) {
        const date = effectiveCivilDateKey(item.data);
        if (date && date < today) continue;
        return planError(
          input.scope,
          "recurring_occurrence_unavailable",
          "Una cita aprobada de la serie no tiene una franja valida.",
          undefined,
          item.id,
        );
      }
      if (!classifyMadridCivilSlot(slot, input.now).isFuture) continue;
      if (item.data.userId !== input.series.userId) {
        return planError(
          input.scope,
          "recurring_occurrence_unavailable",
          "Una cita futura no coincide con los datos de la serie.",
          slot,
          item.id,
        );
      }
      const index = item.data.recurrenceIndex;
      if (!Number.isInteger(index) || (index as number) < 0 || !durationMinutes(item.data)) {
        return planError(
          input.scope,
          "recurring_occurrence_unavailable",
          "Una cita futura de la serie contiene datos no validos.",
          slot,
          item.id,
        );
      }
      seriesFutureApprovedIds.add(item.id);
    }
  }

  // Legacy deployment compatibility: old browser bundles still send "following".
  // Keep its selected-and-higher-index semantics until those clients are retired.
  if (input.scope === "following") {
    for (const item of ordered) {
      if (item.data.status !== "approved" || item.data.recurrenceSeriesId !== input.series.id) continue;
      const slot = effectiveSlot(item.data);
      if (!slot) {
        return planError(
          input.scope,
          "recurring_occurrence_unavailable",
          "Una cita aprobada de la serie no tiene una franja valida.",
          undefined,
          item.id,
        );
      }
      if (!classifyMadridCivilSlot(slot, input.now).isFuture) continue;
      const index = item.data.recurrenceIndex;
      if (!Number.isInteger(index) || (index as number) < 0) {
        return planError(
          input.scope,
          "recurring_occurrence_unavailable",
          "Una cita futura de la serie no tiene un indice de recurrencia valido.",
          slot,
          item.id,
        );
      }
    }
  }

  const seenIndexes = new Set<number>();
  for (const item of ordered) {
    const index = item.data.recurrenceIndex;
    if (Number.isInteger(index)) {
      if (seenIndexes.has(index as number)) {
        return planError(input.scope, "recurring_occurrence_unavailable", "La serie contiene indices de recurrencia duplicados.");
      }
      seenIndexes.add(index as number);
    }
  }

  const candidates: RecurringAppointmentRecord[] = [];
  for (const item of ordered) {
    const index = item.data.recurrenceIndex;
    if (input.scope === "single" && item.id !== selected.id) continue;
    if (input.scope === "following"
      && (!Number.isInteger(index) || (index as number) < (selectedIndex as number))) continue;
    if (input.scope === "series" && !seriesFutureApprovedIds.has(item.id)) continue;
    if (item.data.status !== "approved") continue;
    if (item.data.userId !== input.series.userId || item.data.recurrenceSeriesId !== input.series.id) {
      return planError(
        input.scope,
        "recurring_occurrence_unavailable",
        "Una cita futura no coincide con los datos de la serie.",
        undefined,
        item.id,
      );
    }
    const slot = effectiveSlot(item.data);
    if (!slot) {
      return planError(
        input.scope,
        "recurring_occurrence_unavailable",
        "Una cita futura de la serie no tiene una franja valida.",
        undefined,
        item.id,
      );
    }
    const state = classifyMadridCivilSlot(slot, input.now);
    if (!state.isFuture) continue;
    candidates.push(item);
  }
  if (!candidates.some((item) => item.id === selected.id)) {
    return planError(input.scope, "recurring_occurrence_unavailable", "La cita seleccionada ya no esta disponible.");
  }

  const occupancyDelta = new Map<string, number>();
  const affected: AffectedRecurringAppointment[] = [];
  for (const appointment of candidates) {
    const index = appointment.data.recurrenceIndex as number;
    const oldSlot = effectiveSlot(appointment.data) as RecurringRescheduleSlot;
    const duration = durationMinutes(appointment.data);
    if (!duration) {
      return planError(
        input.scope,
        "recurring_occurrence_unavailable",
        "Una cita futura de la serie no tiene una duracion valida.",
        oldSlot,
        appointment.id,
      );
    }
    const newSlot = {
      date: addUtcDays(input.preferredSlot.date, (index - (selectedIndex as number)) * input.series.intervalDays),
      time: input.preferredSlot.time,
    };
    const oldKeys = slotKeys(oldSlot, duration);
    const newKeys = slotKeys(newSlot, duration);
    if (oldKeys.length === 0 || newKeys.length === 0) {
      return planError(
        input.scope,
        "recurring_occurrence_unavailable",
        "Una cita futura de la serie no tiene bloques de ocupacion validos.",
        oldSlot,
        appointment.id,
      );
    }
    oldKeys.forEach((key) => occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) - 1));
    newKeys.forEach((key) => occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) + 1));
    affected.push({ appointment, oldSlot, newSlot, oldKeys, newKeys });
  }

  for (const item of affected) {
    const state = classifyMadridCivilSlot(item.newSlot, input.now);
    if (!state.isFuture) {
      return planError(input.scope, "slot_not_future", `La franja ${displaySlot(item.newSlot)} ya no es futura.`, item.newSlot, item.appointment.id);
    }
    if (input.actorType === "customer" && state.isToday) {
      return planError(input.scope, "same_day_change_not_allowed", "Las citas no se pueden modificar ni cancelar el mismo dia.", item.newSlot, item.appointment.id);
    }
  }

  for (let leftIndex = 0; leftIndex < affected.length; leftIndex += 1) {
    const left = affected[leftIndex];
    const leftKeys = new Set(left.newKeys);
    for (let rightIndex = leftIndex + 1; rightIndex < affected.length; rightIndex += 1) {
      const right = affected[rightIndex];
      if (firstIntersection(right.newKeys, leftKeys)) {
        return planError(
          input.scope,
          "appointment_conflict",
          `Dos citas de la serie se solaparian el ${displaySlot(right.newSlot)}.`,
          right.newSlot,
          right.appointment.id,
        );
      }
    }
  }

  const patchedSlots = new Map(affected.map((item) => [item.appointment.id, item.newSlot]));
  const effectiveDates = input.occurrences
    .map((item) => patchedSlots.get(item.id) ?? effectiveSlot(item.data))
    .filter((slot): slot is RecurringRescheduleSlot => Boolean(slot))
    .map((slot) => slot.date);

  return {
    ok: true,
    draft: {
      scope: input.scope,
      selectedAppointmentId: selected.id,
      selectedIndex: selectedIndex as number,
      oldAnchorSlot: selectedSlot,
      newAnchorSlot: input.preferredSlot,
      affected,
      occupancyKeys: [...occupancyDelta.keys()].sort(),
      occupancyDelta,
      targetDates: [...new Set(affected.map((item) => item.newSlot.date))].sort(),
      seriesEndDate: effectiveDates.sort().at(-1) ?? input.series.endDate,
    },
  };
}

function appointmentKeys(appointment: RecurringAppointmentData): string[] {
  const slot = effectiveSlot(appointment);
  const duration = durationMinutes(appointment);
  return slot && duration ? slotKeys(slot, duration) : [];
}

function errorForAffected(
  draft: RecurringRescheduleDraft,
  reason: RecurringRescheduleReason,
  message: string,
  affected: AffectedRecurringAppointment,
): AvailabilityResult {
  return planError(draft.scope, reason, message, affected.newSlot, affected.appointment.id);
}

export function validateRecurringRescheduleAvailability(input: {
  draft: RecurringRescheduleDraft;
  siteConfig: Partial<SiteConfig>;
  blockedKeys: Set<string>;
  occupancyByKey: Map<string, unknown>;
  userAppointments: RecurringAppointmentRecord[];
}): AvailabilityResult {
  const config = normalizeSiteConfig(input.siteConfig);
  const validTimes = new Set(generateTimeSlots(config));
  const affectedIds = new Set(input.draft.affected.map((item) => item.appointment.id));

  for (const affected of input.draft.affected) {
    const duration = durationMinutes(affected.appointment.data);
    if (!validTimes.has(affected.newSlot.time)
      || !doesSessionFitWithinSchedule(config, affected.newSlot.time, duration)) {
      return errorForAffected(
        input.draft,
        "outside_schedule",
        `La franja ${displaySlot(affected.newSlot)} queda fuera del horario del centro.`,
        affected,
      );
    }
    if (affected.newKeys.some((key) => input.blockedKeys.has(key))) {
      return errorForAffected(
        input.draft,
        "slot_blocked",
        `La franja ${displaySlot(affected.newSlot)} esta bloqueada.`,
        affected,
      );
    }
  }

  const otherAppointments = input.userAppointments.filter((item) =>
    !affectedIds.has(item.id) && isActiveOccurrenceStatus(item.data.status));
  for (const affected of input.draft.affected) {
    const targetKeys = new Set(affected.newKeys);
    const hasConflict = otherAppointments.some((item) => firstIntersection(appointmentKeys(item.data), targetKeys));
    if (hasConflict) {
      return errorForAffected(
        input.draft,
        "appointment_conflict",
        `El cliente ya tiene una cita que se solapa el ${displaySlot(affected.newSlot)}.`,
        affected,
      );
    }
  }

  const occupancyWrites: RecurringOccupancyWrite[] = [];
  for (const key of input.draft.occupancyKeys) {
    const currentCount = input.occupancyByKey.has(key) ? input.occupancyByKey.get(key) : 0;
    const delta = input.draft.occupancyDelta.get(key) ?? 0;
    const affected = input.draft.affected.find((item) => item.newKeys.includes(key)) ?? input.draft.affected[0];
    if (typeof currentCount !== "number" || !Number.isInteger(currentCount) || currentCount < 0) {
      return planError(
        input.draft.scope,
        "invalid_occupancy",
        "La ocupacion registrada para una franja no es valida.",
        affected?.newSlot,
        affected?.appointment.id,
      );
    }
    const finalCount = currentCount + delta;
    if (!Number.isInteger(finalCount) || finalCount < 0) {
      return planError(
        input.draft.scope,
        "invalid_occupancy",
        "La ocupacion final calculada para una franja no es valida.",
        affected?.newSlot,
        affected?.appointment.id,
      );
    }
    if (finalCount > config.maxCapacity) {
      return planError(
        input.draft.scope,
        "slot_full",
        affected ? `La franja ${displaySlot(affected.newSlot)} esta completa.` : "La franja esta completa.",
        affected?.newSlot,
        affected?.appointment.id,
      );
    }
    if (delta !== 0) {
      const separator = key.indexOf("_");
      occupancyWrites.push({
        key,
        date: key.slice(0, separator),
        time: key.slice(separator + 1),
        delta,
        finalCount,
      });
    }
  }

  return { ok: true, plan: { occupancyWrites } };
}

export function buildRecurringAppointmentPatch(
  slot: RecurringRescheduleSlot,
  actorUid: string,
  now: string,
): Record<string, unknown> {
  return {
    preferredSlots: [slot],
    approvedSlot: slot,
    date: slot.date,
    time: slot.time,
    updatedAt: now,
    modifiedAt: now,
    modifiedBy: actorUid,
  };
}

export function buildRecurringRescheduleSeriesPatch(input: {
  now: string;
  actorUid: string;
  scope: RecurringRescheduleScope;
  selectedIndex: number;
  anchorSlot: RecurringRescheduleSlot;
  currentEndDate: string;
  effectiveEndDate: string;
}): Record<string, unknown> {
  return {
    updatedAt: input.now,
    lastRescheduledAt: input.now,
    lastRescheduledByUid: input.actorUid,
    lastRescheduleScope: input.scope,
    lastRescheduleFromIndex: input.selectedIndex,
    lastRescheduleAnchorSlot: input.anchorSlot,
    ...(input.currentEndDate !== input.effectiveEndDate ? { endDate: input.effectiveEndDate } : {}),
  };
}

export function buildRecurringRescheduleActivityLog(input: {
  actorType: RecurringRescheduleActorType;
  actorUid: string;
  seriesId: string;
  appointmentId: string;
  scope: RecurringRescheduleScope;
  affectedAppointmentIds: string[];
  oldAnchorSlot: RecurringRescheduleSlot;
  newAnchorSlot: RecurringRescheduleSlot;
  createdAt: string;
}): Record<string, unknown> {
  return {
    action: "recurring_appointment_rescheduled",
    actorType: input.actorType,
    actorUid: input.actorUid,
    seriesId: input.seriesId,
    appointmentId: input.appointmentId,
    scope: input.scope,
    affectedAppointmentIds: input.affectedAppointmentIds,
    affectedCount: input.affectedAppointmentIds.length,
    oldAnchorSlot: input.oldAnchorSlot,
    newAnchorSlot: input.newAnchorSlot,
    createdAt: input.createdAt,
  };
}

function throwHttps(error: RecurringRescheduleError): never {
  throw new HttpsError("failed-precondition", error.message, {
    reason: error.reason,
    scope: error.scope,
    ...(error.problematicSlot ? { problematicSlot: error.problematicSlot } : {}),
    ...(error.problematicAppointmentId ? { problematicAppointmentId: error.problematicAppointmentId } : {}),
  });
}

function throwCustomerSingleError(
  reason: RecurringRescheduleReason | "series_unavailable",
  message: string,
  slot?: RecurringRescheduleSlot,
  appointmentId?: string,
): never {
  throw new HttpsError("failed-precondition", message, {
    reason,
    scope: "single",
    ...(slot ? { problematicSlot: slot } : {}),
    ...(appointmentId ? { problematicAppointmentId: appointmentId } : {}),
  });
}

async function runCustomerSingleRecurringReschedule(
  deps: RecurringRescheduleDeps,
  request: CallableRequest,
  parsed: RecurringRescheduleRequest,
): Promise<Record<string, unknown>> {
  const actorUid = request.auth!.uid;
  const selectedRef = deps.db.collection("appointments").doc(parsed.appointmentId);
  return deps.db.runTransaction(async (transaction: Transaction) => {
    const selectedSnap = await transaction.get(selectedRef);
    if (!selectedSnap.exists) {
      throwCustomerSingleError("recurring_occurrence_unavailable", "No se ha encontrado la cita indicada.");
    }
    const selected = selectedSnap.data() as RecurringAppointmentData;
    if (selected.userId !== actorUid) {
      throw new HttpsError("permission-denied", "No puedes modificar la cita de otro usuario.");
    }
    if (!selected.recurrenceSeriesId || !isActiveOccurrenceStatus(selected.status)) {
      throwCustomerSingleError("recurring_occurrence_unavailable", "La cita recurrente ya no se puede modificar.");
    }

    const seriesRef = deps.db.collection("appointment_recurrences").doc(selected.recurrenceSeriesId);
    const occurrencesQuery = deps.db.collection("appointments")
      .where("recurrenceSeriesId", "==", selected.recurrenceSeriesId);
    const configRef = deps.db.collection("site_config").doc("main");
    const userAppointmentsQuery = deps.db.collection("appointments")
      .where("userId", "==", actorUid)
      .where("status", "in", ["pending", "approved"]);
    const [seriesSnap, occurrencesSnap, configSnap, userAppointmentsSnap] = await Promise.all([
      transaction.get(seriesRef),
      transaction.get(occurrencesQuery),
      transaction.get(configRef),
      transaction.get(userAppointmentsQuery),
    ]);
    if (!seriesSnap.exists) {
      throwCustomerSingleError("series_unavailable", "No se ha encontrado la serie indicada.");
    }
    const series = seriesSnap.data() as RecurringSeriesData;
    if (series.userId !== actorUid || !isActiveOccurrenceStatus(series.status)) {
      throwCustomerSingleError("series_unavailable", "La serie ya no se puede modificar.");
    }

    const duration = durationMinutes(selected);
    const currentSlot = effectiveSlot(selected);
    const nowDate = deps.getNowDate();
    const currentInstant = currentSlot ? madridCivilSlotToInstant(currentSlot) : undefined;
    const targetInstant = madridCivilSlotToInstant(parsed.preferredSlot);
    if (!duration || !currentSlot || !currentInstant || currentInstant <= nowDate) {
      throwCustomerSingleError(
        "recurring_occurrence_unavailable",
        "La cita recurrente no tiene una franja futura valida.",
        currentSlot,
        selectedRef.id,
      );
    }
    if (!targetInstant || targetInstant <= nowDate) {
      throwCustomerSingleError("slot_not_future", "La nueva franja debe estar en el futuro.", parsed.preferredSlot, selectedRef.id);
    }
    if (isInsideCustomerRescheduleLockWindow(currentSlot, nowDate)
      || isInsideCustomerRescheduleLockWindow(parsed.preferredSlot, nowDate)) {
      throwCustomerSingleError(
        "one_day_change_not_allowed",
        "Esta cita ya esta dentro del plazo de 24 horas previo al entrenamiento y no puede modificarse.",
        isInsideCustomerRescheduleLockWindow(currentSlot, nowDate) ? currentSlot : parsed.preferredSlot,
        selectedRef.id,
      );
    }

    const oldKeys = selected.status === "approved" ? slotKeys(currentSlot, duration) : [];
    const newKeys = slotKeys(parsed.preferredSlot, duration);
    if (newKeys.length === 0 || (selected.status === "approved" && oldKeys.length === 0)) {
      throwCustomerSingleError("invalid_occupancy", "Los bloques de ocupacion de la cita no son validos.", parsed.preferredSlot, selectedRef.id);
    }
    const occupancyDelta = new Map<string, number>();
    oldKeys.forEach((key) => occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) - 1));
    newKeys.forEach((key) => occupancyDelta.set(key, occupancyDelta.get(key) ?? 0));
    const occupancyKeys = [...occupancyDelta.keys()].sort();
    const occupancyRefs = occupancyKeys.map((key) => deps.db.collection("slot_occupancy").doc(key));
    const blockedQuery = deps.db.collection("blocked_slots").where("date", "==", parsed.preferredSlot.date);
    const [occupancySnaps, blockedSnap] = await Promise.all([
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
      transaction.get(blockedQuery),
    ]);

    const config = normalizeSiteConfig(configSnap.exists ? configSnap.data() as Partial<SiteConfig> : undefined);
    if (!new Set(generateTimeSlots(config)).has(parsed.preferredSlot.time)
      || !doesSessionFitWithinSchedule(config, parsed.preferredSlot.time, duration)) {
      throwCustomerSingleError("outside_schedule", "La franja seleccionada queda fuera del horario del centro.", parsed.preferredSlot, selectedRef.id);
    }
    const blockedKeys = new Set<string>();
    blockedSnap.docs.forEach((snap) => {
      const data = snap.data() as Partial<RecurringRescheduleSlot>;
      if (typeof data.date === "string" && typeof data.time === "string") {
        blockedKeys.add(slotOccupancyDocId(data.date, data.time));
      }
    });
    if (newKeys.some((key) => blockedKeys.has(key))) {
      throwCustomerSingleError("slot_blocked", "La franja seleccionada esta bloqueada.", parsed.preferredSlot, selectedRef.id);
    }
    const targetKeySet = new Set(newKeys);
    const hasConflict = userAppointmentsSnap.docs.some((snap) => {
      if (snap.id === selectedRef.id) return false;
      const data = snap.data() as RecurringAppointmentData;
      return appointmentKeys(data).some((key) => targetKeySet.has(key));
    });
    if (hasConflict) {
      throwCustomerSingleError("appointment_conflict", "Ya tienes una cita que se solapa con esta franja.", parsed.preferredSlot, selectedRef.id);
    }

    const occupancyWrites: Array<{ key: string; date: string; time: string; count: number }> = [];
    occupancySnaps.forEach((snap, index) => {
      const key = occupancyKeys[index];
      const raw = snap.exists ? (snap.data() as { count?: unknown }).count : 0;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        throwCustomerSingleError("invalid_occupancy", "La ocupacion registrada no es valida.", parsed.preferredSlot, selectedRef.id);
      }
      const delta = occupancyDelta.get(key) ?? 0;
      const finalCount = raw + delta;
      if (!Number.isInteger(finalCount) || finalCount < 0) {
        throwCustomerSingleError("invalid_occupancy", "La ocupacion final no es valida.", parsed.preferredSlot, selectedRef.id);
      }
      if (targetKeySet.has(key) && finalCount >= config.maxCapacity) {
        throwCustomerSingleError("slot_full", "La franja seleccionada esta completa.", parsed.preferredSlot, selectedRef.id);
      }
      if (delta !== 0) {
        const separator = key.indexOf("_");
        occupancyWrites.push({
          key,
          date: key.slice(0, separator),
          time: key.slice(separator + 1),
          count: finalCount,
        });
      }
    });

    const now = nowDate.toISOString();
    const deleteField = FieldValue.delete();
    const appointmentPatch: Record<string, unknown> = {
      preferredSlots: [parsed.preferredSlot],
      date: parsed.preferredSlot.date,
      time: parsed.preferredSlot.time,
      status: "pending",
      updatedAt: now,
      modifiedAt: now,
      modifiedBy: actorUid,
    };
    if (selected.status === "approved") {
      Object.assign(appointmentPatch, {
        approvedSlot: deleteField,
        assignedTrainer: deleteField,
        trainerNotes: deleteField,
        approvedAt: deleteField,
        approvedBy: deleteField,
        approvedByAdmin: deleteField,
        approvedByAdminUid: deleteField,
        approvalNotes: deleteField,
      });
    }

    const occurrences = occurrencesSnap.docs.map((snap) => ({
      id: snap.id,
      data: snap.data() as RecurringAppointmentData,
    }));
    const metadata = calculateActiveSeriesMetadata(occurrences.map((occurrence) => ({
      data: occurrence.data as RecurringAppointmentData & ReplacementAppointmentData,
      ...(occurrence.id === selectedRef.id ? {
        statusOverride: "pending",
        slotOverride: parsed.preferredSlot,
      } : {}),
    })), nowDate);
    if (!metadata) {
      throwCustomerSingleError(
        "recurring_occurrence_unavailable",
        "No se pueden calcular los metadatos activos de la serie.",
        parsed.preferredSlot,
        selectedRef.id,
      );
    }
    const seriesPatch: Record<string, unknown> = {
      status: "pending",
      assignedTrainer: deleteField,
      updatedAt: now,
      lastRescheduledAt: now,
      lastRescheduledByUid: actorUid,
      lastRescheduleScope: "single",
      lastRescheduleAppointmentId: selectedRef.id,
      futureOccurrenceCount: metadata.futureOccurrenceCount,
      futureStartDate: metadata.futureStartDate ?? deleteField,
      futureStartTime: metadata.futureStartTime ?? deleteField,
      futureEndDate: metadata.futureEndDate ?? deleteField,
    };

    transaction.set(selectedRef, appointmentPatch, { merge: true });
    occupancyWrites.forEach((write) => {
      transaction.set(
        deps.db.collection("slot_occupancy").doc(write.key),
        { date: write.date, time: write.time, count: write.count },
        { merge: true },
      );
    });
    transaction.set(seriesRef, seriesPatch, { merge: true });
    transaction.create(deps.db.collection("activity_logs").doc(), {
      action: "customer_recurring_appointment_rescheduled",
      userId: actorUid,
      appointmentId: selectedRef.id,
      seriesId: selected.recurrenceSeriesId,
      oldStatus: selected.status,
      newStatus: "pending",
      oldSlot: currentSlot,
      newSlot: parsed.preferredSlot,
      createdAt: now,
    });
    return { success: true, appointmentId: selectedRef.id, status: "pending" };
  });
}

export interface RecurringRescheduleDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

interface TransactionOccurrence extends RecurringAppointmentRecord {
  ref: FirebaseFirestore.DocumentReference;
}

interface CustomerSeriesOccurrence extends TransactionOccurrence {
  data: RecurringAppointmentData & ReplacementAppointmentData;
}

function throwCustomerSeriesError(
  reason: string,
  message: string,
  problematicSlot?: RecurringRescheduleSlot,
  problematicAppointmentId?: string,
): never {
  throw new HttpsError("failed-precondition", message, {
    reason,
    scope: "series",
    ...(problematicSlot ? { problematicSlot } : {}),
    ...(problematicAppointmentId ? { problematicAppointmentId } : {}),
  });
}

async function runCustomerSeriesReplacement(
  deps: RecurringRescheduleDeps,
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  if (!request.auth) {
    throw new HttpsError("permission-denied", "Debes iniciar sesion para modificar una serie.");
  }
  const input = parseReplaceOwnRecurringSeriesScheduleRequest(request.data);
  if (!input) {
    throw new HttpsError("invalid-argument", "Los datos de la nueva programacion no son validos.", {
      reason: "invalid_request",
    });
  }
  const customerUid = request.auth.uid;
  const selectedRef = deps.db.collection("appointments").doc(input.appointmentId);
  return deps.db.runTransaction(async (transaction: Transaction) => {
    const selectedSnap = await transaction.get(selectedRef);
    if (!selectedSnap.exists) {
      throwCustomerSeriesError("series_unavailable", "No se ha encontrado la cita indicada.");
    }
    const selected = selectedSnap.data() as RecurringAppointmentData;
    if (selected.userId !== customerUid) {
      throw new HttpsError("permission-denied", "No puedes modificar la serie de otro usuario.");
    }
    if (!selected.recurrenceSeriesId) {
      throwCustomerSeriesError("series_unavailable", "La cita indicada no pertenece a una serie recurrente.");
    }

    const seriesId = selected.recurrenceSeriesId;
    const seriesRef = deps.db.collection("appointment_recurrences").doc(seriesId);
    const seriesSnap = await transaction.get(seriesRef);
    if (!seriesSnap.exists) {
      throwCustomerSeriesError("series_unavailable", "No se ha encontrado la serie indicada.");
    }
    const series = { id: seriesSnap.id, ...seriesSnap.data() } as RecurringSeriesData;
    if (series.userId !== customerUid || !isActiveOccurrenceStatus(series.status)) {
      throwCustomerSeriesError("series_unavailable", "La serie ya no se puede modificar.");
    }
    const seriesDuration = replacementDurationMinutes({ duration: series.duration ?? "" });
    if (!seriesDuration || typeof series.bonoId !== "string" || !series.bonoId) {
      throwCustomerSeriesError("invalid_financial_reservation", "Los datos reservados de la serie no son validos.");
    }

    const occurrencesQuery = deps.db.collection("appointments").where("recurrenceSeriesId", "==", seriesId);
    const bonoRef = deps.db.collection("bonos").doc(series.bonoId);
    const configRef = deps.db.collection("site_config").doc("main");
    const userRef = deps.db.collection("users").doc(customerUid);
    const userAppointmentsQuery = deps.db.collection("appointments")
      .where("userId", "==", customerUid)
      .where("status", "in", ["pending", "approved"]);
    const [occurrencesSnap, bonoSnap, configSnap, userSnap, userAppointmentsSnap] = await Promise.all([
      transaction.get(occurrencesQuery),
      transaction.get(bonoRef),
      transaction.get(configRef),
      transaction.get(userRef),
      transaction.get(userAppointmentsQuery),
    ]);
    if (!bonoSnap.exists) {
      throwCustomerSeriesError("bono_unavailable", "No se ha encontrado el bono reservado de la serie.");
    }
    const bono = { id: bonoSnap.id, ...bonoSnap.data() } as ReplacementBonoData & { id: string; userId?: string };
    if (bono.userId !== customerUid || bono.estado === "eliminado") {
      throwCustomerSeriesError("bono_unavailable", "El bono reservado no esta disponible.");
    }
    if (!hasValidReservedBonoData(bono)) {
      throwCustomerSeriesError("invalid_financial_reservation", "La reserva financiera de la serie no es valida.");
    }
    const usableRemainingMinutes = getUsableBonoRemainingMinutes(bono);
    const totalBonoMinutes = getBonoTotalMinutes(bono as Parameters<typeof getBonoTotalMinutes>[0]);
    if (usableRemainingMinutes === undefined || !isNonNegativeInteger(totalBonoMinutes)) {
      throwCustomerSeriesError("invalid_financial_reservation", "La reserva financiera no se puede aplicar con exactitud.");
    }
    if (!userSnap.exists) {
      throwCustomerSeriesError("series_unavailable", "No se ha encontrado el perfil del cliente.");
    }
    const userProfile = userSnap.data() as Record<string, unknown>;

    const nowDate = deps.getNowDate();
    const now = nowDate.toISOString();
    const today = getMadridDateKey(nowDate);
    const occurrences: CustomerSeriesOccurrence[] = occurrencesSnap.docs.map((snap) => ({
      id: snap.id,
      ref: snap.ref,
      data: snap.data() as CustomerSeriesOccurrence["data"],
    }));
    if (!occurrences.some((occurrence) => occurrence.id === selectedRef.id)) {
      throwCustomerSeriesError("series_unavailable", "La cita indicada ya no pertenece a esta serie.");
    }

    const seenIndexes = new Set<number>();
    let maxHistoricalIndex = -1;
    occurrences.forEach((occurrence) => {
      const index = occurrence.data.recurrenceIndex;
      if (!Number.isInteger(index)) return;
      if (seenIndexes.has(index as number)) {
        throwCustomerSeriesError("recurring_occurrence_unavailable", "La serie contiene indices de recurrencia duplicados.");
      }
      seenIndexes.add(index as number);
      if ((index as number) >= 0) maxHistoricalIndex = Math.max(maxHistoricalIndex, index as number);
    });

    const historicalActive: CustomerSeriesOccurrence[] = [];
    const futureActive: Array<CustomerSeriesOccurrence & { slot: RecurringRescheduleSlot; index: number; oldKeys: string[] }> = [];
    for (const occurrence of occurrences) {
      if (!isActiveOccurrenceStatus(occurrence.data.status)) continue;
      const occurrenceDuration = replacementDurationMinutes(occurrence.data);
      if (occurrence.data.userId !== customerUid
        || occurrence.data.recurrenceSeriesId !== seriesId
        || occurrenceDuration !== seriesDuration) {
        throwCustomerSeriesError(
          "recurring_occurrence_unavailable",
          "Una occurrence activa de la serie contiene datos no validos.",
          undefined,
          occurrence.id,
        );
      }
      const slot = validReplacementSlot(occurrence.data);
      if (!slot) {
        const safeDate = safeReplacementCivilDate(occurrence.data);
        if (safeDate && safeDate < today) {
          historicalActive.push(occurrence);
          continue;
        }
        throwCustomerSeriesError(
          "recurring_occurrence_unavailable",
          "Una occurrence activa de la serie no tiene una franja valida.",
          undefined,
          occurrence.id,
        );
      }
      const instant = madridCivilSlotToInstant(slot);
      if (!instant) {
        const safeDate = safeReplacementCivilDate(occurrence.data);
        if (safeDate && safeDate < today) {
          historicalActive.push(occurrence);
          continue;
        }
        throwCustomerSeriesError(
          "recurring_occurrence_unavailable",
          "Una occurrence activa de la serie no tiene un instante civil valido.",
          slot,
          occurrence.id,
        );
      }
      if (instant <= nowDate) {
        historicalActive.push(occurrence);
        continue;
      }
      if (isInsideCustomerRescheduleLockWindow(slot, nowDate)) {
        throwCustomerSeriesError(
          "one_day_change_not_allowed",
          "Una de las sesiones de esta serie ya esta dentro del plazo de 24 horas previo y no puede reprogramarse toda la serie.",
          slot,
          occurrence.id,
        );
      }
      const index = occurrence.data.recurrenceIndex;
      if (!Number.isInteger(index) || (index as number) < 0) {
        throwCustomerSeriesError(
          "recurring_occurrence_unavailable",
          "Una occurrence futura de la serie no tiene un indice valido.",
          slot,
          occurrence.id,
        );
      }
      if (!hasValidFutureReservation(occurrence.data, series.bonoId, seriesDuration)) {
        throwCustomerSeriesError(
          "invalid_financial_reservation",
          "Una reserva futura de la serie no es valida.",
          slot,
          occurrence.id,
        );
      }
      const oldKeys = occurrence.data.status === "approved" ? slotKeys(slot, seriesDuration) : [];
      if (occurrence.data.status === "approved" && oldKeys.length === 0) {
        throwCustomerSeriesError("invalid_occupancy", "La ocupacion antigua no es valida.", slot, occurrence.id);
      }
      futureActive.push({ ...occurrence, slot, index: index as number, oldKeys });
    }
    futureActive.sort((left, right) => left.index - right.index);
    if (futureActive.length === 0) {
      throwCustomerSeriesError("series_unavailable", "La serie no tiene sesiones futuras activas para sustituir.");
    }

    const generatedDates = generateRecurringOccurrenceDates(input.startSlot.date, input.intervalDays, input.endDate);
    if (generatedDates.length < 2
      || generatedDates.length > MAX_RECURRING_OCCURRENCES
      || generatedDates.at(-1) !== input.endDate) {
      throwCustomerSeriesError("invalid_series_length", "La nueva serie debe contener entre dos y veinte sesiones alineadas con su intervalo.");
    }
    const desired = generatedDates.map((date) => {
      const slot = { date, time: input.startSlot.time };
      const instant = madridCivilSlotToInstant(slot);
      if (!instant || instant <= nowDate) {
        throwCustomerSeriesError("slot_not_future", "Todas las nuevas sesiones deben estar en el futuro.", slot);
      }
      if (isInsideCustomerRescheduleLockWindow(slot, nowDate)) {
        throwCustomerSeriesError(
          "one_day_change_not_allowed",
          "La nueva programacion debe comenzar fuera del plazo de 24 horas.",
          slot,
        );
      }
      return { slot, keys: slotKeys(slot, seriesDuration) };
    });
    const config = normalizeSiteConfig(configSnap.exists ? configSnap.data() as Partial<SiteConfig> : undefined);
    const validTimes = new Set(generateTimeSlots(config));
    if (!validTimes.has(input.startSlot.time)
      || !doesSessionFitWithinSchedule(config, input.startSlot.time, seriesDuration)) {
      throwCustomerSeriesError("outside_schedule", "La nueva programacion queda fuera del horario del centro.", input.startSlot);
    }

    const { reused, cancelled, createdCount } = planReplacementGroups(futureActive, desired.length);
    const oldFutureReservedMinutes = futureActive.reduce(
      (total, occurrence) => total + Number(occurrence.data.minutesDeductedAmount),
      0,
    );
    const newFutureMinutes = desired.length * seriesDuration;
    const minutesDelta = newFutureMinutes - oldFutureReservedMinutes;
    const expirationDate = civilDateFromExpiration(typeof bono.fechaExpiracion === "string" ? bono.fechaExpiracion : undefined);
    const bonoExpired = bono.estado === "expirado"
      || isBonoExpiredAt(bono as Parameters<typeof isBonoExpiredAt>[0], nowDate);
    if (!bonoExpired && expirationDate && input.endDate > expirationDate) {
      throwCustomerSeriesError("bono_unavailable", "La nueva programacion supera la vigencia del bono.");
    }
    if (minutesDelta > 0 && (bono.estado !== "activo" || bonoExpired)) {
      throwCustomerSeriesError("bono_unavailable", "Un bono expirado no puede ampliar reservas.");
    }

    const occupancyDelta = new Map<string, number>();
    futureActive.forEach((occurrence) => occurrence.oldKeys.forEach((key) => {
      occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) - 1);
    }));
    desired.forEach((occurrence) => occurrence.keys.forEach((key) => {
      occupancyDelta.set(key, occupancyDelta.get(key) ?? 0);
    }));
    const occupancyKeys = [...occupancyDelta.keys()].sort();
    const occupancyRefs = occupancyKeys.map((key) => deps.db.collection("slot_occupancy").doc(key));
    const blockedQuery = deps.db.collection("blocked_slots")
      .where("date", ">=", generatedDates[0])
      .where("date", "<=", generatedDates.at(-1));
    const [occupancySnaps, blockedSnap] = await Promise.all([
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
      transaction.get(blockedQuery),
    ]);

    const occupancyByKey = new Map<string, number>();
    occupancySnaps.forEach((snap, index) => {
      const raw = snap.exists ? (snap.data() as { count?: unknown }).count : 0;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        throwCustomerSeriesError("invalid_occupancy", "La ocupacion registrada no es valida.");
      }
      occupancyByKey.set(occupancyKeys[index], raw);
    });
    const blockedKeys = new Set<string>();
    blockedSnap.docs.forEach((snap) => {
      const data = snap.data() as Partial<RecurringRescheduleSlot>;
      if (typeof data.date === "string" && typeof data.time === "string") {
        blockedKeys.add(slotOccupancyDocId(data.date, data.time));
      }
    });
    const excludedIds = new Set(futureActive.map((occurrence) => occurrence.id));
    const externalAppointments = userAppointmentsSnap.docs
      .filter((snap) => !excludedIds.has(snap.id))
      .map((snap) => snap.data() as RecurringAppointmentData);
    const internalKeys = new Set<string>();
    for (const occurrence of desired) {
      if (occurrence.keys.some((key) => blockedKeys.has(key))) {
        throwCustomerSeriesError("slot_blocked", "Una franja de la nueva serie esta bloqueada.", occurrence.slot);
      }
      for (const key of occurrence.keys) {
        if (internalKeys.has(key)) {
          throwCustomerSeriesError("appointment_conflict", "Dos sesiones nuevas de la serie se solaparian.", occurrence.slot);
        }
        const current = occupancyByKey.get(key) ?? 0;
        const effective = current + (occupancyDelta.get(key) ?? 0);
        if (!Number.isInteger(effective) || effective < 0) {
          throwCustomerSeriesError("invalid_occupancy", "La ocupacion final calculada no es valida.", occurrence.slot);
        }
        if (effective >= config.maxCapacity) {
          throwCustomerSeriesError("slot_full", "Una franja de la nueva serie esta completa.", occurrence.slot);
        }
        const targetKeys = new Set(occurrence.keys);
        if (externalAppointments.some((appointment) => firstReplacementIntersection(appointmentKeys(appointment), targetKeys))) {
          throwCustomerSeriesError("appointment_conflict", "Ya tienes una cita que se solapa con la nueva serie.", occurrence.slot);
        }
        internalKeys.add(key);
      }
    }
    const occupancyWrites: Array<{ key: string; date: string; time: string; count: number }> = [];
    occupancyKeys.forEach((key) => {
      const current = occupancyByKey.get(key) ?? 0;
      const delta = occupancyDelta.get(key) ?? 0;
      const finalCount = current + delta;
      if (!Number.isInteger(finalCount) || finalCount < 0) {
        throwCustomerSeriesError("invalid_occupancy", "La ocupacion final calculada no es valida.");
      }
      if (delta !== 0) {
        const separator = key.indexOf("_");
        occupancyWrites.push({ key, date: key.slice(0, separator), time: key.slice(separator + 1), count: finalCount });
      }
    });

    const createdRefs = Array.from({ length: createdCount }, () => deps.db.collection("appointments").doc());
    const refundPatches = new Map<string, Record<string, unknown>>();
    const histories = replacementHistoryEntries(bono.historial);
    let bonoPatch: Record<string, unknown> | undefined;
    if (minutesDelta > 0) {
      const deduction = calculateAppointmentDeduction(
        bono as Parameters<typeof calculateAppointmentDeduction>[0],
        minutesDelta,
        now,
      );
      if (!deduction.ok) {
        throwCustomerSeriesError(
          deduction.reason === "insufficient-minutes" ? "insufficient_bono_minutes" : "bono_unavailable",
          "El bono no tiene minutos suficientes para ampliar la serie.",
        );
      }
      bonoPatch = {
        minutosRestantes: deduction.remainingMinutes,
        estado: deduction.bonoStatus,
        historial: [
          ...histories,
          ...createdRefs.map((ref) => ({
            fecha: now,
            tipo: series.serviceType ?? "",
            duracion: String(seriesDuration),
            appointmentId: ref.id,
            accion: "descuento_cita",
          })),
        ],
      };
    } else if (minutesDelta < 0) {
      const exactRemaining = usableRemainingMinutes - minutesDelta;
      if (!isNonNegativeInteger(exactRemaining) || exactRemaining > totalBonoMinutes) {
        throwCustomerSeriesError("invalid_financial_reservation", "La devolucion no se puede aplicar con exactitud.");
      }
      let workingBono = { ...bono, minutosRestantes: usableRemainingMinutes };
      cancelled.forEach((occurrence) => {
        const refund = calculateAppointmentRefund(
          workingBono as Parameters<typeof calculateAppointmentRefund>[0],
          occurrence.data,
          now,
        );
        if (!refund.ok) {
          throwCustomerSeriesError("invalid_financial_reservation", "Una reserva cancelada no se puede devolver.");
        }
        workingBono = { ...workingBono, minutosRestantes: refund.remainingMinutes, estado: refund.bonoStatus };
        refundPatches.set(occurrence.id, {
          minutesRefunded: true,
          minutesRefundedAmount: refund.minutesRefundedAmount,
          minutesRefundedAt: refund.minutesRefundedAt,
          minutesRefundReason: "customer_series_schedule_reduction",
        });
      });
      if (workingBono.minutosRestantes !== exactRemaining) {
        throwCustomerSeriesError("invalid_financial_reservation", "La devolucion no coincide con el delta esperado.");
      }
      bonoPatch = {
        minutosRestantes: workingBono.minutosRestantes,
        estado: workingBono.estado,
        historial: [
          ...histories,
          ...cancelled.map((occurrence) => ({
            fecha: now,
            tipo: series.serviceType ?? "",
            duracion: String(seriesDuration),
            appointmentId: occurrence.id,
            accion: "devolucion_cita",
          })),
        ],
      };
    }

    const deleted = FieldValue.delete();
    const modeled = occurrences.map((occurrence) => {
      const reusedIndex = reused.findIndex((item) => item.id === occurrence.id);
      const isCancelled = cancelled.some((item) => item.id === occurrence.id);
      return {
        data: occurrence.data,
        ...(reusedIndex >= 0 ? { statusOverride: "pending", slotOverride: desired[reusedIndex].slot } : {}),
        ...(isCancelled ? { statusOverride: "cancelled" } : {}),
      };
    });
    createdRefs.forEach((_, index) => {
      modeled.push({
        data: {
          userId: customerUid,
          status: "pending",
          duration: String(seriesDuration),
          preferredSlots: [desired[reused.length + index].slot],
        },
      });
    });
    const metadata = calculateActiveSeriesMetadata(modeled, nowDate);
    if (!metadata) {
      throwCustomerSeriesError("recurring_occurrence_unavailable", "No se pueden calcular los metadatos de la serie.");
    }
    const hasHistorical = occurrences.some((occurrence) => isHistoricalReplacementOccurrence(occurrence.data, nowDate));

    reused.forEach((occurrence, index) => {
      transaction.set(occurrence.ref, {
        preferredSlots: [desired[index].slot],
        date: desired[index].slot.date,
        time: desired[index].slot.time,
        status: "pending",
        assignedTrainer: deleted,
        approvedSlot: deleted,
        trainerNotes: deleted,
        approvedAt: deleted,
        approvedBy: deleted,
        approvedByAdmin: deleted,
        approvedByAdminUid: deleted,
        approvalNotes: deleted,
        updatedAt: now,
        modifiedAt: now,
        modifiedBy: customerUid,
      }, { merge: true });
    });
    cancelled.forEach((occurrence) => {
      transaction.set(occurrence.ref, {
        status: "cancelled",
        cancelledBy: customerUid,
        cancelledAt: now,
        cancellationReason: "customer_series_schedule_reduction",
        updatedAt: now,
        ...refundPatches.get(occurrence.id),
      }, { merge: true });
    });
    const identityTemplate = futureActive[0].data;
    createdRefs.forEach((ref, index) => {
      const slot = desired[reused.length + index].slot;
      transaction.create(ref, {
        ...copyDefinedFields(identityTemplate, ["sessionType", "reason"]),
        userId: customerUid,
        name: typeof userProfile.name === "string" ? userProfile.name : "",
        email: typeof userProfile.email === "string" ? userProfile.email : "",
        phone: typeof userProfile.phone === "string" ? userProfile.phone : "",
        serviceType: series.serviceType ?? identityTemplate.serviceType ?? "",
        duration: String(seriesDuration),
        preferredSlots: [slot],
        date: slot.date,
        time: slot.time,
        status: "pending",
        recurrenceSeriesId: seriesId,
        recurrenceIndex: maxHistoricalIndex + index + 1,
        bonoId: series.bonoId,
        minutesDeducted: true,
        minutesDeductedAmount: seriesDuration,
        minutesDeductedAt: now,
        minutesDeductionSkippedAt: null,
        minutesDeductionSkippedReason: null,
        minutesRefunded: false,
        minutesRefundedAmount: null,
        minutesRefundedAt: null,
        minutesRefundReason: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    occupancyWrites.forEach((write) => {
      transaction.set(
        deps.db.collection("slot_occupancy").doc(write.key),
        { date: write.date, time: write.time, count: write.count },
        { merge: true },
      );
    });
    if (bonoPatch) transaction.set(bonoRef, bonoPatch, { merge: true });

    const seriesPatch: Record<string, unknown> = {
      status: "pending",
      intervalDays: input.intervalDays,
      endDate: input.endDate,
      assignedTrainer: deleted,
      occurrenceCount: metadata.occurrenceCount,
      totalMinutes: metadata.totalMinutes,
      futureOccurrenceCount: metadata.futureOccurrenceCount,
      futureStartDate: metadata.futureStartDate ?? deleted,
      futureStartTime: metadata.futureStartTime ?? deleted,
      futureEndDate: metadata.futureEndDate ?? deleted,
      updatedAt: now,
      lastRescheduledAt: now,
      lastRescheduledByUid: customerUid,
      lastRescheduleScope: "series",
    };
    if (!hasHistorical) {
      seriesPatch.startDate = input.startSlot.date;
      seriesPatch.startTime = input.startSlot.time;
    }
    transaction.set(seriesRef, seriesPatch, { merge: true });

    const reusedAppointmentIds = reused.map((occurrence) => occurrence.id);
    const createdAppointmentIds = createdRefs.map((ref) => ref.id);
    const cancelledAppointmentIds = cancelled.map((occurrence) => occurrence.id);
    const affectedAppointmentIds = [...new Set([
      ...reusedAppointmentIds,
      ...createdAppointmentIds,
      ...cancelledAppointmentIds,
    ])];
    transaction.create(deps.db.collection("activity_logs").doc(), {
      action: "customer_recurring_series_schedule_replaced",
      userId: customerUid,
      seriesId,
      sourceAppointmentId: selectedRef.id,
      oldFutureCount: futureActive.length,
      newFutureCount: desired.length,
      oldFutureReservedMinutes,
      newFutureMinutes,
      minutesDelta,
      newStartSlot: input.startSlot,
      newEndDate: input.endDate,
      intervalDays: input.intervalDays,
      affectedAppointmentIds,
      reusedAppointmentIds,
      createdAppointmentIds,
      cancelledAppointmentIds,
      createdAt: now,
    });
    return {
      success: true,
      seriesId,
      affectedAppointmentIds,
      reusedAppointmentIds,
      createdAppointmentIds,
      cancelledAppointmentIds,
      occurrenceCount: metadata.occurrenceCount,
      totalMinutes: metadata.totalMinutes,
      status: "pending",
    };
  });
}

async function runRecurringReschedule(
  deps: RecurringRescheduleDeps,
  request: CallableRequest,
  actorType: RecurringRescheduleActorType,
): Promise<Record<string, unknown>> {
  if (!request.auth) {
    throw new HttpsError("permission-denied", "Debes iniciar sesion para modificar una cita.");
  }
  const parsed = parseRecurringRescheduleRequest(request.data);
  if (!parsed) {
    throw new HttpsError("invalid-argument", "Los datos de la modificacion no son validos.");
  }
  const actorUid = request.auth.uid;
  if (actorType === "admin") await deps.requireAdmin(actorUid);
  if (actorType === "customer" && parsed.scope === "single") {
    return runCustomerSingleRecurringReschedule(deps, request, parsed);
  }
  const selectedRef = deps.db.collection("appointments").doc(parsed.appointmentId);

  const result = await deps.db.runTransaction(async (transaction: Transaction) => {
    // A. Selected appointment.
    const selectedSnap = await transaction.get(selectedRef);
    if (!selectedSnap.exists) {
      throw new HttpsError("failed-precondition", "No se ha encontrado la cita indicada.");
    }
    const selectedData = selectedSnap.data() as RecurringAppointmentData;
    if (!selectedData.recurrenceSeriesId) {
      throw new HttpsError("failed-precondition", "La cita indicada no pertenece a una serie recurrente.");
    }
    if (actorType === "customer" && selectedData.userId !== actorUid) {
      throw new HttpsError("permission-denied", "No puedes modificar la cita de otro usuario.");
    }

    // B. Series, occurrences, site config and active customer appointments.
    const seriesRef = deps.db.collection("appointment_recurrences").doc(selectedData.recurrenceSeriesId);
    const occurrencesQuery = deps.db.collection("appointments")
      .where("recurrenceSeriesId", "==", selectedData.recurrenceSeriesId);
    const configRef = deps.db.collection("site_config").doc("main");
    const userAppointmentsQuery = deps.db.collection("appointments")
      .where("userId", "==", selectedData.userId)
      .where("status", "in", ["pending", "approved"]);
    const [seriesSnap, occurrencesSnap, configSnap, userAppointmentsSnap] = await Promise.all([
      transaction.get(seriesRef),
      transaction.get(occurrencesQuery),
      transaction.get(configRef),
      transaction.get(userAppointmentsQuery),
    ]);
    if (!seriesSnap.exists) {
      throw new HttpsError("failed-precondition", "No se ha encontrado la serie indicada.");
    }
    const series = { ...seriesSnap.data(), id: seriesSnap.id } as RecurringSeriesData;
    const occurrences: TransactionOccurrence[] = occurrencesSnap.docs.map((snap) => ({
      id: snap.id,
      ref: snap.ref,
      data: snap.data() as RecurringAppointmentData,
    }));

    // C-D. Compute affected appointments, destinations and remaining read references.
    const transactionNow = deps.getNowDate();
    const prepared = prepareRecurringReschedule({
      selectedAppointmentId: parsed.appointmentId,
      preferredSlot: parsed.preferredSlot,
      scope: parsed.scope,
      actorType,
      actorUid,
      now: transactionNow,
      series,
      occurrences,
    });
    if (!prepared.ok) throwHttps(prepared.error);
    const draft = prepared.draft;
    const occupancyRefs = draft.occupancyKeys.map((key) => deps.db.collection("slot_occupancy").doc(key));
    const blockedQuery = deps.db.collection("blocked_slots").where("date", "in", draft.targetDates);

    // E. All remaining reads happen before the first write.
    const [occupancySnaps, blockedSnap] = await Promise.all([
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
      transaction.get(blockedQuery),
    ]);

    // F. Validate all destinations and final occupancy counts.
    const occupancyByKey = new Map<string, unknown>();
    occupancySnaps.forEach((snap, index) => {
      const data = snap.exists ? snap.data() as { count?: unknown } : undefined;
      occupancyByKey.set(draft.occupancyKeys[index], snap.exists ? data?.count : 0);
    });
    const blockedKeys = new Set<string>();
    blockedSnap.docs.forEach((snap) => {
      const data = snap.data() as Partial<RecurringRescheduleSlot>;
      if (typeof data.date === "string" && typeof data.time === "string") {
        blockedKeys.add(slotOccupancyDocId(data.date, data.time));
      }
    });
    const availability = validateRecurringRescheduleAvailability({
      draft,
      siteConfig: configSnap.exists ? configSnap.data() as Partial<SiteConfig> : normalizeSiteConfig(),
      blockedKeys,
      occupancyByKey,
      userAppointments: userAppointmentsSnap.docs.map((snap) => ({
        id: snap.id,
        data: snap.data() as RecurringAppointmentData,
      })),
    });
    if (!availability.ok) throwHttps(availability.error);

    // G. Writes only after every read and validation has completed.
    const now = transactionNow.toISOString();
    const occurrenceById = new Map(occurrences.map((item) => [item.id, item]));
    draft.affected.forEach((item) => {
      const occurrence = occurrenceById.get(item.appointment.id);
      if (!occurrence) return;
      transaction.set(occurrence.ref, buildRecurringAppointmentPatch(item.newSlot, actorUid, now), { merge: true });
    });
    availability.plan.occupancyWrites.forEach((write) => {
      transaction.set(
        deps.db.collection("slot_occupancy").doc(write.key),
        { date: write.date, time: write.time, count: write.finalCount },
        { merge: true },
      );
    });
    transaction.set(seriesRef, buildRecurringRescheduleSeriesPatch({
      now,
      actorUid,
      scope: parsed.scope,
      selectedIndex: draft.selectedIndex,
      anchorSlot: draft.newAnchorSlot,
      currentEndDate: series.endDate,
      effectiveEndDate: draft.seriesEndDate,
    }), { merge: true });
    const affectedAppointmentIds = draft.affected.map((item) => item.appointment.id);
    transaction.create(deps.db.collection("activity_logs").doc(), buildRecurringRescheduleActivityLog({
      actorType,
      actorUid,
      seriesId: series.id,
      appointmentId: parsed.appointmentId,
      scope: parsed.scope,
      affectedAppointmentIds,
      oldAnchorSlot: draft.oldAnchorSlot,
      newAnchorSlot: draft.newAnchorSlot,
      createdAt: now,
    }));
    return {
      success: true,
      appointmentId: parsed.appointmentId,
      seriesId: series.id,
      scope: parsed.scope,
      affectedAppointmentIds,
      affectedCount: affectedAppointmentIds.length,
    };
  });

  return result;
}

export function createRecurringRescheduleHandlers(deps: RecurringRescheduleDeps) {
  return {
    rescheduleRecurringAppointmentFromAdmin: (request: CallableRequest) =>
      runRecurringReschedule(deps, request, "admin"),
    rescheduleOwnRecurringAppointment: (request: CallableRequest) =>
      runRecurringReschedule(deps, request, "customer"),
    replaceOwnRecurringSeriesSchedule: (request: CallableRequest) =>
      runCustomerSeriesReplacement(deps, request),
  };
}
