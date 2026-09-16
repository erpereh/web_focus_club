import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  classifyMadridCivilSlot,
  getAppointmentEffectiveSlot,
  getSlotBlocks,
  isSameDayInMadrid,
  slotOccupancyDocId,
} from "./appointmentLifecycle.js";
import { addUtcDays } from "./recurringAppointments.js";
import {
  doesSessionFitWithinSchedule,
  generateTimeSlots,
  normalizeSiteConfig,
  type SiteConfig,
} from "./siteConfig.js";

export type RecurringRescheduleScope = "single" | "following";
export type RecurringRescheduleActorType = "admin" | "customer";
export type RecurringRescheduleReason =
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
  if (value.scope !== "single" && value.scope !== "following") return undefined;
  return { appointmentId, preferredSlot: value.preferredSlot, scope: value.scope };
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

function slotKeys(slot: RecurringRescheduleSlot, duration: number): string[] {
  return getSlotBlocks(slot.time, duration).map((time) => slotOccupancyDocId(slot.date, time));
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
    if (!Number.isInteger(index) || (index as number) < (selectedIndex as number)) continue;
    if (input.scope === "single" && item.id !== selected.id) continue;
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
    !affectedIds.has(item.id) && (item.data.status === "pending" || item.data.status === "approved"));
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

export interface RecurringRescheduleDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

interface TransactionOccurrence extends RecurringAppointmentRecord {
  ref: FirebaseFirestore.DocumentReference;
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
  };
}
