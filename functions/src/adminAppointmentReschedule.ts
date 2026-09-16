import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  calculateAppointmentDeduction,
  calculateAppointmentRefund,
  classifyMadridCivilSlot,
  getBonoTotalMinutes,
  getAppointmentEffectiveSlot,
  getMadridDateKey,
  getSlotBlocks,
  isBonoExpiredAt,
  slotOccupancyDocId,
  type LifecycleAppointment,
  type LifecycleBono,
} from "./appointmentLifecycle.js";
import {
  generateRecurringOccurrenceDates,
  MAX_RECURRING_OCCURRENCES,
} from "./recurringAppointments.js";
import {
  doesSessionFitWithinSchedule,
  generateTimeSlots,
  normalizeSiteConfig,
  type SiteConfig,
} from "./siteConfig.js";

interface TimeSlot {
  date: string;
  time: string;
}

interface AdminSingleRescheduleInput {
  appointmentId: string;
  slot: TimeSlot;
  assignedTrainer: string | null;
}

interface AdminSeriesReplaceInput {
  appointmentId: string;
  startSlot: TimeSlot;
  endDate: string;
  assignedTrainer: string | null;
}

interface AppointmentData {
  userId: string;
  status: string;
  duration: string | number;
  assignedTrainer?: string | null;
  approvedSlot?: TimeSlot;
  preferredSlots?: TimeSlot[];
  date?: string;
  time?: string;
  recurrenceSeriesId?: string;
  [key: string]: unknown;
}

interface TrainerData {
  active?: boolean;
}

interface SlotOccupancyData {
  count?: unknown;
}

interface RecurrenceSeriesData {
  userId: string;
  status: string;
  intervalDays: number;
  endDate: string;
  bonoId: string;
  duration: string | number;
  serviceType?: string;
  assignedTrainer?: string | null;
  occurrenceCount?: number;
  totalMinutes?: number;
  startDate?: string;
  startTime?: string;
  [key: string]: unknown;
}

interface BonoData extends LifecycleBono {
  userId?: string;
  historial?: unknown;
}

interface TransactionAppointmentRecord extends AppointmentRecord {
  ref: FirebaseFirestore.DocumentReference;
}

interface AppointmentRecord {
  id: string;
  data: AppointmentData;
}

export interface AdminAppointmentRescheduleDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isSlot(value: unknown): value is TimeSlot {
  return isRecord(value)
    && typeof value.date === "string"
    && typeof value.time === "string"
    && isValidDate(value.date)
    && isValidTime(value.time);
}

function parseAssignedTrainer(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trainerId = value.trim();
  return trainerId && trainerId.length <= 128 ? trainerId : undefined;
}

function parseSingleInput(value: unknown): AdminSingleRescheduleInput | undefined {
  if (!isRecord(value) || typeof value.appointmentId !== "string" || !isSlot(value.slot)) return undefined;
  const appointmentId = value.appointmentId.trim();
  const assignedTrainer = parseAssignedTrainer(value.assignedTrainer);
  if (!appointmentId || appointmentId.length > 256 || assignedTrainer === undefined) return undefined;
  return { appointmentId, slot: value.slot, assignedTrainer };
}

function parseSeriesInput(value: unknown): AdminSeriesReplaceInput | undefined {
  if (!isRecord(value)
    || typeof value.appointmentId !== "string"
    || !isSlot(value.startSlot)
    || typeof value.endDate !== "string"
    || !isValidDate(value.endDate)) {
    return undefined;
  }
  const appointmentId = value.appointmentId.trim();
  const assignedTrainer = parseAssignedTrainer(value.assignedTrainer);
  if (!appointmentId || appointmentId.length > 256 || assignedTrainer === undefined) return undefined;
  return {
    appointmentId,
    startSlot: value.startSlot,
    endDate: value.endDate,
    assignedTrainer,
  };
}

function durationMinutes(appointment: AppointmentData): 30 | 45 | 60 | undefined {
  const duration = Number(appointment.duration);
  return duration === 30 || duration === 45 || duration === 60 ? duration : undefined;
}

function occupancyKeys(slot: TimeSlot, duration: number): string[] {
  return getSlotBlocks(slot.time, duration).map((time) => slotOccupancyDocId(slot.date, time));
}

function keysForAppointment(appointment: AppointmentData): string[] {
  const slot = getAppointmentEffectiveSlot(appointment);
  const duration = durationMinutes(appointment);
  return slot && isSlot(slot) && duration ? occupancyKeys(slot, duration) : [];
}

function slotsMatch(left: TimeSlot | undefined, right: TimeSlot): boolean {
  return left?.date === right.date && left.time === right.time;
}

function throwHttps(
  code: "invalid-argument" | "failed-precondition" | "permission-denied",
  message: string,
  reason: string,
): never {
  throw new HttpsError(code, message, { reason });
}

async function requireAdminForRequest(
  deps: AdminAppointmentRescheduleDeps,
  request: CallableRequest,
): Promise<string> {
  const auth = request.auth;
  if (!auth) {
    throwHttps("permission-denied", "Debes iniciar sesion como admin.", "unauthenticated");
  }
  try {
    await deps.requireAdmin(auth.uid);
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "permission-denied") {
      throwHttps("permission-denied", "Permisos insuficientes.", "admin_required");
    }
    throw error;
  }
  return auth.uid;
}

function assertOccupancyCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throwHttps("failed-precondition", "La ocupacion registrada para una franja no es valida.", "invalid_occupancy");
  }
  return value;
}

function assertSchedule(config: Partial<SiteConfig>, slot: TimeSlot, duration: number): SiteConfig {
  const normalized = normalizeSiteConfig(config);
  if (!new Set(generateTimeSlots(normalized)).has(slot.time)
    || !doesSessionFitWithinSchedule(normalized, slot.time, duration)) {
    throwHttps("failed-precondition", "La franja seleccionada no es valida para el horario configurado.", "outside_schedule");
  }
  return normalized;
}

function assertFutureTargetAvailability(input: {
  selectedAppointmentId: string;
  targetSlot: TimeSlot;
  targetKeys: string[];
  status: string;
  maxCapacity: number;
  blockedKeys: Set<string>;
  occupancyByKey: Map<string, unknown>;
  userAppointments: AppointmentRecord[];
}): void {
  if (input.targetKeys.some((key) => input.blockedKeys.has(key))) {
    throwHttps("failed-precondition", "La franja seleccionada esta bloqueada.", "slot_blocked");
  }
  if (input.status === "pending" && input.targetKeys.some((key) => {
    const count = assertOccupancyCount(input.occupancyByKey.get(key));
    return count >= input.maxCapacity;
  })) {
    throwHttps("failed-precondition", "La franja seleccionada esta llena.", "slot_full");
  }
  const targetKeySet = new Set(input.targetKeys);
  const hasConflict = input.userAppointments.some((appointment) => {
    if (appointment.id === input.selectedAppointmentId) return false;
    return keysForAppointment(appointment.data).some((key) => targetKeySet.has(key));
  });
  if (hasConflict) {
    throwHttps("failed-precondition", "El cliente ya tiene una cita que se solapa con esta franja.", "appointment_conflict");
  }
}

function buildAbsoluteOccupancyWrites(input: {
  keys: string[];
  deltaByKey: Map<string, number>;
  currentByKey: Map<string, unknown>;
  config: SiteConfig;
  now: Date;
}): Array<{ key: string; date: string; time: string; count: number }> {
  const today = getMadridDateKey(input.now);
  const writes: Array<{ key: string; date: string; time: string; count: number }> = [];
  for (const key of input.keys) {
    const current = assertOccupancyCount(input.currentByKey.get(key));
    const delta = input.deltaByKey.get(key) ?? 0;
    const count = current + delta;
    if (!Number.isInteger(count) || count < 0) {
      throwHttps("failed-precondition", "La ocupacion final calculada para una franja no es valida.", "invalid_occupancy");
    }
    const separator = key.indexOf("_");
    const date = key.slice(0, separator);
    const time = key.slice(separator + 1);
    if (date >= today && count > input.config.maxCapacity) {
      throwHttps("failed-precondition", "La franja seleccionada esta llena.", "slot_full");
    }
    if (delta !== 0) writes.push({ key, date, time, count });
  }
  return writes;
}

function safeCivilDate(appointment: AppointmentData): string | undefined {
  const candidates = [
    appointment.approvedSlot?.date,
    appointment.preferredSlots?.[0]?.date,
    appointment.date,
  ];
  return candidates.find((value): value is string => typeof value === "string" && isValidDate(value));
}

function validEffectiveSlot(appointment: AppointmentData): TimeSlot | undefined {
  const slot = getAppointmentEffectiveSlot(appointment);
  return slot && isSlot(slot) ? slot : undefined;
}

function isHistoricalOccurrence(appointment: AppointmentData, now: Date): boolean {
  const slot = validEffectiveSlot(appointment);
  if (slot) return !classifyMadridCivilSlot(slot, now).isFuture;
  const date = safeCivilDate(appointment);
  return Boolean(date && date < getMadridDateKey(now));
}

function firstIntersection(left: string[], right: Set<string>): string | undefined {
  return left.find((key) => right.has(key));
}

function assertSeriesFutureAvailability(input: {
  desired: Array<{ slot: TimeSlot; keys: string[] }>;
  blockedKeys: Set<string>;
  userAppointments: AppointmentRecord[];
  excludedAppointmentIds: Set<string>;
}): void {
  const desiredKeys = new Set<string>();
  for (const occurrence of input.desired) {
    if (occurrence.keys.some((key) => input.blockedKeys.has(key))) {
      throwHttps("failed-precondition", "Una de las franjas de la serie esta bloqueada.", "slot_blocked");
    }
    if (firstIntersection(occurrence.keys, desiredKeys)) {
      throwHttps("failed-precondition", "Dos sesiones de la serie se solaparian.", "appointment_conflict");
    }
    const hasConflict = input.userAppointments.some((appointment) => {
      if (input.excludedAppointmentIds.has(appointment.id)) return false;
      return Boolean(firstIntersection(keysForAppointment(appointment.data), new Set(occurrence.keys)));
    });
    if (hasConflict) {
      throwHttps("failed-precondition", "El cliente ya tiene una cita que se solapa con la serie.", "appointment_conflict");
    }
    occurrence.keys.forEach((key) => desiredKeys.add(key));
  }
}

function assertFutureReservation(
  appointment: AppointmentData,
  seriesBonoId: string,
  duration: number,
): void {
  if (appointment.bonoId !== seriesBonoId
    || appointment.minutesDeducted !== true
    || appointment.minutesDeductedAmount !== duration
    || typeof appointment.minutesDeductedAt !== "string"
    || !appointment.minutesDeductedAt
    || appointment.minutesRefunded === true
    || Boolean(appointment.minutesRefundedAt)) {
    throwHttps(
      "failed-precondition",
      "Las reservas financieras de la serie no son validas.",
      "invalid_financial_reservation",
    );
  }
}

function historyEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasValidReservedBonoData(bono: BonoData): boolean {
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

function getUsableBonoRemainingMinutes(bono: BonoData): number | undefined {
  const totalMinutes = getBonoTotalMinutes(bono);
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

function copyDefined(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) copy[field] = source[field];
  });
  return copy;
}

async function rescheduleAppointmentFromAdmin(
  deps: AdminAppointmentRescheduleDeps,
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  const adminUid = await requireAdminForRequest(deps, request);
  const input = parseSingleInput(request.data);
  if (!input) {
    throwHttps("invalid-argument", "Los datos de la modificacion no son validos.", "invalid_request");
  }

  const selectedRef = deps.db.collection("appointments").doc(input.appointmentId);
  return deps.db.runTransaction(async (transaction: Transaction) => {
    const selectedSnap = await transaction.get(selectedRef);
    if (!selectedSnap.exists) {
      throwHttps("failed-precondition", "No se ha encontrado la cita indicada.", "appointment_not_found");
    }
    const appointment = selectedSnap.data() as AppointmentData;
    if (appointment.status !== "pending" && appointment.status !== "approved") {
      throwHttps("failed-precondition", "La cita indicada ya no se puede modificar.", "appointment_unavailable");
    }
    if (appointment.recurrenceSeriesId && appointment.status !== "approved") {
      throwHttps("failed-precondition", "La cita recurrente indicada ya no se puede modificar individualmente.", "appointment_unavailable");
    }
    const duration = durationMinutes(appointment);
    if (!duration) {
      throwHttps("failed-precondition", "La duracion de la cita no es valida.", "invalid_duration");
    }

    const currentSlot = getAppointmentEffectiveSlot(appointment);
    const currentTrainer = typeof appointment.assignedTrainer === "string" ? appointment.assignedTrainer : null;
    const trainerChanged = input.assignedTrainer !== currentTrainer;
    const slotChanged = !slotsMatch(currentSlot, input.slot);
    const transactionNow = deps.getNowDate();
    const targetState = classifyMadridCivilSlot(input.slot, transactionNow);
    if (!targetState.isValid) {
      throwHttps("invalid-argument", "La franja seleccionada no tiene un formato valido.", "invalid_slot");
    }

    let oldKeys: string[] = [];
    if (slotChanged && appointment.status === "approved") {
      if (!currentSlot || !isSlot(currentSlot)) {
        throwHttps("failed-precondition", "La cita aprobada no tiene una franja valida.", "invalid_current_slot");
      }
      oldKeys = occupancyKeys(currentSlot, duration);
      if (oldKeys.length === 0) {
        throwHttps("failed-precondition", "La cita aprobada no tiene bloques de ocupacion validos.", "invalid_occupancy");
      }
    }

    const targetKeys = slotChanged ? occupancyKeys(input.slot, duration) : [];
    const occupancyDelta = new Map<string, number>();
    oldKeys.forEach((key) => occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) - 1));
    targetKeys.forEach((key) => occupancyDelta.set(
      key,
      (occupancyDelta.get(key) ?? 0) + (appointment.status === "approved" ? 1 : 0),
    ));
    const occupancyKeysToRead = [...occupancyDelta.keys()].sort();

    const trainerRef = input.assignedTrainer ? deps.db.collection("trainers").doc(input.assignedTrainer) : undefined;
    const recurrenceSeriesId = typeof appointment.recurrenceSeriesId === "string" && appointment.recurrenceSeriesId
      ? appointment.recurrenceSeriesId
      : undefined;
    const recurrenceSeriesRef = recurrenceSeriesId
      ? deps.db.collection("appointment_recurrences").doc(recurrenceSeriesId)
      : undefined;
    const recurrenceOccurrencesQuery = recurrenceSeriesId
      ? deps.db.collection("appointments").where("recurrenceSeriesId", "==", recurrenceSeriesId)
      : undefined;
    const configRef = slotChanged ? deps.db.collection("site_config").doc("main") : undefined;
    const blockedQuery = slotChanged
      ? deps.db.collection("blocked_slots").where("date", "==", input.slot.date)
      : undefined;
    const userAppointmentsQuery = slotChanged
      ? deps.db.collection("appointments")
        .where("userId", "==", appointment.userId)
        .where("status", "in", ["pending", "approved"])
      : undefined;
    const occupancyRefs = occupancyKeysToRead.map((key) => deps.db.collection("slot_occupancy").doc(key));
    const [
      trainerSnap,
      recurrenceSeriesSnap,
      recurrenceOccurrencesSnap,
      configSnap,
      blockedSnap,
      userAppointmentsSnap,
      occupancySnaps,
    ] = await Promise.all([
      trainerRef ? transaction.get(trainerRef) : Promise.resolve(undefined),
      recurrenceSeriesRef ? transaction.get(recurrenceSeriesRef) : Promise.resolve(undefined),
      recurrenceOccurrencesQuery ? transaction.get(recurrenceOccurrencesQuery) : Promise.resolve(undefined),
      configRef ? transaction.get(configRef) : Promise.resolve(undefined),
      blockedQuery ? transaction.get(blockedQuery) : Promise.resolve(undefined),
      userAppointmentsQuery ? transaction.get(userAppointmentsQuery) : Promise.resolve(undefined),
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
    ]);

    if (recurrenceSeriesId) {
      if (!recurrenceSeriesSnap?.exists) {
        throwHttps("failed-precondition", "No se ha encontrado la serie de la cita.", "series_not_found");
      }
      const recurrenceSeries = recurrenceSeriesSnap.data() as RecurrenceSeriesData;
      if (recurrenceSeries.status !== "approved" || recurrenceSeries.userId !== appointment.userId) {
        throwHttps("failed-precondition", "La serie de la cita ya no se puede modificar.", "series_unavailable");
      }
    }

    if (input.assignedTrainer) {
      if (!trainerSnap?.exists) {
        throwHttps("failed-precondition", "No se ha encontrado el entrenador indicado.", "trainer_not_found");
      }
      const trainer = trainerSnap.data() as TrainerData;
      if (trainer.active === false) {
        const currentState = currentSlot ? classifyMadridCivilSlot(currentSlot, transactionNow) : undefined;
        if (trainerChanged || !currentState?.isPast || !targetState.isPast) {
          throwHttps("failed-precondition", "El entrenador seleccionado no esta activo.", "trainer_inactive");
        }
      }
    }

    if (!slotChanged && !trainerChanged) {
      return { success: true, appointmentId: selectedRef.id, changed: false };
    }

    const occupancyByKey = new Map<string, unknown>();
    occupancySnaps.forEach((snap, index) => {
      occupancyByKey.set(occupancyKeysToRead[index], snap.exists ? (snap.data() as SlotOccupancyData).count : 0);
    });
    const blockedKeys = new Set<string>();
    blockedSnap?.docs.forEach((snap) => {
      const data = snap.data() as Partial<TimeSlot>;
      if (typeof data.date === "string" && typeof data.time === "string") {
        blockedKeys.add(slotOccupancyDocId(data.date, data.time));
      }
    });

    const config = slotChanged
      ? assertSchedule(configSnap?.exists ? configSnap.data() as Partial<SiteConfig> : normalizeSiteConfig(), input.slot, duration)
      : undefined;
    const occupancyWrites = slotChanged && config
      ? buildAbsoluteOccupancyWrites({
        keys: occupancyKeysToRead,
        deltaByKey: occupancyDelta,
        currentByKey: occupancyByKey,
        config,
        now: transactionNow,
      })
      : [];
    if (slotChanged && targetState.isFuture && config) {
      assertFutureTargetAvailability({
        selectedAppointmentId: selectedRef.id,
        targetSlot: input.slot,
        targetKeys,
        status: appointment.status,
        maxCapacity: config.maxCapacity,
        blockedKeys,
        occupancyByKey,
        userAppointments: userAppointmentsSnap?.docs.map((snap) => ({
          id: snap.id,
          data: snap.data() as AppointmentData,
        })) ?? [],
      });
    }

    const now = transactionNow.toISOString();
    const patch: Record<string, unknown> = {
      preferredSlots: [input.slot],
      date: input.slot.date,
      time: input.slot.time,
      updatedAt: now,
      modifiedAt: now,
      modifiedBy: adminUid,
    };
    if (appointment.status === "approved") patch.approvedSlot = input.slot;
    if (trainerChanged) patch.assignedTrainer = input.assignedTrainer;
    transaction.set(selectedRef, patch, { merge: true });
    occupancyWrites.forEach((write) => {
      transaction.set(
        deps.db.collection("slot_occupancy").doc(write.key),
        { date: write.date, time: write.time, count: write.count },
        { merge: true },
      );
    });
    if (slotChanged && recurrenceSeriesId && recurrenceSeriesRef && recurrenceSeriesSnap?.exists) {
      const recurrenceSeries = recurrenceSeriesSnap.data() as RecurrenceSeriesData;
      const dates = recurrenceOccurrencesSnap?.docs
        .map((snap) => {
          if (snap.id === selectedRef.id) return input.slot.date;
          const data = snap.data() as AppointmentData;
          return validEffectiveSlot(data)?.date ?? safeCivilDate(data);
        })
        .filter((date): date is string => typeof date === "string") ?? [];
      const effectiveEndDate = dates.sort().at(-1);
      const seriesPatch: Record<string, unknown> = {
        updatedAt: now,
        lastRescheduledAt: now,
        lastRescheduledByUid: adminUid,
        lastRescheduleScope: "single",
        lastRescheduleAppointmentId: selectedRef.id,
      };
      if (effectiveEndDate && recurrenceSeries.endDate !== effectiveEndDate) {
        seriesPatch.endDate = effectiveEndDate;
      }
      transaction.set(recurrenceSeriesRef, seriesPatch, { merge: true });
    }
    transaction.create(deps.db.collection("activity_logs").doc(), {
      action: targetState.isFuture ? "admin_appointment_rescheduled_future" : "admin_appointment_rescheduled_historical",
      adminUid,
      appointmentId: selectedRef.id,
      recurrenceSeriesId: appointment.recurrenceSeriesId ?? null,
      slot: input.slot,
      createdAt: now,
      timestamp: now,
    });
    return { success: true, appointmentId: selectedRef.id };
  });
}

async function replaceRecurringSeriesScheduleFromAdmin(
  deps: AdminAppointmentRescheduleDeps,
  request: CallableRequest,
): Promise<Record<string, unknown>> {
  const adminUid = await requireAdminForRequest(deps, request);
  const input = parseSeriesInput(request.data);
  if (!input) {
    throwHttps("invalid-argument", "Los datos de la modificacion no son validos.", "invalid_request");
  }

  const selectedRef = deps.db.collection("appointments").doc(input.appointmentId);
  return deps.db.runTransaction(async (transaction: Transaction) => {
    // Read the selected document first. It identifies the series only; it is never an anchor.
    const selectedSnap = await transaction.get(selectedRef);
    if (!selectedSnap.exists) {
      throwHttps("failed-precondition", "No se ha encontrado la cita indicada.", "appointment_not_found");
    }
    const selected = selectedSnap.data() as AppointmentData;
    if (typeof selected.recurrenceSeriesId !== "string" || !selected.recurrenceSeriesId) {
      throwHttps("failed-precondition", "La cita indicada no pertenece a una serie recurrente.", "not_recurring");
    }

    const seriesId = selected.recurrenceSeriesId;
    const seriesRef = deps.db.collection("appointment_recurrences").doc(seriesId);
    const seriesSnap = await transaction.get(seriesRef);
    if (!seriesSnap.exists) {
      throwHttps("failed-precondition", "No se ha encontrado la serie indicada.", "series_not_found");
    }
    const series = seriesSnap.data() as RecurrenceSeriesData;
    if (series.status !== "approved") {
      throwHttps("failed-precondition", "La serie indicada ya no se puede modificar.", "series_unavailable");
    }
    if (typeof series.userId !== "string" || !series.userId) {
      throwHttps("failed-precondition", "Los datos de la serie no son validos.", "series_owner_mismatch");
    }
    if (!Number.isInteger(series.intervalDays) || series.intervalDays < 1) {
      throwHttps("failed-precondition", "El intervalo de la serie no es valido.", "invalid_interval");
    }
    const seriesDuration = durationMinutes({ duration: series.duration } as AppointmentData);
    if (!seriesDuration) {
      throwHttps("failed-precondition", "La duracion de la serie no es valida.", "invalid_duration");
    }
    if (typeof series.bonoId !== "string" || !series.bonoId) {
      throwHttps("failed-precondition", "La reserva financiera de la serie no es valida.", "invalid_bono");
    }

    const occurrencesQuery = deps.db.collection("appointments").where("recurrenceSeriesId", "==", seriesId);
    const userRef = deps.db.collection("users").doc(series.userId);
    const configRef = deps.db.collection("site_config").doc("main");
    const trainerRef = input.assignedTrainer ? deps.db.collection("trainers").doc(input.assignedTrainer) : undefined;
    const userAppointmentsQuery = deps.db.collection("appointments")
      .where("userId", "==", series.userId)
      .where("status", "in", ["pending", "approved"]);
    const [occurrencesSnap, userSnap, trainerSnap, configSnap, userAppointmentsSnap] = await Promise.all([
      transaction.get(occurrencesQuery),
      transaction.get(userRef),
      trainerRef ? transaction.get(trainerRef) : Promise.resolve(undefined),
      transaction.get(configRef),
      transaction.get(userAppointmentsQuery),
    ]);

    if (!userSnap.exists) {
      throwHttps("failed-precondition", "No se ha encontrado el cliente de la serie.", "user_not_found");
    }
    if (input.assignedTrainer) {
      if (!trainerSnap?.exists) {
        throwHttps("failed-precondition", "No se ha encontrado el entrenador indicado.", "trainer_not_found");
      }
      if ((trainerSnap.data() as TrainerData).active === false) {
        throwHttps("failed-precondition", "El entrenador seleccionado no esta activo.", "trainer_inactive");
      }
    }

    // The exact series bono cannot be known until the series has been read.
    const bonoRef = deps.db.collection("bonos").doc(series.bonoId);
    const bonoSnap = await transaction.get(bonoRef);
    if (!bonoSnap.exists) {
      throwHttps("failed-precondition", "No se ha encontrado el bono reservado de la serie.", "invalid_bono");
    }
    const bono = { id: bonoSnap.id, ...bonoSnap.data() } as BonoData & { id: string };
    if (typeof bono.userId !== "string" || bono.userId !== series.userId || !hasValidReservedBonoData(bono)) {
      throwHttps("failed-precondition", "La reserva financiera de la serie no es valida.", "invalid_bono");
    }
    const usableRemainingMinutes = getUsableBonoRemainingMinutes(bono);
    const totalBonoMinutes = getBonoTotalMinutes(bono);
    if (usableRemainingMinutes === undefined || !isNonNegativeInteger(totalBonoMinutes)) {
      throwHttps(
        "failed-precondition",
        "La reserva financiera de la serie no puede aplicarse con exactitud.",
        "invalid_financial_reservation",
      );
    }

    const nowDate = deps.getNowDate();
    const now = nowDate.toISOString();
    const today = getMadridDateKey(nowDate);
    const occurrences: TransactionAppointmentRecord[] = occurrencesSnap.docs.map((snap) => ({
      id: snap.id,
      ref: snap.ref,
      data: snap.data() as AppointmentData,
    }));
    if (!occurrences.some((occurrence) => occurrence.id === selectedRef.id)) {
      throwHttps("failed-precondition", "La cita indicada no pertenece a la serie actual.", "series_membership_mismatch");
    }

    // Duplicate detection remains global, including immutable/cancelled records.
    const seenIndexes = new Set<number>();
    let maxExistingIndex = -1;
    occurrences.forEach((occurrence) => {
      const index = occurrence.data.recurrenceIndex;
      if (!Number.isInteger(index)) return;
      if (seenIndexes.has(index as number)) {
        throwHttps("failed-precondition", "La serie contiene indices de recurrencia duplicados.", "duplicate_recurrence_index");
      }
      seenIndexes.add(index as number);
      if ((index as number) >= 0) maxExistingIndex = Math.max(maxExistingIndex, index as number);
    });

    const futureApproved: Array<{
      occurrence: TransactionAppointmentRecord;
      slot: TimeSlot;
      index: number;
      oldKeys: string[];
    }> = [];
    const hasHistoricalOccurrence = occurrences.some((occurrence) => isHistoricalOccurrence(occurrence.data, nowDate));
    for (const occurrence of occurrences) {
      if (occurrence.data.status !== "approved") continue;
      const slot = validEffectiveSlot(occurrence.data);
      if (!slot) {
        const safeDate = safeCivilDate(occurrence.data);
        if (safeDate && safeDate < today) continue;
        throwHttps("failed-precondition", "Una cita aprobada de la serie no tiene una franja valida.", "invalid_occurrence_slot");
      }
      if (!classifyMadridCivilSlot(slot, nowDate).isFuture) continue;
      const index = occurrence.data.recurrenceIndex;
      const duration = durationMinutes(occurrence.data);
      if (occurrence.data.recurrenceSeriesId !== seriesId || occurrence.data.userId !== series.userId) {
        throwHttps("failed-precondition", "Una cita futura no coincide con los datos de la serie.", "series_owner_mismatch");
      }
      if (!Number.isInteger(index) || (index as number) < 0 || !duration || duration !== seriesDuration) {
        throwHttps("failed-precondition", "Una cita futura de la serie contiene datos no validos.", "invalid_occurrence_data");
      }
      assertFutureReservation(occurrence.data, series.bonoId, seriesDuration);
      const oldKeys = occupancyKeys(slot, duration);
      if (oldKeys.length === 0) {
        throwHttps("failed-precondition", "Una cita futura no tiene bloques de ocupacion validos.", "invalid_occupancy");
      }
      futureApproved.push({ occurrence, slot, index: index as number, oldKeys });
    }
    futureApproved.sort((left, right) => left.index - right.index);
    if (futureApproved.length === 0) {
      throwHttps("failed-precondition", "La serie no tiene citas aprobadas futuras para modificar.", "no_future_approved_occurrences");
    }

    const generatedDates = generateRecurringOccurrenceDates(input.startSlot.date, series.intervalDays, input.endDate);
    if (generatedDates.length < 2 || generatedDates.length > MAX_RECURRING_OCCURRENCES) {
      throwHttps("failed-precondition", "La serie debe contener entre dos y el maximo de sesiones permitido.", "invalid_series_length");
    }
    if (generatedDates.at(-1) !== input.endDate) {
      throwHttps("failed-precondition", "La fecha final debe coincidir con la cadencia de la serie.", "invalid_end_date");
    }
    const desired = generatedDates.map((date) => {
      const slot = { date, time: input.startSlot.time };
      if (!classifyMadridCivilSlot(slot, nowDate).isFuture) {
        throwHttps("failed-precondition", "Todas las nuevas sesiones deben estar en el futuro.", "slot_not_future");
      }
      return { slot, keys: occupancyKeys(slot, seriesDuration) };
    });
    const config = assertSchedule(
      configSnap.exists ? configSnap.data() as Partial<SiteConfig> : normalizeSiteConfig(),
      input.startSlot,
      seriesDuration,
    );

    const reused = futureApproved.slice(0, desired.length);
    const cancelled = futureApproved.slice(desired.length);
    const newCount = Math.max(0, desired.length - futureApproved.length);
    const oldFutureReservedMinutes = futureApproved.length * seriesDuration;
    const newFutureMinutes = desired.length * seriesDuration;
    const minutesDelta = newFutureMinutes - oldFutureReservedMinutes;

    const occupancyDelta = new Map<string, number>();
    futureApproved.forEach((occurrence) => occurrence.oldKeys.forEach((key) => {
      occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) - 1);
    }));
    desired.forEach((occurrence) => occurrence.keys.forEach((key) => {
      occupancyDelta.set(key, (occupancyDelta.get(key) ?? 0) + 1);
    }));
    const occupancyKeysToRead = [...occupancyDelta.keys()].sort();
    const occupancyRefs = occupancyKeysToRead.map((key) => deps.db.collection("slot_occupancy").doc(key));
    const blockedQuery = deps.db.collection("blocked_slots")
      .where("date", ">=", generatedDates[0])
      .where("date", "<=", generatedDates.at(-1));

    // Exact refs are now known. Complete every remaining read before writing anything.
    const [occupancySnaps, blockedSnap] = await Promise.all([
      Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
      transaction.get(blockedQuery),
    ]);
    const occupancyByKey = new Map<string, unknown>();
    occupancySnaps.forEach((snap, index) => {
      occupancyByKey.set(occupancyKeysToRead[index], snap.exists ? (snap.data() as SlotOccupancyData).count : 0);
    });
    const blockedKeys = new Set<string>();
    blockedSnap.docs.forEach((snap) => {
      const data = snap.data() as Partial<TimeSlot>;
      if (typeof data.date === "string" && typeof data.time === "string") {
        blockedKeys.add(slotOccupancyDocId(data.date, data.time));
      }
    });
    const oldFutureIds = new Set(futureApproved.map((occurrence) => occurrence.occurrence.id));
    assertSeriesFutureAvailability({
      desired,
      blockedKeys,
      excludedAppointmentIds: oldFutureIds,
      userAppointments: userAppointmentsSnap.docs.map((snap) => ({
        id: snap.id,
        data: snap.data() as AppointmentData,
      })),
    });
    const occupancyWrites = buildAbsoluteOccupancyWrites({
      keys: occupancyKeysToRead,
      deltaByKey: occupancyDelta,
      currentByKey: occupancyByKey,
      config,
      now: nowDate,
    });

    const createdRefs = Array.from({ length: newCount }, () => deps.db.collection("appointments").doc());
    const histories = historyEntries(bono.historial);
    const refundPatches = new Map<string, Record<string, unknown>>();
    let bonoPatch: Record<string, unknown> | undefined;
    if (minutesDelta > 0) {
      if (bono.estado !== "activo" || isBonoExpiredAt(bono, nowDate)) {
        throwHttps("failed-precondition", "El bono reservado no esta disponible.", "bono_unavailable");
      }
      const deduction = calculateAppointmentDeduction(bono, minutesDelta, now);
      if (!deduction.ok) {
        throwHttps(
          "failed-precondition",
          "El bono reservado no tiene minutos suficientes.",
          deduction.reason === "insufficient-minutes" ? "insufficient_bono_minutes" : "bono_unavailable",
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
      const exactRefundRemainingMinutes = usableRemainingMinutes - minutesDelta;
      if (!isNonNegativeInteger(exactRefundRemainingMinutes) || exactRefundRemainingMinutes > totalBonoMinutes) {
        throwHttps(
          "failed-precondition",
          "La devolucion de la serie no puede aplicarse con exactitud.",
          "invalid_financial_reservation",
        );
      }
      let workingBono: LifecycleBono = { ...bono, minutosRestantes: usableRemainingMinutes };
      cancelled.forEach((occurrence) => {
        const refund = calculateAppointmentRefund(workingBono, occurrence.occurrence.data as LifecycleAppointment, now);
        if (!refund.ok) {
          throwHttps("failed-precondition", "Las reservas financieras de la serie no son validas.", "invalid_financial_reservation");
        }
        workingBono = {
          ...workingBono,
          minutosRestantes: refund.remainingMinutes,
          estado: refund.bonoStatus,
        };
        refundPatches.set(occurrence.occurrence.id, {
          minutesRefunded: refund.minutesRefunded,
          minutesRefundedAmount: refund.minutesRefundedAmount,
          minutesRefundedAt: refund.minutesRefundedAt,
          minutesRefundReason: "admin_series_schedule_reduction",
        });
      });
      if (workingBono.minutosRestantes !== exactRefundRemainingMinutes) {
        throwHttps(
          "failed-precondition",
          "La devolucion de la serie no puede aplicarse con exactitud.",
          "invalid_financial_reservation",
        );
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
            appointmentId: occurrence.occurrence.id,
            accion: "devolucion_cita",
          })),
        ],
      };
    }

    // All reads and validation are complete. Only writes follow this point.
    reused.forEach((occurrence, index) => {
      const patch: Record<string, unknown> = {
        preferredSlots: [desired[index].slot],
        approvedSlot: desired[index].slot,
        date: desired[index].slot.date,
        time: desired[index].slot.time,
        updatedAt: now,
        modifiedAt: now,
        modifiedBy: adminUid,
      };
      const existingTrainer = typeof occurrence.occurrence.data.assignedTrainer === "string"
        ? occurrence.occurrence.data.assignedTrainer
        : null;
      if (existingTrainer !== input.assignedTrainer) patch.assignedTrainer = input.assignedTrainer;
      transaction.set(occurrence.occurrence.ref, patch, { merge: true });
    });
    cancelled.forEach((occurrence) => {
      transaction.set(occurrence.occurrence.ref, {
        status: "cancelled",
        cancelledBy: "admin",
        cancelledAt: now,
        cancellationReason: "admin_series_schedule_reduction",
        updatedAt: now,
        ...refundPatches.get(occurrence.occurrence.id),
      }, { merge: true });
    });
    const identityTemplate = futureApproved[0].occurrence.data;
    createdRefs.forEach((ref, index) => {
      const desiredOccurrence = desired[reused.length + index];
      transaction.create(ref, {
        ...copyDefined(identityTemplate, [
          "name",
          "email",
          "phone",
          "serviceType",
          "sessionType",
          "reason",
          "createdByAdmin",
          "createdByAdminUid",
        ]),
        userId: identityTemplate.userId,
        duration: String(seriesDuration),
        preferredSlots: [desiredOccurrence.slot],
        approvedSlot: desiredOccurrence.slot,
        date: desiredOccurrence.slot.date,
        time: desiredOccurrence.slot.time,
        status: "approved",
        assignedTrainer: input.assignedTrainer,
        recurrenceSeriesId: seriesId,
        recurrenceIndex: maxExistingIndex + index + 1,
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

    const historicalApproved = occurrences.filter((occurrence) =>
      occurrence.data.status === "approved" && !oldFutureIds.has(occurrence.id));
    const totalMinutes = historicalApproved.reduce(
      (total, occurrence) => total + (durationMinutes(occurrence.data) ?? seriesDuration),
      desired.length * seriesDuration,
    );
    const seriesPatch: Record<string, unknown> = {
      occurrenceCount: historicalApproved.length + desired.length,
      totalMinutes,
      futureOccurrenceCount: desired.length,
      futureStartDate: desired[0].slot.date,
      futureStartTime: desired[0].slot.time,
      futureEndDate: desired.at(-1)?.slot.date,
      endDate: input.endDate,
      updatedAt: now,
      lastRescheduledAt: now,
      lastRescheduledByUid: adminUid,
      lastRescheduleScope: "series",
      lastScheduleReplacementAt: now,
      lastScheduleReplacementByUid: adminUid,
    };
    const existingSeriesTrainer = typeof series.assignedTrainer === "string" ? series.assignedTrainer : null;
    if (existingSeriesTrainer !== input.assignedTrainer) seriesPatch.assignedTrainer = input.assignedTrainer;
    if (!hasHistoricalOccurrence) {
      seriesPatch.startDate = input.startSlot.date;
      seriesPatch.startTime = input.startSlot.time;
    }
    transaction.set(seriesRef, seriesPatch, { merge: true });
    transaction.create(deps.db.collection("activity_logs").doc(), {
      action: "recurring_series_schedule_replaced",
      adminUid,
      seriesId,
      appointmentId: selectedRef.id,
      reusedAppointmentIds: reused.map((occurrence) => occurrence.occurrence.id),
      cancelledAppointmentIds: cancelled.map((occurrence) => occurrence.occurrence.id),
      createdAppointmentIds: createdRefs.map((ref) => ref.id),
      oldFutureCount: futureApproved.length,
      newFutureCount: desired.length,
      oldFutureReservedMinutes,
      newFutureMinutes,
      minutesDelta,
      createdAt: now,
      timestamp: now,
    });
    return {
      success: true,
      seriesId,
      appointmentId: selectedRef.id,
      reusedAppointmentIds: reused.map((occurrence) => occurrence.occurrence.id),
      cancelledAppointmentIds: cancelled.map((occurrence) => occurrence.occurrence.id),
      createdAppointmentIds: createdRefs.map((ref) => ref.id),
      oldFutureCount: futureApproved.length,
      newFutureCount: desired.length,
      minutesDelta,
    };
  });
}

export function createAdminAppointmentRescheduleHandlers(deps: AdminAppointmentRescheduleDeps) {
  return {
    rescheduleAppointmentFromAdmin: (request: CallableRequest) => rescheduleAppointmentFromAdmin(deps, request),
    replaceRecurringSeriesScheduleFromAdmin: (request: CallableRequest) =>
      replaceRecurringSeriesScheduleFromAdmin(deps, request),
  };
}
