import { initializeApp } from "firebase-admin/app";
import { createHash } from "node:crypto";
import { DocumentReference, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Resend } from "resend";

initializeApp();

const db = getFirestore();
const MAKE_WEBHOOK_URL = defineSecret("MAKE_WEBHOOK_URL");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REGION = "europe-west1";
const MAX_CAPACITY = 2;
const APPOINTMENT_SERVICE_TYPE = "Bono Mensual de Entrenamiento";
const CONTACT_EMAIL_FROM = "Focus Club <noreply@focusclub.es>";
const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX_REQUESTS = 5;
const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SITE_CONFIG = {
  startHour: 8,
  endHour: 20,
  slotInterval: 30,
  bonoExpirationMonths: 1,
  maintenanceMode: false,
} as const;

type AppointmentDuration = "30" | "45" | "60";

interface TimeSlot {
  date: string;
  time: string;
}

interface CreateAppointmentRequest {
  duration: AppointmentDuration;
  preferredSlot: TimeSlot;
  reason?: string;
}

interface ContactMessageRequest {
  name: unknown;
  email: unknown;
  phone?: unknown;
  subject: unknown;
  message: unknown;
  company?: unknown;
}

interface ContactMessage {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  pushNotificationsEnabled?: boolean;
}

interface AppointmentDoc {
  userId: string;
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  duration: AppointmentDuration;
  preferredSlots: TimeSlot[];
  reason: string;
  status: "pending" | "approved" | "rejected";
  date?: string;
  time?: string;
  approvedSlot?: TimeSlot;
  assignedTrainer?: string;
  sessionType?: string;
  trainerNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface BonoDoc {
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

interface SiteConfig {
  startHour: number;
  endHour: number;
  slotInterval: number;
  bonoExpirationMonths: number;
  maintenanceMode?: boolean;
  sessionDuration?: number;
}

interface SlotOccupancy {
  date: string;
  time: string;
  count: number;
}

interface TrainerDoc {
  id?: string;
  uid: string;
  name: string;
}

interface MakePayload {
  action: "confirmed" | "deleted";
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  sessionType: string;
  trainerName: string;
}

interface FcmTokenDoc {
  token?: string;
  platform?: string;
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

function normalizeSlotInterval(value: unknown): number {
  return value === 30 || value === 45 || value === 60 ? value : DEFAULT_SITE_CONFIG.slotInterval;
}

function normalizeHour(value: unknown, fallback: number): number {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.max(0, Math.min(23, Math.trunc(hour)));
}

function normalizeSiteConfig(config: Partial<SiteConfig> = {}): SiteConfig {
  let startHour = normalizeHour(config.startHour, DEFAULT_SITE_CONFIG.startHour);
  let endHour = normalizeHour(config.endHour, DEFAULT_SITE_CONFIG.endHour);

  if (startHour >= endHour) {
    startHour = DEFAULT_SITE_CONFIG.startHour;
    endHour = DEFAULT_SITE_CONFIG.endHour;
  }

  const expirationMonths = Number(config.bonoExpirationMonths ?? DEFAULT_SITE_CONFIG.bonoExpirationMonths);

  return {
    ...DEFAULT_SITE_CONFIG,
    ...config,
    startHour,
    endHour,
    slotInterval: normalizeSlotInterval(config.slotInterval ?? config.sessionDuration),
    bonoExpirationMonths: Number.isFinite(expirationMonths) ? Math.max(1, Math.trunc(expirationMonths)) : 1,
    maintenanceMode: Boolean(config.maintenanceMode),
  };
}

function generateTimeSlots(config: SiteConfig): string[] {
  const normalizedConfig = normalizeSiteConfig(config);
  const slots: string[] = [];
  const startMinutes = normalizedConfig.startHour * 60;
  const endMinutes = normalizedConfig.endHour * 60;
  for (let minute = startMinutes; minute < endMinutes; minute += normalizedConfig.slotInterval) {
    const hour = Math.floor(minute / 60);
    const min = minute % 60;
    slots.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

function doesSessionFitWithinSchedule(config: SiteConfig, startTime: string, durationMinutes: number): boolean {
  const normalizedConfig = normalizeSiteConfig(config);
  const [hours, minutes] = startTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(durationMinutes)) return false;

  const startMinutes = hours * 60 + minutes;
  const scheduleStart = normalizedConfig.startHour * 60;
  const scheduleEnd = normalizedConfig.endHour * 60;

  return startMinutes >= scheduleStart && startMinutes + durationMinutes <= scheduleEnd;
}

function getSlotBlocks(startTime: string, durationMinutes: number): string[] {
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

function getOverlappingSlotKeys(slot: TimeSlot, durationMinutes: number): Set<string> {
  return new Set(getSlotBlocks(slot.time, durationMinutes).map((time) => `${slot.date}_${time}`));
}

function appointmentSlotKeys(appointment: AppointmentDoc): Set<string> {
  const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0];
  if (!slot) return new Set<string>();
  return getOverlappingSlotKeys(slot, Number.parseInt(appointment.duration, 10));
}

function getBonoMinutosTotales(bono: BonoDoc): number {
  if (typeof bono.tamano === "number" && typeof bono.minutosTotales === "number") {
    return Math.max(bono.tamano, bono.minutosTotales);
  }
  if (typeof bono.minutosTotales === "number") return bono.minutosTotales;
  if (typeof bono.tamano === "number") return bono.tamano;
  const minPerSession = bono.modalidad === "30min" ? 30 : 60;
  return (bono.sesionesTotales ?? 0) * minPerSession;
}

function getBonoMinutosRestantes(bono: BonoDoc): number {
  if (typeof bono.minutosRestantes === "number") {
    const total = getBonoMinutosTotales(bono);
    return Math.max(0, Math.min(bono.minutosRestantes, total));
  }
  const minPerSession = bono.modalidad === "30min" ? 30 : 60;
  return (bono.sesionesRestantes ?? 0) * minPerSession;
}

function getNowDate(): Date {
  return new Date();
}

function slotDateTime(slot: TimeSlot): Date {
  return new Date(`${slot.date}T${slot.time}:00`);
}

function toHttpsError(
  code: "invalid-argument" | "failed-precondition" | "permission-denied" | "resource-exhausted" | "internal",
  message: string,
): HttpsError {
  return new HttpsError(code, message);
}

function normalizeTextField(value: unknown, fieldName: string, maxLength: number, required = true): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw toHttpsError("invalid-argument", `El campo ${fieldName} no es valido.`);
  }

  const text = value.trim();
  if (required && !text) {
    throw toHttpsError("invalid-argument", `El campo ${fieldName} es obligatorio.`);
  }
  if (text.length > maxLength) {
    throw toHttpsError("invalid-argument", `El campo ${fieldName} es demasiado largo.`);
  }

  return text;
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && CONTACT_EMAIL_RE.test(value);
}

function parseContactMessage(data: unknown): ContactMessage {
  if (!isRecord(data)) {
    throw toHttpsError("invalid-argument", "Los datos del formulario no son validos.");
  }

  const honeypot = typeof data.company === "string" ? data.company.trim() : "";
  if (honeypot) {
    throw toHttpsError("invalid-argument", "Los datos del formulario no son validos.");
  }

  const name = normalizeTextField(data.name, "nombre", 120);
  const email = normalizeTextField(data.email, "email", 254);
  const phone = normalizeTextField(data.phone, "telefono", 40, false);
  const subject = normalizeTextField(data.subject, "asunto", 140);
  const message = normalizeTextField(data.message, "mensaje", 3000);

  if (!isValidEmail(email)) {
    throw toHttpsError("invalid-argument", "El email no tiene un formato valido.");
  }

  return { name, email, phone, subject, message };
}

function getClientIp(rawRequest: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const forwardedHeader = rawRequest.headers?.["x-forwarded-for"];
  const forwarded = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  return forwarded?.split(",")[0]?.trim() || rawRequest.ip || "unknown";
}

function rateLimitDocId(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

async function enforceContactRateLimit(docId: string): Promise<void> {
  const now = Date.now();
  const ref = db.collection("contact_rate_limits").doc(docId);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : undefined;
    const windowStartMillis = typeof data?.windowStartMillis === "number" ? data.windowStartMillis : 0;
    const count = typeof data?.count === "number" ? data.count : 0;
    const resetWindow = !snap.exists || now - windowStartMillis >= CONTACT_RATE_LIMIT_WINDOW_MS;

    if (resetWindow) {
      transaction.set(ref, {
        windowStartMillis: now,
        count: 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    if (count >= CONTACT_RATE_LIMIT_MAX_REQUESTS) {
      throw toHttpsError("resource-exhausted", "Has enviado demasiados mensajes. Intentalo de nuevo mas tarde.");
    }

    transaction.set(ref, {
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function getNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return "";
    current = current[segment];
  }
  return typeof current === "string" ? current.trim() : "";
}

async function resolveContactRecipientEmail(): Promise<string> {
  const snap = await db.collection("site_content").doc("main").get();
  const data = snap.exists ? snap.data() : undefined;
  const formRecipientEmail = getNestedString(data, ["contacto", "formRecipientEmail"]);
  if (isValidEmail(formRecipientEmail)) return formRecipientEmail;

  const publicEmail = getNestedString(data, ["email"]);
  if (isValidEmail(publicEmail)) return publicEmail;

  throw toHttpsError("failed-precondition", "No hay un email receptor valido configurado.");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSubmittedAt(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function buildContactEmail(message: ContactMessage, submittedAt: Date): { subject: string; html: string; text: string } {
  const displayDate = formatSubmittedAt(submittedAt);
  const subject = `Nuevo mensaje de contacto - Focus Club - ${message.subject}`;
  const rows = [
    ["Nombre", message.name],
    ["Email", message.email],
    ["Telefono", message.phone || "No indicado"],
    ["Asunto", message.subject],
    ["Fecha/hora", displayDate],
  ];

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(value)}</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
      <h1 style="font-size:20px;margin:0 0 16px;">Nuevo mensaje de contacto</h1>
      <table style="border-collapse:collapse;width:100%;max-width:640px;margin-bottom:20px;">${htmlRows}</table>
      <h2 style="font-size:16px;margin:0 0 8px;">Mensaje</h2>
      <div style="white-space:pre-wrap;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">${escapeHtml(message.message)}</div>
    </div>
  `;

  const text = [
    "Nuevo mensaje de contacto",
    "",
    `Nombre: ${message.name}`,
    `Email: ${message.email}`,
    `Telefono: ${message.phone || "No indicado"}`,
    `Asunto: ${message.subject}`,
    `Fecha/hora: ${displayDate}`,
    "",
    "Mensaje:",
    message.message,
  ].join("\n");

  return { subject, html, text };
}

async function saveContactSubmission(
  message: ContactMessage,
  recipientEmail: string,
  createdAt: string,
  status: "sent" | "failed",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await db.collection("contact_submissions").add({
    name: message.name,
    email: message.email,
    phone: message.phone,
    subject: message.subject,
    message: message.message,
    recipientEmail,
    createdAt,
    status,
    source: "website",
    ...extra,
  });
}

async function resolveTrainerName(trainerId?: string): Promise<string> {
  if (!trainerId) return "";
  const trainerSnap = await db.collection("trainers").doc(trainerId).get();
  if (!trainerSnap.exists) return "";
  const trainer = trainerSnap.data() as TrainerDoc;
  return trainer.name ?? "";
}

async function sendMakeWebhook(payload: MakePayload): Promise<void> {
  const webhookUrl = MAKE_WEBHOOK_URL.value();
  if (!webhookUrl) {
    console.warn("[Make] Secret MAKE_WEBHOOK_URL is not configured. Skipping webhook.");
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Make webhook failed with status ${response.status}`);
  }
}

function buildMakePayload(action: "confirmed" | "deleted", appointment: AppointmentDoc, trainerName: string): MakePayload {
  const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0];
  return {
    action,
    customerName: appointment.name,
    customerEmail: appointment.email,
    date: slot?.date ?? "",
    time: slot?.time ?? "",
    sessionType: appointment.sessionType || appointment.serviceType || "",
    trainerName,
  };
}

function notificationSlot(appointment: AppointmentDoc): TimeSlot | undefined {
  return appointment.approvedSlot
    ?? appointment.preferredSlots?.[0]
    ?? (appointment.date && appointment.time ? { date: appointment.date, time: appointment.time } : undefined);
}

function appointmentStatusNotification(status: "approved" | "rejected", appointment: AppointmentDoc): { title: string; body: string } {
  if (status === "approved") {
    const slot = notificationSlot(appointment);
    return {
      title: "Cita aprobada",
      body: `Tu sesion del ${slot?.date ?? ""} a las ${slot?.time ?? ""} ha sido aprobada.`,
    };
  }

  return {
    title: "Cita rechazada",
    body: "Tu solicitud de cita no ha podido ser aprobada. Revisa tus citas en la app.",
  };
}

function isInvalidFcmTokenError(code?: string): boolean {
  return code === "messaging/registration-token-not-registered"
    || code === "messaging/invalid-registration-token";
}

export const sendContactMessage = onCall<ContactMessageRequest>(
  {
    region: REGION,
    secrets: [RESEND_API_KEY],
  },
  async (request) => {
    const contactMessage = parseContactMessage(request.data);
    const submittedAt = new Date();
    const createdAt = submittedAt.toISOString();
    const ip = getClientIp(request.rawRequest);
    await enforceContactRateLimit(rateLimitDocId(ip));

    let recipientEmail = "";
    try {
      recipientEmail = await resolveContactRecipientEmail();
    } catch (error) {
      await saveContactSubmission(contactMessage, recipientEmail, createdAt, "failed", {
        errorMessage: error instanceof Error ? error.message : "No hay email receptor valido.",
      });
      throw error;
    }

    const resend = new Resend(RESEND_API_KEY.value());
    const email = buildContactEmail(contactMessage, submittedAt);

    try {
      const result = await resend.emails.send({
        from: CONTACT_EMAIL_FROM,
        to: [recipientEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: contactMessage.email,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      await saveContactSubmission(contactMessage, recipientEmail, createdAt, "sent", {
        resendEmailId: result.data?.id ?? "",
      });

      return { success: true };
    } catch (error) {
      console.error("[Contact] Failed to send contact email", error);
      await saveContactSubmission(contactMessage, recipientEmail, createdAt, "failed", {
        errorMessage: error instanceof Error ? error.message : "Error desconocido al enviar el email.",
      });
      throw toHttpsError("internal", "No se ha podido enviar el mensaje. Intentalo de nuevo mas tarde.");
    }
  },
);

export const createAppointment = onCall<CreateAppointmentRequest>(
  {
    region: REGION,
  },
  async (request) => {
    if (!request.auth) {
      throw toHttpsError("permission-denied", "Debes iniciar sesión para reservar una sesión.");
    }

    if (request.auth.token.email_verified !== true) {
      throw toHttpsError("permission-denied", "Debes verificar tu correo antes de reservar una sesión.");
    }

    const data = request.data;
    if (!isRecord(data) || !isTimeSlot(data.preferredSlot) || !["30", "45", "60"].includes(String(data.duration))) {
      throw toHttpsError("invalid-argument", "Los datos de la reserva no son válidos.");
    }

    const duration = String(data.duration) as AppointmentDuration;
    const preferredSlot = data.preferredSlot;
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    const durationMinutes = Number.parseInt(duration, 10);
    const userId = request.auth.uid;

    const appointmentRef = db.collection("appointments").doc();
    const userRef = db.collection("users").doc(userId);
    const siteConfigRef = db.collection("site_config").doc("main");

    const slotBlocks = getSlotBlocks(preferredSlot.time, durationMinutes);
    const targetSlotKeys = new Set(slotBlocks.map((time) => `${preferredSlot.date}_${time}`));

    const blockedSlotsQuery = db.collection("blocked_slots")
      .where("date", "==", preferredSlot.date);

    const occupancyQuery = db.collection("slot_occupancy")
      .where("date", "==", preferredSlot.date);

    const userAppointmentsQuery = db.collection("appointments")
      .where("userId", "==", userId)
      .where("status", "in", ["pending", "approved"]);

    const bonosQuery = db.collection("bonos")
      .where("userId", "==", userId)
      .where("estado", "==", "activo")
      .limit(1);

    const appointmentId = await db.runTransaction(async (transaction) => {
      const [
        userSnap,
        siteConfigSnap,
        blockedSlotsSnap,
        occupancySnap,
        userAppointmentsSnap,
        bonosSnap,
      ] = await Promise.all([
        transaction.get(userRef),
        transaction.get(siteConfigRef),
        transaction.get(blockedSlotsQuery),
        transaction.get(occupancyQuery),
        transaction.get(userAppointmentsQuery),
        transaction.get(bonosQuery),
      ]);

      if (!userSnap.exists) {
        throw toHttpsError("failed-precondition", "No se ha encontrado tu perfil de usuario.");
      }

      const userProfile = userSnap.data() as UserProfile;
      if (!userProfile.name || !userProfile.email) {
        throw toHttpsError("failed-precondition", "Tu perfil no está completo para poder reservar.");
      }

      if (bonosSnap.empty) {
        throw toHttpsError("failed-precondition", "No tienes un bono activo. Consulta en el gimnasio para adquirir uno.");
      }

      const bonoDoc = bonosSnap.docs[0];
      const bono = { id: bonoDoc.id, ...bonoDoc.data() } as BonoDoc;
      if (bono.fechaExpiracion && new Date(bono.fechaExpiracion) < getNowDate()) {
        throw toHttpsError("failed-precondition", "Tu bono activo está expirado. Consulta en el gimnasio para renovarlo.");
      }

      const availableMinutes = getBonoMinutosRestantes(bono);
      if (availableMinutes < durationMinutes) {
        throw toHttpsError(
          "failed-precondition",
          `No tienes suficientes minutos disponibles. Te quedan ${availableMinutes} min y la sesión requiere ${durationMinutes} min.`,
        );
      }

      const slotDate = slotDateTime(preferredSlot);
      if (Number.isNaN(slotDate.getTime()) || slotDate <= getNowDate()) {
        throw toHttpsError("failed-precondition", "La franja seleccionada ya no está disponible.");
      }

      const config = siteConfigSnap.exists
        ? normalizeSiteConfig(siteConfigSnap.data() as Partial<SiteConfig>)
        : normalizeSiteConfig();
      const validSlots = new Set(generateTimeSlots(config));
      if (!validSlots.has(preferredSlot.time) || !doesSessionFitWithinSchedule(config, preferredSlot.time, durationMinutes)) {
        throw toHttpsError("failed-precondition", "La franja seleccionada no es válida.");
      }

      const blockedTimes = new Set<string>();
      blockedSlotsSnap.docs.forEach((docSnap) => {
        const blocked = docSnap.data() as TimeSlot;
        if (typeof blocked.time === "string") {
          blockedTimes.add(blocked.time);
        }
      });
      if (slotBlocks.some((time) => blockedTimes.has(time))) {
        throw toHttpsError("failed-precondition", "La franja seleccionada ya no está disponible.");
      }

      const occupancyByTime = new Map<string, number>();
      occupancySnap.docs.forEach((docSnap) => {
        const occupancy = docSnap.data() as SlotOccupancy;
        occupancyByTime.set(occupancy.time, occupancy.count ?? 0);
      });
      if (slotBlocks.some((time) => (occupancyByTime.get(time) ?? 0) >= MAX_CAPACITY)) {
        throw toHttpsError("failed-precondition", "La franja seleccionada ya no está disponible.");
      }

      const hasConflict = userAppointmentsSnap.docs.some((docSnap) => {
        const appointment = docSnap.data() as AppointmentDoc;
        const existingKeys = appointmentSlotKeys(appointment);
        for (const key of existingKeys) {
          if (targetSlotKeys.has(key)) {
            return true;
          }
        }
        return false;
      });
      if (hasConflict) {
        throw toHttpsError("failed-precondition", "Ya tienes una sesión reservada en esta franja.");
      }

      const appointment: AppointmentDoc = {
        userId,
        name: userProfile.name,
        email: userProfile.email,
        phone: userProfile.phone || "",
        serviceType: APPOINTMENT_SERVICE_TYPE,
        duration,
        preferredSlots: [preferredSlot],
        reason,
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      transaction.create(appointmentRef, appointment);
      return appointmentRef.id;
    });

    return { appointmentId };
  },
);

export const onAppointmentApproved = onDocumentUpdated(
  {
    document: "appointments/{appointmentId}",
    region: REGION,
    secrets: [MAKE_WEBHOOK_URL],
  },
  async (event) => {
    const before = event.data?.before.data() as AppointmentDoc | undefined;
    const after = event.data?.after.data() as AppointmentDoc | undefined;

    if (!before || !after) return;
    if (before.status === "approved" || after.status !== "approved") return;

    const trainerName = await resolveTrainerName(after.assignedTrainer);
    await sendMakeWebhook(buildMakePayload("confirmed", after, trainerName));
  },
);

export const onAppointmentDeleted = onDocumentDeleted(
  {
    document: "appointments/{appointmentId}",
    region: REGION,
    secrets: [MAKE_WEBHOOK_URL],
  },
  async (event) => {
    const appointment = event.data?.data() as AppointmentDoc | undefined;
    if (!appointment) return;

    const trainerName = await resolveTrainerName(appointment.assignedTrainer);
    await sendMakeWebhook(buildMakePayload("deleted", appointment, trainerName));
  },
);

export const onAppointmentStatusPushNotification = onDocumentUpdated(
  {
    document: "appointments/{appointmentId}",
    region: REGION,
  },
  async (event) => {
    const before = event.data?.before.data() as AppointmentDoc | undefined;
    const after = event.data?.after.data() as AppointmentDoc | undefined;
    const appointmentId = String(event.params.appointmentId);

    if (!before || !after) return;

    const changedToApproved = before.status !== "approved" && after.status === "approved";
    const changedToRejected = before.status !== "rejected" && after.status === "rejected";
    if (!changedToApproved && !changedToRejected) return;

    const status = after.status as "approved" | "rejected";
    const userSnap = await db.collection("users").doc(after.userId).get();
    const user = userSnap.data() as UserProfile | undefined;
    if (!user || user.pushNotificationsEnabled !== true) return;

    const tokenSnap = await userSnap.ref.collection("fcmTokens").get();
    const tokenRefs = tokenSnap.docs
      .map((docSnap) => {
        const tokenDoc = docSnap.data() as FcmTokenDoc;
        const token = typeof tokenDoc.token === "string" ? tokenDoc.token.trim() : "";
        return token ? { ref: docSnap.ref, token } : null;
      })
      .filter((entry): entry is { ref: DocumentReference; token: string } => entry !== null);

    if (tokenRefs.length === 0) return;

    const notification = appointmentStatusNotification(status, after);
    const messaging = getMessaging();

    for (let index = 0; index < tokenRefs.length; index += 500) {
      const batch = tokenRefs.slice(index, index + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map((entry) => entry.token),
        notification,
        data: {
          type: "appointment_status",
          appointmentId,
          status,
        },
      });

      await Promise.all(
        response.responses.map((sendResponse, responseIndex) => {
          const code = sendResponse.error?.code;
          if (!sendResponse.success && isInvalidFcmTokenError(code)) {
            return batch[responseIndex].ref.delete();
          }
          return Promise.resolve();
        }),
      );
    }
  },
);
