import type { DocumentReference, Firestore, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { getCanonicalSlotBlocks, madridCivilSlotToInstant, slotOccupancyDocId } from "./appointmentLifecycle.js";
import { deductAppointmentMinutesInTransaction } from "./appointmentFinance.js";
import {
  type AdminOverrideAudit,
  authorizeAdminOverride,
  bookingPayloadHash,
  collectAdminSlotRestrictions,
  isValidAdminSlotTime,
  parseAdminOverrideRequest,
  parseRequestId,
  readIdempotencyMarker,
  writeIdempotencyMarker,
} from "./adminBookingOverrides.js";
import { type BonoDoc, getBonoMinutosRestantes } from "./customerBooking.js";
import { addOccupancyDelta, planOccupancyWrites } from "./slotOccupancy.js";
import {
  type AppointmentType,
  evaluateSlotConflicts,
  loadCustomerActiveAppointments,
  loadSiteConfig,
  loadSlotDay,
  loadTrainerActiveAppointments,
  NUTRITION_DURATION_MINUTES,
  parseAppointmentTypeInput,
  SLOT_REJECTION_MESSAGES,
  type SlotRejectionReason,
} from "./slotValidation.js";

/**
 * Admin "Nueva cita" (`createAppointmentFromAdmin` callable). Extracted from
 * index.ts so it can be tested; index.ts keeps exporting it with the same
 * name, region and response, and sends the admin email from `notifyAdmin`.
 */

const NUTRITION_SERVICE_TYPE = "Consulta de nutrición";

type AppointmentDuration = "30" | "45" | "60";

interface TimeSlot {
  date: string;
  time: string;
}

interface ParsedAdminAppointmentData {
  userId: string;
  slot: TimeSlot;
  duration: AppointmentDuration;
  durationMinutes: number;
  serviceType: string;
  assignedTrainer: string;
  status: "pending" | "approved";
  comment: string;
  appointmentType: AppointmentType;
}

interface UserProfile {
  email?: string;
  name?: string;
  phone?: string;
}

interface TrainerDoc {
  active?: boolean;
  offersNutrition?: boolean;
}

interface ServiceDoc {
  title?: string;
  active?: boolean;
}

export interface AdminCreatedAppointment {
  userId: string;
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  sessionType: string;
  appointmentType: AppointmentType;
  duration: AppointmentDuration;
  preferredSlots: TimeSlot[];
  reason: string;
  status: "pending" | "approved";
  date: string;
  time: string;
  approvedSlot?: TimeSlot;
  assignedTrainer: string;
  createdByAdmin: true;
  createdByAdminUid: string;
  adminOverride?: AdminOverrideAudit;
  minutesRefundedAt: null;
  minutesRefundReason: null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface AdminAppointmentCreateDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
  /** Admin email for a new approved, upcoming appointment. Never called on a replay. */
  notifyAdmin?: (appointmentId: string, appointment: AdminCreatedAppointment) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textField(value: unknown, fieldName: string, maxLength: number, required = true): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new HttpsError("invalid-argument", `El campo ${fieldName} no es valido.`);
  }
  const text = value.trim();
  if (required && !text) throw new HttpsError("invalid-argument", `El campo ${fieldName} es obligatorio.`);
  if (text.length > maxLength) throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado largo.`);
  return text;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function parseCreateAppointmentFromAdminData(data: unknown): ParsedAdminAppointmentData {
  if (!isRecord(data)) {
    throw new HttpsError("invalid-argument", "Los datos de la cita no son validos.");
  }

  const userId = textField(data.userId, "cliente", 128);
  const date = textField(data.date, "fecha", 10);
  const time = textField(data.time, "hora", 5);
  const durationMinutes = Number(data.durationMinutes);
  const serviceType = textField(data.serviceType, "servicio", 180);
  const assignedTrainer = textField(data.assignedTrainer, "entrenador", 128);
  const status = data.status;
  const comment = textField(data.comment, "comentario", 1000, false);
  const appointmentType = parseAppointmentTypeInput(data.appointmentType);
  if (!appointmentType) {
    throw new HttpsError("invalid-argument", "El tipo de cita no es valido.");
  }
  if (appointmentType === "nutrition" && durationMinutes !== NUTRITION_DURATION_MINUTES) {
    throw new HttpsError("invalid-argument", "Las consultas de nutricion duran 30 minutos.");
  }
  if (![30, 45, 60].includes(durationMinutes)) {
    throw new HttpsError("invalid-argument", "La duracion de la cita no es valida.");
  }
  if (!isIsoDate(date) || !isValidAdminSlotTime(time, durationMinutes)) {
    throw new HttpsError("invalid-argument", "La fecha u hora no tiene un formato valido.");
  }
  if (status !== "pending" && status !== "approved") {
    throw new HttpsError("invalid-argument", "El estado inicial de la cita no es valido.");
  }

  return {
    userId,
    slot: { date, time },
    duration: String(durationMinutes) as AppointmentDuration,
    durationMinutes,
    serviceType,
    assignedTrainer,
    status,
    comment,
    appointmentType,
  };
}

/** Admin-facing error for a refused slot; `details.reason` lets the UI explain it. */
function slotRejectionError(reason: SlotRejectionReason): HttpsError {
  return new HttpsError("failed-precondition", SLOT_REJECTION_MESSAGES[reason], { reason });
}

export function createAdminAppointmentCreateHandlers(deps: AdminAppointmentCreateDeps) {
  const { db, requireAdmin, getNowDate } = deps;

  /**
   * Writes for an appointment created directly as approved: one seat per 15-min
   * block (absolute counts read in the same transaction) and the bono debit.
   * The debit needs exactly one active bono, the same rule customers book with.
   */
  function applyApprovedAppointmentWrites(
    transaction: Transaction,
    input: ParsedAdminAppointmentData,
    appointmentRef: DocumentReference,
    appointment: AdminCreatedAppointment,
    occupancyByTime: Map<string, number>,
    activeBonoDocs: QueryDocumentSnapshot[],
    now: string,
    nowDate: Date,
  ): { bonoWarning?: string; minutesAudit?: Record<string, unknown> } {
    const blocks = getCanonicalSlotBlocks(input.slot.time, input.durationMinutes);
    const delta = new Map<string, number>();
    addOccupancyDelta(delta, blocks.map((time) => slotOccupancyDocId(input.slot.date, time)), 1);
    const current = new Map<string, unknown>();
    blocks.forEach((time) => {
      current.set(slotOccupancyDocId(input.slot.date, time), occupancyByTime.get(time) ?? 0);
    });
    planOccupancyWrites(delta, current).writes.forEach((write) => {
      transaction.set(
        db.collection("slot_occupancy").doc(write.key),
        { date: write.date, time: write.time, count: write.count },
        { merge: true },
      );
    });

    // Nutrition shares capacity but never consumes bono minutes.
    if (input.appointmentType === "nutrition") return {};

    if (activeBonoDocs.length === 0) {
      return { bonoWarning: "Cita creada aprobada sin descuento: el cliente no tiene bono activo." };
    }
    if (activeBonoDocs.length > 1) {
      return { bonoWarning: "Cita creada aprobada sin descuento: el cliente tiene más de un bono activo." };
    }
    const bonoDoc = activeBonoDocs[0];
    const bono = { id: bonoDoc.id, ...bonoDoc.data() } as BonoDoc;
    if (bono.fechaExpiracion && new Date(bono.fechaExpiracion) < nowDate) {
      return { bonoWarning: "Cita creada aprobada sin descuento: el bono activo esta expirado." };
    }

    const availableMinutes = getBonoMinutosRestantes(bono);
    if (availableMinutes < input.durationMinutes) {
      return {
        bonoWarning: `Cita creada aprobada sin descuento: el bono solo tiene ${availableMinutes} min disponibles.`,
      };
    }

    const minutesAudit = deductAppointmentMinutesInTransaction(
      transaction,
      appointmentRef,
      appointment,
      bonoDoc,
      input.durationMinutes,
      now,
      false,
    );
    return minutesAudit
      ? { minutesAudit }
      : { bonoWarning: "Cita creada aprobada sin descuento: no se han podido reservar los minutos del bono." };
  }

  async function createAppointmentFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    if (!request.auth) {
      throw new HttpsError("permission-denied", "Debes iniciar sesion como admin.");
    }

    await requireAdmin(request.auth.uid);
    const adminUid = request.auth.uid;
    const adminEmail = request.auth.token.email ?? "";
    const input = parseCreateAppointmentFromAdminData(request.data);
    const data = request.data as Record<string, unknown>;
    const requestId = parseRequestId(data.requestId);
    const overrideRequest = parseAdminOverrideRequest(data);
    const payloadHash = bookingPayloadHash({ ...input, kind: "single" });

    const appointmentRef = db.collection("appointments").doc();
    const userRef = db.collection("users").doc(input.userId);
    const trainerRef = db.collection("trainers").doc(input.assignedTrainer);
    const serviceRef = input.serviceType.includes("/")
      ? null
      : db.collection("services").doc(input.serviceType);
    const serviceTitleQuery = db.collection("services").where("title", "==", input.serviceType).limit(1);
    const bonosQuery = db.collection("bonos")
      .where("userId", "==", input.userId)
      .where("estado", "==", "activo");

    const result = await db.runTransaction(async (transaction) => {
      const isNutrition = input.appointmentType === "nutrition";
      const marker = await readIdempotencyMarker(transaction, db, { requestId, adminUid, kind: "single", payloadHash });
      if (marker.previous) return { replayed: true as const, response: marker.previous };

      const [
        userSnap,
        trainerSnap,
        serviceIdSnap,
        config,
        customerAppointments,
        trainerAppointments,
        serviceTitleSnap,
        bonosSnap,
      ] = await Promise.all([
        transaction.get(userRef),
        transaction.get(trainerRef),
        serviceRef ? transaction.get(serviceRef) : Promise.resolve(undefined),
        loadSiteConfig(transaction, db),
        loadCustomerActiveAppointments(transaction, db, input.userId),
        isNutrition
          ? loadTrainerActiveAppointments(transaction, db, input.assignedTrainer)
          : Promise.resolve([]),
        transaction.get(serviceTitleQuery),
        transaction.get(bonosQuery),
      ]);
      const day = await loadSlotDay(transaction, db, config, input.slot.date);

      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "No se ha encontrado el cliente indicado.");
      }
      const userProfile = userSnap.data() as UserProfile;
      if (!userProfile.email || !userProfile.name) {
        throw new HttpsError("failed-precondition", "El perfil del cliente no esta completo.");
      }

      if (!trainerSnap.exists) {
        throw new HttpsError("failed-precondition", "No se ha encontrado el entrenador indicado.");
      }
      const trainer = trainerSnap.data() as TrainerDoc;
      if (trainer.active === false) {
        throw new HttpsError("failed-precondition", "El entrenador seleccionado no esta activo.");
      }
      if (isNutrition && trainer.offersNutrition !== true) {
        throw slotRejectionError("trainer_not_nutrition");
      }

      // Nutrition is not a catalogue service: it always uses its own label.
      const service = isNutrition
        ? { title: NUTRITION_SERVICE_TYPE, active: true } as ServiceDoc
        : serviceIdSnap?.exists
          ? serviceIdSnap.data() as ServiceDoc
          : serviceTitleSnap.docs[0]?.data() as ServiceDoc | undefined;
      if (!service) {
        throw new HttpsError("failed-precondition", "No se ha encontrado el servicio seleccionado.");
      }
      if (service.active === false) {
        throw new HttpsError("failed-precondition", "El servicio seleccionado no esta activo.");
      }

      const nowDate = getNowDate();
      const now = nowDate.toISOString();
      // Hard rules first: duplicates, professional conflicts and corrupt counters are never overridable.
      const { restrictions, hard } = collectAdminSlotRestrictions(day, {
        slot: input.slot,
        durationMinutes: input.durationMinutes,
        now: nowDate,
      });
      if (hard) throw slotRejectionError(hard);
      const conflict = evaluateSlotConflicts({
        slot: input.slot,
        durationMinutes: input.durationMinutes,
        appointmentType: input.appointmentType,
        now: nowDate,
        customerAppointments,
        trainer: {
          id: input.assignedTrainer,
          exists: true,
          active: true,
          offersNutrition: trainer.offersNutrition === true,
        },
        trainerAppointments,
      });
      if (conflict) throw slotRejectionError(conflict);
      const adminOverride = authorizeAdminOverride({
        restrictions,
        request: overrideRequest,
        status: input.status,
        adminUid,
        adminEmail,
        now,
      });

      const appointment: AdminCreatedAppointment = {
        userId: input.userId,
        name: userProfile.name,
        email: userProfile.email,
        phone: userProfile.phone || "",
        serviceType: isNutrition ? NUTRITION_SERVICE_TYPE : input.serviceType,
        sessionType: service.title || input.serviceType,
        appointmentType: input.appointmentType,
        duration: input.duration,
        preferredSlots: [input.slot],
        reason: input.comment,
        status: input.status,
        date: input.slot.date,
        time: input.slot.time,
        assignedTrainer: input.assignedTrainer,
        createdByAdmin: true,
        createdByAdminUid: adminUid,
        ...(adminOverride ? { adminOverride } : {}),
        minutesRefundedAt: null,
        minutesRefundReason: null,
        createdAt: now,
        updatedAt: now,
      };

      let bonoWarning: string | undefined;
      if (input.status === "approved") {
        appointment.approvedSlot = input.slot;
        const writeResult = applyApprovedAppointmentWrites(
          transaction,
          input,
          appointmentRef,
          appointment,
          day.occupancyByTime,
          bonosSnap.docs,
          now,
          nowDate,
        );
        bonoWarning = writeResult.bonoWarning;
        if (writeResult.minutesAudit) Object.assign(appointment, writeResult.minutesAudit);
      }

      transaction.create(appointmentRef, appointment);
      transaction.create(db.collection("activity_logs").doc(), {
        action: "appointment_created_by_admin",
        adminUid,
        adminEmail,
        appointmentId: appointmentRef.id,
        targetUid: input.userId,
        targetEmail: userProfile.email,
        status: input.status,
        date: input.slot.date,
        time: input.slot.time,
        serviceType: input.serviceType,
        createdAt: now,
        timestamp: now,
      });
      if (adminOverride) {
        transaction.create(db.collection("activity_logs").doc(), {
          action: "appointment_created_with_admin_override",
          adminUid,
          adminEmail,
          appointmentId: appointmentRef.id,
          targetUid: input.userId,
          date: input.slot.date,
          time: input.slot.time,
          restrictions: adminOverride.restrictions,
          pastDateConfirmed: adminOverride.pastDateConfirmed,
          createdAt: now,
          timestamp: now,
        });
      }

      const response: Record<string, unknown> = {
        success: true,
        appointmentId: appointmentRef.id,
        ...(bonoWarning ? { bonoWarning } : {}),
        ...(adminOverride ? { overriddenRestrictions: adminOverride.restrictions } : {}),
      };
      writeIdempotencyMarker(transaction, marker, { adminUid, kind: "single", payloadHash, result: response, now });
      const start = madridCivilSlotToInstant(input.slot);
      const upcoming = Boolean(start && start.getTime() > nowDate.getTime());
      return { replayed: false as const, response, appointment, upcoming };
    });

    if (result.replayed) return { ...result.response, replayed: true };

    // The customer is notified by onAppointmentCustomerNotification (create
    // trigger); only the admin email is sent from here, never for past sessions.
    if (result.appointment.status === "approved" && result.upcoming && deps.notifyAdmin) {
      await deps.notifyAdmin(String(result.response.appointmentId), result.appointment);
    }
    return result.response;
  }

  return { createAppointmentFromAdmin };
}
