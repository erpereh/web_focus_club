import { FieldValue, Firestore, Transaction } from "firebase-admin/firestore";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  getCanonicalSlotBlocks,
  madridCivilSlotToInstant,
  slotOccupancyDocId,
  SAME_DAY_CHANGE_MESSAGE,
  SAME_DAY_CHANGE_NOT_ALLOWED,
  seriesHasSameDayOccurrence,
} from "./appointmentLifecycle.js";
import {
  collectRecurringOccupancyKeys,
  MAX_RECURRING_OCCURRENCES,
  generateRecurringOccurrenceDates,
  parseClientRecurringAppointmentsData,
  parseRecurringAppointmentsData,
  planRecurringAppointments,
  planSeriesMinutesRefund,
  validateReservedSeriesMinutes,
  buildPendingSeriesOccurrencePatch,
  SERIES_CHANGED_MESSAGE,
} from "./recurringAppointments.js";
import {
  doesSessionFitWithinSchedule,
  normalizeSiteConfig,
  type SiteConfig,
} from "./siteConfig.js";
import { newNotificationOperation, sessionsOf, writeNotificationOutbox } from "./notifications/outbox.js";
import { parseOccupancyCount } from "./slotOccupancy.js";
import {
  type AdminRestriction,
  authorizeAdminOverride,
  bookingPayloadHash,
  collectAdminSlotRestrictions,
  isValidAdminSlotTime,
  parseAdminOverrideRequest,
  parseRequestId,
  readIdempotencyMarker,
  writeIdempotencyMarker,
} from "./adminBookingOverrides.js";
import {
  calculateActiveSeriesMetadata,
  isActiveOccurrenceStatus,
  isHistoricalReplacementOccurrence,
} from "./recurringScheduleReplacement.js";

type HttpsCode = "invalid-argument" | "failed-precondition" | "permission-denied";

interface TimeSlot {
  date: string;
  time: string;
}

interface SeriesAppointment {
  userId: string;
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  duration: "30" | "45" | "60";
  preferredSlots: TimeSlot[];
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  date?: string;
  time?: string;
  approvedSlot?: TimeSlot;
  assignedTrainer?: string;
  sessionType?: string;
  createdByAdmin?: boolean;
  createdByAdminUid?: string;
  bonoId?: string;
  minutesDeducted?: boolean;
  minutesDeductedAmount?: number;
  minutesDeductedAt?: string;
  minutesRefunded?: boolean;
  minutesRefundedAmount?: number;
  minutesRefundedAt?: string | null;
  minutesRefundReason?: string | null;
  recurrenceSeriesId?: string;
  recurrenceIndex?: number;
  notificationOperationId?: string;
  createdAt: string;
  updatedAt?: string;
}

interface RecurrenceSeriesDoc {
  userId: string;
  serviceType: string;
  duration: string;
  assignedTrainer?: string;
  startDate: string;
  startTime: string;
  intervalDays: number;
  endDate: string;
  occurrenceCount: number;
  totalMinutes: number;
  bonoId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  origin: "admin" | "client";
}

interface BonoDoc {
  id?: string;
  userId: string;
  minutosTotales?: number;
  minutosRestantes?: number;
  fechaExpiracion?: string;
  estado: "activo" | "agotado" | "expirado" | "eliminado";
}

interface UserProfile {
  email: string;
  name: string;
  phone?: string;
  role?: string;
}

interface TrainerDoc {
  uid: string;
  name: string;
  active?: boolean;
}

interface ServiceDoc {
  title?: string;
  active?: boolean;
}

interface SlotOccupancy {
  date: string;
  time: string;
  count: number;
}

export interface RecurringSeriesDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<{ email?: string }>;
  getNowDate: () => Date;
  appointmentSlotKeys: (appointment: { approvedSlot?: TimeSlot; preferredSlots?: TimeSlot[]; duration: string }) => Set<string>;
  defaultServiceType: string;
}

function throwHttps(code: HttpsCode, message: string, details?: Record<string, unknown>): never {
  throw new HttpsError(code, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function seriesIdFrom(data: unknown): string {
  if (!isRecord(data) || typeof data.seriesId !== "string" || !data.seriesId.trim()) {
    throwHttps("invalid-argument", "El identificador de la serie no es valido.");
  }
  return data.seriesId.trim();
}

function optionalText(data: Record<string, unknown>, field: string, maxLength: number): string {
  if (data[field] === undefined || data[field] === null) return "";
  if (typeof data[field] !== "string") {
    throwHttps("invalid-argument", `El campo ${field} no es valido.`);
  }
  const text = data[field].trim();
  if (text.length > maxLength) {
    throwHttps("invalid-argument", `El campo ${field} es demasiado largo.`);
  }
  return text;
}

function isTimeSlot(value: unknown): value is TimeSlot {
  return isRecord(value)
    && typeof value.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.time === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time);
}

function pendingOccurrenceSlot(appointment: SeriesAppointment): TimeSlot | undefined {
  const preferred = appointment.preferredSlots?.[0];
  if (isTimeSlot(preferred)) return preferred;
  const legacy = { date: appointment.date, time: appointment.time };
  return isTimeSlot(legacy) ? legacy : undefined;
}

function validDuration(value: unknown): value is 30 | 45 | 60 {
  return value === 30 || value === 45 || value === 60;
}

function assertOccupancyCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throwHttps("failed-precondition", "La ocupacion registrada para una franja no es valida.", {
      reason: "invalid_occupancy",
    });
  }
  return value;
}

type SeriesChangedReason =
  | "series_without_bono"
  | "invalid_series_duration"
  | "invalid_active_count"
  | "invalid_occurrence_index"
  | "occurrence_owner_mismatch"
  | "occurrence_duration_mismatch";

/** Same message as always (web and app show it as is); the reason pinpoints the failed check. */
function seriesChanged(reason: SeriesChangedReason): never {
  throwHttps("failed-precondition", SERIES_CHANGED_MESSAGE, { reason });
}

function assertSeriesOccurrencesStructure(
  occurrences: Array<{ data: SeriesAppointment }>,
  series: Pick<RecurrenceSeriesDoc, "userId">,
  seriesId: string,
  durationMinutes: number,
): void {
  const seenIndexes = new Set<number>();
  occurrences.forEach((occurrence) => {
    const index = occurrence.data.recurrenceIndex;
    if (!Number.isInteger(index) || (index as number) < 0 || seenIndexes.has(index as number)) {
      seriesChanged("invalid_occurrence_index");
    }
    if (occurrence.data.userId !== series.userId || occurrence.data.recurrenceSeriesId !== seriesId) {
      seriesChanged("occurrence_owner_mismatch");
    }
    if (Number(occurrence.data.duration) !== durationMinutes) seriesChanged("occurrence_duration_mismatch");
    seenIndexes.add(index as number);
  });
}

export function createRecurringSeriesHandlers(deps: RecurringSeriesDeps) {
  const { db, requireAdmin, getNowDate, appointmentSlotKeys, defaultServiceType } = deps;

  async function loadServiceAndTrainer(
    transaction: Transaction,
    serviceType: string,
    assignedTrainer: string,
    requireTrainer: boolean,
  ) {
    const trainerRef = assignedTrainer ? db.collection("trainers").doc(assignedTrainer) : null;
    const serviceRef = serviceType && !serviceType.includes("/")
      ? db.collection("services").doc(serviceType)
      : null;
    const serviceTitleQuery = db.collection("services").where("title", "==", serviceType).limit(1);
    const [trainerSnap, serviceIdSnap, serviceTitleSnap] = await Promise.all([
      trainerRef ? transaction.get(trainerRef) : Promise.resolve(undefined),
      serviceRef ? transaction.get(serviceRef) : Promise.resolve(undefined),
      transaction.get(serviceTitleQuery),
    ]);

    if (requireTrainer) {
      if (!trainerSnap?.exists) {
        throwHttps("failed-precondition", "No se ha encontrado el entrenador indicado.");
      }
      const trainer = trainerSnap.data() as TrainerDoc;
      if (trainer.active === false) {
        throwHttps("failed-precondition", "El entrenador seleccionado no esta activo.");
      }
    } else if (assignedTrainer) {
      if (!trainerSnap?.exists) {
        throwHttps("failed-precondition", "No se ha encontrado el entrenador indicado.");
      }
      const trainer = trainerSnap.data() as TrainerDoc;
      if (trainer.active === false) {
        throwHttps("failed-precondition", "El entrenador seleccionado no esta activo.");
      }
    }

    const service = serviceIdSnap?.exists
      ? serviceIdSnap.data() as ServiceDoc
      : serviceTitleSnap.docs[0]?.data() as ServiceDoc | undefined;
    if (!service) {
      throwHttps("failed-precondition", "No se ha encontrado el servicio seleccionado.");
    }
    if (service.active === false) {
      throwHttps("failed-precondition", "El servicio seleccionado no esta activo.");
    }
    return { service };
  }

  return {
    createRecurringAppointmentsFromAdmin: async (request: CallableRequest) => {
      if (!request.auth) {
        throwHttps("permission-denied", "Debes iniciar sesion como admin.");
      }
      await requireAdmin(request.auth.uid);
      const adminUid = request.auth.uid;
      const adminEmail = request.auth.token.email ?? "";
      if (isRecord(request.data) && request.data.appointmentType === "nutrition") {
        throwHttps("invalid-argument", "Las consultas de nutrición no pueden ser recurrentes.", {
          reason: "nutrition_not_recurring",
        });
      }
      const parsed = parseRecurringAppointmentsData(request.data);
      if (!parsed.ok) throwHttps("invalid-argument", parsed.message);
      const input = parsed.value;
      if (!input.userId) throwHttps("invalid-argument", "El campo cliente es obligatorio.");
      if (!isValidAdminSlotTime(input.startTime, input.durationMinutes)) {
        throwHttps("invalid-argument", "La fecha u hora no tiene un formato valido.");
      }
      const requestData = request.data as Record<string, unknown>;
      const requestId = parseRequestId(requestData.requestId);
      const overrideRequest = parseAdminOverrideRequest(requestData);
      const payloadHash = bookingPayloadHash({ ...input, kind: "series" });

      const occurrenceDates = generateRecurringOccurrenceDates(input.startDate, input.intervalDays, input.endDate);
      if (occurrenceDates.length === 0) {
        throwHttps("failed-precondition", "La serie debe incluir al menos una sesion.");
      }
      if (occurrenceDates.length > MAX_RECURRING_OCCURRENCES) {
        throwHttps("failed-precondition", `La serie no puede superar ${MAX_RECURRING_OCCURRENCES} sesiones.`);
      }
      const occupancyKeys = collectRecurringOccupancyKeys(occurrenceDates, input.startTime, input.durationMinutes);
      const seriesRef = db.collection("appointment_recurrences").doc();
      const appointmentRefs = occurrenceDates.map(() => db.collection("appointments").doc());
      const occupancyRefs = occupancyKeys.map((key) => db.collection("slot_occupancy").doc(key));
      const userRef = db.collection("users").doc(input.userId);
      const siteConfigRef = db.collection("site_config").doc("main");
      const blockedSlotsQuery = db.collection("blocked_slots")
        .where("date", ">=", input.startDate)
        .where("date", "<=", input.endDate);
      const userAppointmentsQuery = db.collection("appointments")
        .where("userId", "==", input.userId)
        .where("status", "in", ["pending", "approved"]);
      const bonosQuery = db.collection("bonos")
        .where("userId", "==", input.userId)
        .where("estado", "==", "activo");

      const result = await db.runTransaction(async (transaction) => {
        const marker = await readIdempotencyMarker(transaction, db, { requestId, adminUid, kind: "series", payloadHash });
        if (marker.previous) return { ...marker.previous, replayed: true };
        const [
          userSnap,
          siteConfigSnap,
          blockedSlotsSnap,
          userAppointmentsSnap,
          bonosSnap,
          occupancySnaps,
        ] = await Promise.all([
          transaction.get(userRef),
          transaction.get(siteConfigRef),
          transaction.get(blockedSlotsQuery),
          transaction.get(userAppointmentsQuery),
          transaction.get(bonosQuery),
          Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
        ]);
        const { service } = await loadServiceAndTrainer(transaction, input.serviceType, input.assignedTrainer, true);

        if (!userSnap.exists) {
          throwHttps("failed-precondition", "No se ha encontrado el cliente indicado.");
        }
        const userProfile = userSnap.data() as UserProfile;
        if (!userProfile.email || !userProfile.name) {
          throwHttps("failed-precondition", "El perfil del cliente no esta completo.");
        }

        const config = siteConfigSnap.exists
          ? normalizeSiteConfig(siteConfigSnap.data() as Partial<SiteConfig>)
          : normalizeSiteConfig();
        const blockedKeys = new Set<string>();
        blockedSlotsSnap.docs.forEach((docSnap) => {
          const blocked = docSnap.data() as TimeSlot;
          if (typeof blocked.date === "string" && typeof blocked.time === "string") {
            blockedKeys.add(slotOccupancyDocId(blocked.date, blocked.time));
          }
        });
        const occupancyByKey = new Map<string, number>();
        occupancySnaps.forEach((snap, index) => {
          const occupancy = snap.exists ? snap.data() as SlotOccupancy : undefined;
          const count = occupancy ? parseOccupancyCount(occupancy.count) : 0;
          if (count === undefined) {
            // A corrupt counter must be detected, never read as free capacity.
            throwHttps("failed-precondition", "La ocupación registrada no es válida.", { reason: "invalid_occupancy" });
          }
          occupancyByKey.set(occupancyKeys[index], count);
        });
        const userSlotKeys = new Set<string>();
        userAppointmentsSnap.docs.forEach((docSnap) => {
          appointmentSlotKeys(docSnap.data() as SeriesAppointment).forEach((key) => userSlotKeys.add(key));
        });
        const activeBonos = bonosSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as BonoDoc & { id: string }));

        const nowDate = getNowDate();
        const plan = planRecurringAppointments({
          startDate: input.startDate,
          startTime: input.startTime,
          endDate: input.endDate,
          intervalDays: input.intervalDays,
          durationMinutes: input.durationMinutes,
          now: nowDate,
          siteConfig: config,
          occupancyByKey,
          blockedKeys,
          userSlotKeys,
          activeBonos,
          skipAvailabilityChecks: true,
        });
        if (!plan.ok) throwHttps("failed-precondition", plan.message);

        // Availability restrictions are collected for every date (the admin may
        // confirm them); overlaps and bono rules stay hard inside the plan.
        const restrictions = occurrenceDates.flatMap((date) => {
          const blockedTimes = new Set<string>();
          const occupancyByTime = new Map<string, number>();
          getCanonicalSlotBlocks(input.startTime, input.durationMinutes).forEach((time) => {
            const key = slotOccupancyDocId(date, time);
            if (blockedKeys.has(key)) blockedTimes.add(time);
            occupancyByTime.set(time, occupancyByKey.get(key) ?? 0);
          });
          return collectAdminSlotRestrictions(
            { config, blockedTimes, occupancyByTime },
            { slot: { date, time: input.startTime }, durationMinutes: input.durationMinutes, now: nowDate },
          ).restrictions;
        });
        const now = nowDate.toISOString();
        const adminOverride = authorizeAdminOverride({
          restrictions,
          request: overrideRequest,
          status: "approved",
          adminUid,
          adminEmail,
          now,
        });
        const bonoRef = db.collection("bonos").doc(plan.writes.bono.bonoId);
        const historialEntries = plan.writes.dates.map((date, index) => ({
          fecha: now,
          tipo: input.serviceType,
          duracion: input.duration,
          appointmentId: appointmentRefs[index].id,
          accion: "descuento_cita",
        }));

        const operation = newNotificationOperation(db);
        const createdSlots: TimeSlot[] = [];
        transaction.create(seriesRef, {
          userId: input.userId,
          serviceType: input.serviceType,
          duration: input.duration,
          assignedTrainer: input.assignedTrainer,
          startDate: input.startDate,
          startTime: input.startTime,
          intervalDays: input.intervalDays,
          endDate: input.endDate,
          occurrenceCount: plan.writes.occurrenceCount,
          totalMinutes: plan.writes.totalMinutes,
          bonoId: plan.writes.bono.bonoId,
          status: "approved",
          origin: "admin",
          createdByUid: adminUid,
          createdByAdminUid: adminUid,
          approvedByAdminUid: adminUid,
          ...(adminOverride ? { adminOverride } : {}),
          createdAt: now,
          updatedAt: now,
          approvedAt: now,
        });

        plan.writes.dates.forEach((date, index) => {
          const slot = { date, time: input.startTime };
          const appointment: SeriesAppointment = {
            userId: input.userId!,
            name: userProfile.name,
            email: userProfile.email,
            phone: userProfile.phone || "",
            serviceType: input.serviceType,
            sessionType: service.title || input.serviceType,
            duration: input.duration,
            preferredSlots: [slot],
            reason: input.comment,
            status: "approved",
            date: slot.date,
            time: slot.time,
            approvedSlot: slot,
            assignedTrainer: input.assignedTrainer,
            createdByAdmin: true,
            createdByAdminUid: adminUid,
            ...(adminOverride ? { adminOverride } : {}),
            recurrenceSeriesId: seriesRef.id,
            recurrenceIndex: index,
            bonoId: plan.writes.bono.bonoId,
            minutesDeducted: true,
            minutesDeductedAmount: plan.writes.minutesDeductedAmount,
            minutesDeductedAt: now,
            minutesRefundedAt: null,
            minutesRefundReason: null,
            notificationOperationId: operation.operationId,
            createdAt: now,
            updatedAt: now,
          };
          transaction.create(appointmentRefs[index], appointment);
          createdSlots.push(slot);
        });

        // Sessions registered retroactively are bookkeeping: the customer is
        // only told about upcoming ones (no outbox at all when none are).
        const upcoming = createdSlots
          .map((slot, index) => ({ slot, ref: appointmentRefs[index] }))
          .filter(({ slot }) => (madridCivilSlotToInstant(slot)?.getTime() ?? 0) > nowDate.getTime());
        writeNotificationOutbox(transaction, operation, {
          userId: input.userId!,
          event: "appointment_series_confirmed",
          seriesId: seriesRef.id,
          appointmentIds: upcoming.map(({ ref }) => ref.id),
          sessions: sessionsOf(upcoming.map(({ slot }) => slot)),
          customerName: userProfile.name,
          customerEmail: userProfile.email,
          actor: "admin",
          createdAt: now,
        });

        plan.writes.occupancyWrites.forEach((write) => {
          transaction.set(
            db.collection("slot_occupancy").doc(slotOccupancyDocId(write.date, write.time)),
            {
              date: write.date,
              time: write.time,
              count: (occupancyByKey.get(slotOccupancyDocId(write.date, write.time)) ?? 0) + 1,
            },
            { merge: true },
          );
        });

        transaction.set(bonoRef, {
          minutosRestantes: plan.writes.bono.minutosRestantes,
          estado: plan.writes.bono.estado,
          historial: FieldValue.arrayUnion(...historialEntries),
        }, { merge: true });

        transaction.create(db.collection("activity_logs").doc(), {
          action: "recurring_appointments_created",
          adminUid,
          adminEmail,
          seriesId: seriesRef.id,
          targetUid: input.userId,
          targetEmail: userProfile.email,
          occurrenceCount: plan.writes.occurrenceCount,
          totalMinutes: plan.writes.totalMinutes,
          startDate: input.startDate,
          endDate: input.endDate,
          intervalDays: input.intervalDays,
          startTime: input.startTime,
          serviceType: input.serviceType,
          bonoId: plan.writes.bono.bonoId,
          createdAt: now,
          timestamp: now,
        });
        if (adminOverride) {
          transaction.create(db.collection("activity_logs").doc(), {
            action: "recurring_appointments_created_with_admin_override",
            adminUid,
            adminEmail,
            seriesId: seriesRef.id,
            targetUid: input.userId,
            restrictions: adminOverride.restrictions,
            pastDateConfirmed: adminOverride.pastDateConfirmed,
            createdAt: now,
            timestamp: now,
          });
        }

        const response = {
          seriesId: seriesRef.id,
          appointmentIds: appointmentRefs.map((ref) => ref.id),
          occurrenceCount: plan.writes.occurrenceCount,
          totalMinutes: plan.writes.totalMinutes,
          ...(adminOverride ? { overriddenRestrictions: adminOverride.restrictions } : {}),
        };
        writeIdempotencyMarker(transaction, marker, { adminUid, kind: "series", payloadHash, result: response, now });
        return response;
      });

      return { success: true, ...result };
    },

    createRecurringAppointments: async (request: CallableRequest) => {
      if (!request.auth) {
        throwHttps("permission-denied", "Debes iniciar sesion para solicitar un entrenamiento recurrente.");
      }
      const userId = request.auth.uid;
      if (isRecord(request.data) && request.data.appointmentType === "nutrition") {
        throwHttps("invalid-argument", "Las consultas de nutrición no pueden ser recurrentes.", {
          reason: "nutrition_not_recurring",
        });
      }
      const parsed = parseClientRecurringAppointmentsData(request.data);
      if (!parsed.ok) throwHttps("invalid-argument", parsed.message);
      const input = {
        ...parsed.value,
        userId,
        serviceType: parsed.value.serviceType || defaultServiceType,
      };

      const occurrenceDates = generateRecurringOccurrenceDates(input.startDate, input.intervalDays, input.endDate);
      if (occurrenceDates.length === 0) {
        throwHttps("failed-precondition", "La serie debe incluir al menos una sesion.");
      }
      if (occurrenceDates.length > MAX_RECURRING_OCCURRENCES) {
        throwHttps("failed-precondition", `La serie no puede superar ${MAX_RECURRING_OCCURRENCES} sesiones.`);
      }
      const occupancyKeys = collectRecurringOccupancyKeys(occurrenceDates, input.startTime, input.durationMinutes);
      const seriesRef = db.collection("appointment_recurrences").doc();
      const appointmentRefs = occurrenceDates.map(() => db.collection("appointments").doc());
      const occupancyRefs = occupancyKeys.map((key) => db.collection("slot_occupancy").doc(key));
      const userRef = db.collection("users").doc(userId);
      const siteConfigRef = db.collection("site_config").doc("main");
      const blockedSlotsQuery = db.collection("blocked_slots")
        .where("date", ">=", input.startDate)
        .where("date", "<=", input.endDate);
      const userAppointmentsQuery = db.collection("appointments")
        .where("userId", "==", userId)
        .where("status", "in", ["pending", "approved"]);
      const bonosQuery = db.collection("bonos")
        .where("userId", "==", userId)
        .where("estado", "==", "activo");

      const result = await db.runTransaction(async (transaction) => {
        const [
          userSnap,
          siteConfigSnap,
          blockedSlotsSnap,
          userAppointmentsSnap,
          bonosSnap,
          occupancySnaps,
        ] = await Promise.all([
          transaction.get(userRef),
          transaction.get(siteConfigRef),
          transaction.get(blockedSlotsQuery),
          transaction.get(userAppointmentsQuery),
          transaction.get(bonosQuery),
          Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
        ]);
        await loadServiceAndTrainer(transaction, input.serviceType, "", false);

        if (!userSnap.exists) {
          throwHttps("failed-precondition", "No se ha encontrado tu perfil de usuario.");
        }
        const userProfile = userSnap.data() as UserProfile;
        if (!userProfile.email || !userProfile.name) {
          throwHttps("failed-precondition", "Tu perfil no esta completo para poder reservar.");
        }

        const config = siteConfigSnap.exists
          ? normalizeSiteConfig(siteConfigSnap.data() as Partial<SiteConfig>)
          : normalizeSiteConfig();
        const blockedKeys = new Set<string>();
        blockedSlotsSnap.docs.forEach((docSnap) => {
          const blocked = docSnap.data() as TimeSlot;
          if (typeof blocked.date === "string" && typeof blocked.time === "string") {
            blockedKeys.add(slotOccupancyDocId(blocked.date, blocked.time));
          }
        });
        const occupancyByKey = new Map<string, number>();
        occupancySnaps.forEach((snap, index) => {
          const occupancy = snap.exists ? snap.data() as SlotOccupancy : undefined;
          const count = occupancy ? parseOccupancyCount(occupancy.count) : 0;
          if (count === undefined) {
            // A corrupt counter must be detected, never read as free capacity.
            throwHttps("failed-precondition", "La ocupación registrada no es válida.", { reason: "invalid_occupancy" });
          }
          occupancyByKey.set(occupancyKeys[index], count);
        });
        const userSlotKeys = new Set<string>();
        userAppointmentsSnap.docs.forEach((docSnap) => {
          appointmentSlotKeys(docSnap.data() as SeriesAppointment).forEach((key) => userSlotKeys.add(key));
        });
        const activeBonos = bonosSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as BonoDoc & { id: string }));

        const plan = planRecurringAppointments({
          startDate: input.startDate,
          startTime: input.startTime,
          endDate: input.endDate,
          intervalDays: input.intervalDays,
          durationMinutes: input.durationMinutes,
          now: getNowDate(),
          siteConfig: config,
          occupancyByKey,
          blockedKeys,
          userSlotKeys,
          activeBonos,
          minBookingNoticeHours: config.minBookingNoticeHours,
          blockSameDayBooking: config.blockSameDayBooking,
        });
        if (!plan.ok) {
          throwHttps(
            "failed-precondition",
            plan.message,
            plan.reason ? { reason: plan.reason, date: plan.problemDate, time: plan.problemTime } : undefined,
          );
        }

        const now = new Date().toISOString();
        const bonoRef = db.collection("bonos").doc(plan.writes.bono.bonoId);
        const historialEntries = plan.writes.dates.map((_date, index) => ({
          fecha: now,
          tipo: input.serviceType,
          duracion: input.duration,
          appointmentId: appointmentRefs[index].id,
          accion: "descuento_cita",
        }));

        const operation = newNotificationOperation(db);
        const requestedSlots: TimeSlot[] = [];
        transaction.create(seriesRef, {
          userId,
          serviceType: input.serviceType,
          duration: input.duration,
          startDate: input.startDate,
          startTime: input.startTime,
          intervalDays: input.intervalDays,
          endDate: input.endDate,
          occurrenceCount: plan.writes.occurrenceCount,
          totalMinutes: plan.writes.totalMinutes,
          bonoId: plan.writes.bono.bonoId,
          status: "pending",
          origin: "client",
          createdByUid: userId,
          createdAt: now,
          updatedAt: now,
        });

        plan.writes.dates.forEach((date, index) => {
          const slot = { date, time: input.startTime };
          const appointment: SeriesAppointment = {
            userId,
            name: userProfile.name,
            email: userProfile.email,
            phone: userProfile.phone || "",
            serviceType: input.serviceType,
            duration: input.duration,
            preferredSlots: [slot],
            reason: input.comment,
            status: "pending",
            date: slot.date,
            time: slot.time,
            recurrenceSeriesId: seriesRef.id,
            recurrenceIndex: index,
            bonoId: plan.writes.bono.bonoId,
            minutesDeducted: true,
            minutesDeductedAmount: plan.writes.minutesDeductedAmount,
            minutesDeductedAt: now,
            minutesRefundedAt: null,
            minutesRefundReason: null,
            notificationOperationId: operation.operationId,
            createdAt: now,
            updatedAt: now,
          };
          transaction.create(appointmentRefs[index], appointment);
          requestedSlots.push(slot);
        });

        writeNotificationOutbox(transaction, operation, {
          userId,
          event: "appointment_series_requested",
          seriesId: seriesRef.id,
          appointmentIds: appointmentRefs.slice(0, requestedSlots.length).map((ref) => ref.id),
          sessions: sessionsOf(requestedSlots),
          customerName: userProfile.name,
          customerEmail: userProfile.email,
          actor: "customer",
          createdAt: now,
        });

        transaction.set(bonoRef, {
          minutosRestantes: plan.writes.bono.minutosRestantes,
          estado: plan.writes.bono.estado,
          historial: FieldValue.arrayUnion(...historialEntries),
        }, { merge: true });

        return {
          seriesId: seriesRef.id,
          appointmentIds: appointmentRefs.map((ref) => ref.id),
          occurrenceCount: plan.writes.occurrenceCount,
          totalMinutes: plan.writes.totalMinutes,
        };
      });

      return { success: true, ...result };
    },

    approveRecurringAppointmentSeriesFromAdmin: async (request: CallableRequest) => {
      if (!request.auth) throwHttps("permission-denied", "Debes iniciar sesion como admin.");
      await requireAdmin(request.auth.uid);
      const adminUid = request.auth.uid;
      const adminEmail = request.auth.token.email ?? "";
      const seriesId = seriesIdFrom(request.data);
      const assignedTrainer = isRecord(request.data) ? optionalText(request.data, "assignedTrainer", 128) : "";
      const sessionType = isRecord(request.data) ? optionalText(request.data, "sessionType", 180) : "";

      const seriesRef = db.collection("appointment_recurrences").doc(seriesId);
      const result = await db.runTransaction(async (transaction) => {
        const seriesSnap = await transaction.get(seriesRef);
        if (!seriesSnap.exists) {
          throwHttps("failed-precondition", "No se ha encontrado la serie indicada.");
        }
        const series = seriesSnap.data() as RecurrenceSeriesDoc;
        if (series.status !== "pending") {
          throwHttps("failed-precondition", "Esta serie ya no se puede aprobar.");
        }
        if (!series.bonoId) seriesChanged("series_without_bono");
        const appointmentsQuery = db.collection("appointments").where("recurrenceSeriesId", "==", seriesId);
        const appointmentsSnap = await transaction.get(appointmentsQuery);
        const allOccurrences = appointmentsSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() as SeriesAppointment }));
        const activeOccurrences = allOccurrences
          .filter((occurrence) => isActiveOccurrenceStatus(occurrence.data.status));
        const durationMinutes = Number(series.duration);
        if (!validDuration(durationMinutes)) seriesChanged("invalid_series_duration");
        if (activeOccurrences.length < 1 || activeOccurrences.length > MAX_RECURRING_OCCURRENCES) {
          seriesChanged("invalid_active_count");
        }
        assertSeriesOccurrencesStructure(activeOccurrences, series, seriesId, durationMinutes);
        // The occurrences read in this transaction are the source of truth. The stored
        // occurrenceCount/totalMinutes may be stale (individual cancellations or
        // deletions written before they were kept in sync); they are rewritten below.
        const derivedTotalMinutes = activeOccurrences.length * durationMinutes;
        const metadataWasStale = series.occurrenceCount !== activeOccurrences.length
          || series.totalMinutes !== derivedTotalMinutes;
        const nowDate = getNowDate();
        const pendingOccurrences = activeOccurrences
          .filter((occurrence) => occurrence.data.status === "pending")
          .sort((left, right) => Number(left.data.recurrenceIndex) - Number(right.data.recurrenceIndex));
        const prepared = pendingOccurrences.flatMap((occurrence) => {
          const slot = pendingOccurrenceSlot(occurrence.data);
          const instant = slot ? madridCivilSlotToInstant(slot) : undefined;
          if (!slot || !instant || instant <= nowDate) return [];
          const keys = getCanonicalSlotBlocks(slot.time, durationMinutes).map((time) => slotOccupancyDocId(slot.date, time));
          if (keys.length === 0) {
            throwHttps("failed-precondition", "La ocupacion de una cita de la serie no es valida.", {
              reason: "invalid_occupancy",
            });
          }
          return [{ ...occurrence, slot, keys }];
        });
        if (prepared.length === 0) {
          throwHttps("failed-precondition", "La serie no tiene citas pendientes futuras validas para aprobar.", {
            reason: "series_unavailable",
          });
        }
        const dates = prepared.map((occurrence) => occurrence.slot.date).sort();
        const occupancyKeys = [...new Set(prepared.flatMap((occurrence) => occurrence.keys))].sort();
        const occupancyRefs = occupancyKeys.map((key) => db.collection("slot_occupancy").doc(key));
        const blockedSlotsQuery = db.collection("blocked_slots")
          .where("date", ">=", dates[0])
          .where("date", "<=", dates.at(-1));
        const userAppointmentsQuery = db.collection("appointments")
          .where("userId", "==", series.userId)
          .where("status", "in", ["pending", "approved"]);
        const siteConfigRef = db.collection("site_config").doc("main");
        const bonoRef = db.collection("bonos").doc(series.bonoId);

        const [
          blockedSlotsSnap,
          userAppointmentsSnap,
          siteConfigSnap,
          occupancySnaps,
          bonoSnap,
        ] = await Promise.all([
          transaction.get(blockedSlotsQuery),
          transaction.get(userAppointmentsQuery),
          transaction.get(siteConfigRef),
          Promise.all(occupancyRefs.map((ref) => transaction.get(ref))),
          transaction.get(bonoRef),
        ]);
        if (assignedTrainer) {
          await loadServiceAndTrainer(transaction, series.serviceType, assignedTrainer, true);
        } else {
          await loadServiceAndTrainer(transaction, series.serviceType, "", false);
        }

        // Every active occurrence must hold exactly its own minutes of the series bono.
        const reserved = validateReservedSeriesMinutes({
          seriesBonoId: series.bonoId,
          seriesUserId: series.userId,
          seriesTotalMinutes: derivedTotalMinutes,
          durationMinutes,
          bono: bonoSnap.exists
            ? { id: bonoSnap.id, ...(bonoSnap.data() as BonoDoc) }
            : undefined,
          occurrences: activeOccurrences.map((occurrence) => occurrence.data),
        });
        if (!reserved.ok) throwHttps("failed-precondition", reserved.message, { reason: reserved.reason });

        const config = siteConfigSnap.exists
          ? normalizeSiteConfig(siteConfigSnap.data() as Partial<SiteConfig>)
          : normalizeSiteConfig();
        const blockedKeys = new Set<string>();
        blockedSlotsSnap.docs.forEach((docSnap) => {
          const blocked = docSnap.data() as TimeSlot;
          if (typeof blocked.date === "string" && typeof blocked.time === "string") {
            blockedKeys.add(slotOccupancyDocId(blocked.date, blocked.time));
          }
        });
        const occupancyByKey = new Map<string, number>();
        occupancySnaps.forEach((snap, index) => {
          const occupancy = snap.exists ? snap.data() as SlotOccupancy : undefined;
          occupancyByKey.set(occupancyKeys[index], assertOccupancyCount(occupancy?.count ?? 0));
        });
        const userSlotKeys = new Set<string>();
        const preparedIds = new Set(prepared.map((occurrence) => occurrence.id));
        userAppointmentsSnap.docs.forEach((docSnap) => {
          const appointment = docSnap.data() as SeriesAppointment;
          if (preparedIds.has(docSnap.id)) return;
          appointmentSlotKeys(appointment).forEach((key) => userSlotKeys.add(key));
        });
        const internalKeys = new Set<string>();
        // Full sessions are collected for the admin to confirm; every other rule stays hard.
        const restrictions: AdminRestriction[] = [];
        prepared.forEach((occurrence) => {
          if (!doesSessionFitWithinSchedule(config, occurrence.slot.time, durationMinutes)) {
            throwHttps("failed-precondition", "Una cita de la serie queda fuera del horario disponible.");
          }
          const counts = occurrence.keys.map((key) => {
            if (blockedKeys.has(key)) throwHttps("failed-precondition", "Una franja de la serie esta bloqueada.");
            if (userSlotKeys.has(key) || internalKeys.has(key)) {
              throwHttps("failed-precondition", "Una franja de la serie entra en conflicto con otra cita.");
            }
            internalKeys.add(key);
            return assertOccupancyCount(occupancyByKey.get(key));
          });
          if (counts.some((current) => current + 1 > config.maxCapacity)) {
            restrictions.push({
              ...occurrence.slot,
              reason: "slot_full",
              occupancy: Math.max(...counts),
              maxCapacity: config.maxCapacity,
            });
          }
        });

        const now = nowDate.toISOString();
        const adminOverride = authorizeAdminOverride({
          restrictions,
          request: parseAdminOverrideRequest(isRecord(request.data) ? request.data : {}),
          status: "approved",
          adminUid,
          adminEmail,
          now,
          operation: "approve",
        });
        const operation = newNotificationOperation(db);
        prepared.forEach((occurrence) => {
          const patch: Record<string, unknown> = {
            status: "approved",
            date: occurrence.slot.date,
            time: occurrence.slot.time,
            approvedSlot: occurrence.slot,
            updatedAt: now,
            approvedAt: now,
            approvedByAdmin: adminUid,
            notificationOperationId: operation.operationId,
          };
          if (assignedTrainer) patch.assignedTrainer = assignedTrainer;
          if (sessionType) patch.sessionType = sessionType;
          transaction.set(occurrence.ref, patch, { merge: true });
        });
        writeNotificationOutbox(transaction, operation, {
          userId: series.userId,
          event: "appointment_series_confirmed",
          seriesId,
          appointmentIds: prepared.map((occurrence) => occurrence.id),
          sessions: sessionsOf(prepared.map((occurrence) => ({ approvedSlot: occurrence.slot }))),
          customerName: prepared[0].data.name ?? "",
          customerEmail: prepared[0].data.email ?? "",
          actor: "admin",
          createdAt: now,
        });

        occupancyKeys.forEach((key) => {
          const separator = key.indexOf("_");
          transaction.set(
            db.collection("slot_occupancy").doc(key),
            {
              date: key.slice(0, separator),
              time: key.slice(separator + 1),
              count: assertOccupancyCount(occupancyByKey.get(key)) + 1,
            },
            { merge: true },
          );
        });

        const metadata = calculateActiveSeriesMetadata(
          activeOccurrences.map((occurrence) => ({
            data: occurrence.data,
            ...(preparedIds.has(occurrence.id) ? { statusOverride: "approved" } : {}),
          })),
          nowDate,
        );
        if (!metadata) {
          throwHttps("failed-precondition", "No se pueden calcular los metadatos activos de la serie.", {
            reason: "recurring_occurrence_unavailable",
          });
        }
        const remainingPending = activeOccurrences.some((occurrence) =>
          occurrence.data.status === "pending" && !preparedIds.has(occurrence.id));
        const hasHistorical = activeOccurrences.some((occurrence) =>
          isHistoricalReplacementOccurrence(occurrence.data, nowDate));
        transaction.set(seriesRef, {
          status: remainingPending ? "pending" : "approved",
          assignedTrainer: assignedTrainer || series.assignedTrainer || null,
          occurrenceCount: metadata.occurrenceCount,
          totalMinutes: metadata.totalMinutes,
          ...(!hasHistorical && metadata.futureStartDate ? {
            startDate: metadata.futureStartDate,
            startTime: metadata.futureStartTime,
          } : {}),
          ...(metadata.futureEndDate ? { endDate: metadata.futureEndDate } : {}),
          futureOccurrenceCount: metadata.futureOccurrenceCount,
          futureStartDate: metadata.futureStartDate ?? FieldValue.delete(),
          futureStartTime: metadata.futureStartTime ?? FieldValue.delete(),
          futureEndDate: metadata.futureEndDate ?? FieldValue.delete(),
          approvedByAdminUid: adminUid,
          approvedAt: now,
          updatedAt: now,
        }, { merge: true });

        transaction.create(db.collection("activity_logs").doc(), {
          action: "recurring_appointments_approved",
          adminUid,
          seriesId,
          affectedAppointmentIds: prepared.map((occurrence) => occurrence.id),
          occurrenceCount: metadata.occurrenceCount,
          totalMinutes: metadata.totalMinutes,
          ...(metadataWasStale ? {
            previousOccurrenceCount: series.occurrenceCount ?? null,
            previousTotalMinutes: series.totalMinutes ?? null,
          } : {}),
          createdAt: now,
          timestamp: now,
        });
        if (adminOverride) {
          transaction.create(db.collection("activity_logs").doc(), {
            action: "recurring_series_approved_with_admin_override",
            adminUid,
            adminEmail,
            seriesId,
            targetUid: series.userId,
            affectedAppointmentIds: prepared.map((occurrence) => occurrence.id),
            restrictions: adminOverride.restrictions,
            createdAt: now,
            timestamp: now,
          });
        }

        return {
          seriesId,
          appointmentIds: prepared.map((occurrence) => occurrence.id),
          ...(adminOverride ? { overriddenRestrictions: adminOverride.restrictions } : {}),
        };
      });

      return { success: true, ...result };
    },

    rejectRecurringAppointmentSeriesFromAdmin: async (request: CallableRequest) => {
      if (!request.auth) throwHttps("permission-denied", "Debes iniciar sesion como admin.");
      await requireAdmin(request.auth.uid);
      const adminUid = request.auth.uid;
      const seriesId = seriesIdFrom(request.data);
      return finalizePendingSeries({
        seriesId,
        nextStatus: "rejected",
        actorUid: adminUid,
        activityAction: "recurring_appointments_rejected",
        appointmentStatus: "rejected",
      });
    },

    cancelOwnRecurringAppointmentSeries: async (request: CallableRequest) => {
      if (!request.auth) {
        throwHttps("permission-denied", "Debes iniciar sesion para cancelar la solicitud recurrente.");
      }
      const seriesId = seriesIdFrom(request.data);
      return finalizePendingSeries({
        seriesId,
        nextStatus: "cancelled",
        actorUid: request.auth.uid,
        activityAction: "recurring_appointments_cancelled",
        appointmentStatus: "cancelled",
        requireOwner: request.auth.uid,
      });
    },
  };

  async function finalizePendingSeries(input: {
    seriesId: string;
    nextStatus: "rejected" | "cancelled";
    actorUid: string;
    activityAction: string;
    appointmentStatus: "rejected" | "cancelled";
    requireOwner?: string;
  }) {
    const seriesRef = db.collection("appointment_recurrences").doc(input.seriesId);
    const result = await db.runTransaction(async (transaction) => {
      const seriesSnap = await transaction.get(seriesRef);
      if (!seriesSnap.exists) {
        throwHttps("failed-precondition", "No se ha encontrado la serie indicada.");
      }
      const series = seriesSnap.data() as RecurrenceSeriesDoc;
      if (input.requireOwner && series.userId !== input.requireOwner) {
        throwHttps("permission-denied", "No puedes cancelar la serie de otro usuario.");
      }
      if (series.status !== "pending") {
        throwHttps("failed-precondition", "Esta serie ya no se puede cancelar.");
      }
      if (!series.bonoId) seriesChanged("series_without_bono");

      const appointmentsQuery = db.collection("appointments").where("recurrenceSeriesId", "==", input.seriesId);
      const bonoRef = db.collection("bonos").doc(series.bonoId);
      const [appointmentsSnap, bonoSnap] = await Promise.all([
        transaction.get(appointmentsQuery),
        transaction.get(bonoRef),
      ]);
      const allOccurrences = appointmentsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ref: docSnap.ref,
        data: docSnap.data() as SeriesAppointment,
      }));
      // A customer rescheduling one session of an approved series leaves it pending
      // with approved sessions: finalizing it would orphan them under a closed series.
      if (allOccurrences.some((occurrence) => occurrence.data.status === "approved")) {
        throwHttps(
          "failed-precondition",
          "Esta serie tiene sesiones ya aprobadas y no puede rechazarse ni cancelarse como conjunto.",
          { reason: "series_has_approved_occurrences" },
        );
      }
      const occurrences = allOccurrences.filter((occurrence) => occurrence.data.status === "pending");
      const durationMinutes = Number(series.duration);
      if (!validDuration(durationMinutes)) seriesChanged("invalid_series_duration");
      if (occurrences.length < 1 || occurrences.length > MAX_RECURRING_OCCURRENCES) {
        seriesChanged("invalid_active_count");
      }
      if (input.requireOwner && seriesHasSameDayOccurrence(occurrences.map((occurrence) => occurrence.data), getNowDate())) {
        throwHttps("failed-precondition", SAME_DAY_CHANGE_MESSAGE, {
          reason: SAME_DAY_CHANGE_NOT_ALLOWED,
        });
      }

      // Validated against the pending sessions actually read (stored metadata may be
      // stale); each one gives back exactly the minutes it reserved.
      const reserved = validateReservedSeriesMinutes({
        seriesBonoId: series.bonoId,
        seriesUserId: series.userId,
        seriesTotalMinutes: occurrences.length * durationMinutes,
        durationMinutes,
        bono: bonoSnap.exists
          ? { id: bonoSnap.id, ...(bonoSnap.data() as BonoDoc) }
          : undefined,
        occurrences: occurrences.map((occurrence) => occurrence.data),
      });
      if (!reserved.ok) throwHttps("failed-precondition", reserved.message, { reason: reserved.reason });
      if (!bonoSnap.exists) {
        throwHttps("failed-precondition", "No se ha encontrado el bono reservado de la serie.");
      }

      const now = new Date().toISOString();
      const refundPlan = planSeriesMinutesRefund({
        bono: { id: bonoSnap.id, ...(bonoSnap.data() as BonoDoc) },
        occurrences: occurrences.map((occurrence) => occurrence.data),
        now,
      });
      if (!refundPlan.ok) throwHttps("failed-precondition", refundPlan.message);

      const historialEntries = occurrences.map((occurrence) => ({
        fecha: now,
        tipo: series.serviceType,
        duracion: series.duration,
        appointmentId: occurrence.id,
        accion: "devolucion_cita",
      }));

      const operation = newNotificationOperation(db);
      occurrences.forEach((occurrence, index) => {
        transaction.set(occurrence.ref, {
          ...buildPendingSeriesOccurrencePatch({
            status: input.appointmentStatus,
            now,
            refundPatch: refundPlan.appointmentPatches[index],
          }),
          notificationOperationId: operation.operationId,
        }, { merge: true });
      });
      writeNotificationOutbox(transaction, operation, {
        userId: series.userId,
        event: input.appointmentStatus === "rejected" ? "appointment_series_rejected" : "appointment_series_cancelled",
        seriesId: input.seriesId,
        appointmentIds: occurrences.map((occurrence) => occurrence.id),
        sessions: sessionsOf(occurrences.map((occurrence) => occurrence.data)),
        customerName: occurrences[0]?.data.name ?? "",
        customerEmail: occurrences[0]?.data.email ?? "",
        actor: input.requireOwner ? "customer" : "admin",
        createdAt: now,
        refundedMinutes: refundPlan.appointmentPatches.reduce((total, patch) => (
          total + (typeof patch.minutesRefundedAmount === "number" ? patch.minutesRefundedAmount : 0)
        ), 0),
      });

      transaction.set(bonoRef, {
        minutosRestantes: refundPlan.bono.minutosRestantes,
        estado: refundPlan.bono.estado,
        historial: FieldValue.arrayUnion(...historialEntries),
      }, { merge: true });

      const seriesPatch: Record<string, unknown> = {
        status: input.nextStatus,
        updatedAt: now,
      };
      if (input.nextStatus === "rejected") {
        seriesPatch.rejectedByAdminUid = input.actorUid;
        seriesPatch.rejectedAt = now;
      } else {
        seriesPatch.cancelledByUid = input.actorUid;
        seriesPatch.cancelledAt = now;
      }
      transaction.set(seriesRef, seriesPatch, { merge: true });
      transaction.create(db.collection("activity_logs").doc(), {
        action: input.activityAction,
        adminUid: input.requireOwner ? null : input.actorUid,
        seriesId: input.seriesId,
        affectedAppointmentIds: occurrences.map((occurrence) => occurrence.id),
        createdAt: now,
        timestamp: now,
      });

      return { seriesId: input.seriesId, appointmentIds: occurrences.map((occurrence) => occurrence.id) };
    });

    return { success: true, ...result };
  }
}
