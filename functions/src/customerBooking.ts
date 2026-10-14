import { type Firestore } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  BOOKING_NOTICE_TOO_SHORT,
  bookingNoticeMessage,
  SAME_DAY_BOOKING_DISABLED,
  SAME_DAY_BOOKING_MESSAGE,
  selectExactlyOneActiveBono,
} from "./appointmentLifecycle.js";
import { deductAppointmentMinutesInTransaction } from "./appointmentFinance.js";
import {
  type AppointmentType,
  evaluateSlot,
  loadCustomerActiveAppointments,
  loadSiteConfig,
  loadSlotDay,
  NUTRITION_DURATION_MINUTES,
  parseAppointmentTypeInput,
} from "./slotValidation.js";

/**
 * Customer booking (`createAppointment` callable used by the web portal and
 * the published Android/iOS app). Extracted unchanged from index.ts so the
 * real handler can be exercised against the Firestore emulator; index.ts keeps
 * exporting it with the same name, region, payload and response.
 */

export const APPOINTMENT_SERVICE_TYPE = "Bono Mensual de Entrenamiento";
export const NUTRITION_SERVICE_TYPE = "Consulta de nutrición";

type AppointmentDuration = "30" | "45" | "60";

interface TimeSlot {
  date: string;
  time: string;
}

export interface CreateAppointmentRequest {
  duration?: AppointmentDuration;
  appointmentType?: AppointmentType;
  preferredSlot: TimeSlot;
  reason?: string;
}

interface UserProfile {
  email?: string;
  name?: string;
  phone?: string;
}

export interface BonoDoc {
  id?: string;
  userId: string;
  tamano?: number;
  minutosTotales?: number;
  minutosRestantes?: number;
  fechaExpiracion?: string;
  estado: "activo" | "agotado" | "expirado" | "eliminado";
  tipo?: string;
  sesionesTotales?: number;
  sesionesRestantes?: number;
  modalidad?: string;
}

interface AppointmentDoc {
  userId: string;
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  appointmentType?: AppointmentType;
  duration: AppointmentDuration;
  preferredSlots: TimeSlot[];
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  minutesRefundedAt?: string | null;
  minutesRefundReason?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CustomerBookingDeps {
  db: Firestore;
  getNowDate: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimeSlot(value: unknown): value is TimeSlot {
  return isRecord(value)
    && typeof value.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.time === "string"
    && /^\d{2}:\d{2}$/.test(value.time);
}

function toHttpsError(
  code: "invalid-argument" | "failed-precondition" | "permission-denied",
  message: string,
  details?: Record<string, unknown>,
): HttpsError {
  return details ? new HttpsError(code, message, details) : new HttpsError(code, message);
}

export function getBonoMinutosTotales(bono: BonoDoc): number {
  if (typeof bono.tamano === "number" && typeof bono.minutosTotales === "number") {
    return Math.max(bono.tamano, bono.minutosTotales);
  }
  if (typeof bono.minutosTotales === "number") return bono.minutosTotales;
  if (typeof bono.tamano === "number") return bono.tamano;
  const minPerSession = bono.modalidad === "30min" ? 30 : 60;
  return (bono.sesionesTotales ?? 0) * minPerSession;
}

export function getBonoMinutosRestantes(bono: BonoDoc): number {
  if (typeof bono.minutosRestantes === "number") {
    const total = getBonoMinutosTotales(bono);
    return Math.max(0, Math.min(bono.minutosRestantes, total));
  }
  const minPerSession = bono.modalidad === "30min" ? 30 : 60;
  return (bono.sesionesRestantes ?? 0) * minPerSession;
}

export function createCustomerBookingHandlers(deps: CustomerBookingDeps) {
  const { db, getNowDate } = deps;
  const isBonoExpired = (bono: BonoDoc): boolean => Boolean(bono.fechaExpiracion && new Date(bono.fechaExpiracion) < getNowDate());

  async function createAppointment(request: CallableRequest<CreateAppointmentRequest>): Promise<{ appointmentId: string }> {
      if (!request.auth) {
        throw toHttpsError("permission-denied", "Debes iniciar sesión para reservar una sesión.");
      }

      if (request.auth.token.email_verified !== true) {
        throw toHttpsError("permission-denied", "Debes verificar tu correo antes de reservar una sesión.");
      }

      const data = request.data;
      const appointmentType = isRecord(data) ? parseAppointmentTypeInput(data.appointmentType) : undefined;
      const isNutrition = appointmentType === "nutrition";
      const rawDuration = isRecord(data) && data.duration !== undefined ? String(data.duration) : undefined;
      const durationIsValid = isNutrition
        ? rawDuration === undefined || rawDuration === String(NUTRITION_DURATION_MINUTES)
        : ["30", "45", "60"].includes(rawDuration ?? "");
      if (!isRecord(data) || !appointmentType || !isTimeSlot(data.preferredSlot) || !durationIsValid) {
        throw toHttpsError("invalid-argument", "Los datos de la reserva no son válidos.");
      }

      const duration = (isNutrition ? String(NUTRITION_DURATION_MINUTES) : rawDuration) as AppointmentDuration;
      const preferredSlot = data.preferredSlot;
      const reason = typeof data.reason === "string" ? data.reason.trim() : "";
      const durationMinutes = Number.parseInt(duration, 10);
      const userId = request.auth.uid;

      const appointmentRef = db.collection("appointments").doc();
      const userRef = db.collection("users").doc(userId);

      const bonosQuery = db.collection("bonos")
        .where("userId", "==", userId)
        .where("estado", "==", "activo");

      const appointmentId = await db.runTransaction(async (transaction) => {
        const [userSnap, bonosSnap, config, customerAppointments] = await Promise.all([
          transaction.get(userRef),
          transaction.get(bonosQuery),
          loadSiteConfig(transaction, db),
          loadCustomerActiveAppointments(transaction, db, userId),
        ]);
        const day = await loadSlotDay(transaction, db, config, preferredSlot.date);

        if (!userSnap.exists) {
          throw toHttpsError("failed-precondition", "No se ha encontrado tu perfil de usuario.");
        }

        const userProfile = userSnap.data() as UserProfile;
        if (!userProfile.name || !userProfile.email) {
          throw toHttpsError("failed-precondition", "Tu perfil no está completo para poder reservar.");
        }

        const selectedBono = selectExactlyOneActiveBono(
          bonosSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as BonoDoc)),
        );
        if (!selectedBono) {
          throw toHttpsError(
            "failed-precondition",
            bonosSnap.empty
              ? "No tienes un bono activo. Consulta en el gimnasio para adquirir uno."
              : "Tienes más de un bono activo. Contacta con el gimnasio para regularizar tus bonos.",
          );
        }

        const bonoDoc = bonosSnap.docs[0];
        const bono = { id: bonoDoc.id, ...bonoDoc.data() } as BonoDoc;
        if (isBonoExpired(bono)) {
          throw toHttpsError("failed-precondition", "Tu bono activo está expirado. Consulta en el gimnasio para renovarlo.");
        }

        // Nutrition requires an active bono but never consumes its minutes.
        const availableMinutes = getBonoMinutosRestantes(bono);
        if (!isNutrition && availableMinutes < durationMinutes) {
          throw toHttpsError(
            "failed-precondition",
            `No tienes suficientes minutos disponibles. Te quedan ${availableMinutes} min y la sesión requiere ${durationMinutes} min.`,
          );
        }

        const rejection = evaluateSlot(day, {
          slot: preferredSlot,
          durationMinutes,
          appointmentType,
          now: getNowDate(),
          customerAppointments,
          minNoticeHours: day.config.minBookingNoticeHours,
          blockSameDayBooking: day.config.blockSameDayBooking,
        });
        if (rejection) {
          const message = rejection === "outside_schedule"
            ? "La franja seleccionada no es válida."
            : rejection === "appointment_conflict"
              ? "Ya tienes una sesión reservada en esta franja."
              : rejection === SAME_DAY_BOOKING_DISABLED
                ? SAME_DAY_BOOKING_MESSAGE
                : rejection === BOOKING_NOTICE_TOO_SHORT
                  ? bookingNoticeMessage(day.config.minBookingNoticeHours)
                  : "La franja seleccionada ya no está disponible.";
          throw toHttpsError("failed-precondition", message, { reason: rejection });
        }

        const createdAt = new Date().toISOString();
        const appointment: AppointmentDoc = {
          userId,
          name: userProfile.name,
          email: userProfile.email,
          phone: userProfile.phone || "",
          serviceType: isNutrition ? NUTRITION_SERVICE_TYPE : APPOINTMENT_SERVICE_TYPE,
          appointmentType,
          duration,
          preferredSlots: [preferredSlot],
          reason,
          status: "pending",
          minutesRefundedAt: null,
          minutesRefundReason: null,
          createdAt,
          updatedAt: createdAt,
        };

        if (isNutrition) {
          transaction.create(appointmentRef, appointment);
          return appointmentRef.id;
        }

        const deduction = deductAppointmentMinutesInTransaction(
          transaction,
          appointmentRef,
          appointment,
          bonoDoc,
          durationMinutes,
          createdAt,
          false,
        );
        if (!deduction) {
          throw toHttpsError("failed-precondition", "No se han podido reservar los minutos del bono seleccionado.");
        }

        transaction.create(appointmentRef, { ...appointment, ...deduction });
        return appointmentRef.id;
      });

      return { appointmentId };
  }

  return { createAppointment };
}
