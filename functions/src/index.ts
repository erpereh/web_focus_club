import { initializeApp } from "firebase-admin/app";
import { createHash, randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { DocumentReference, FieldValue, getFirestore, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { calendar_v3, google } from "googleapis";
import { Resend } from "resend";
import {
  buildCalendarEventPayload,
  buildCalendarSyncHash,
  normalizeAppointmentStatus,
  onlyGoogleCalendarSyncFieldsChanged,
} from "./googleCalendarSync";
import { createSupportChatHandlers, type SupportChatNotificationInput } from "./supportChat";

initializeApp();

const db = getFirestore();
const MAKE_WEBHOOK_URL = defineSecret("MAKE_WEBHOOK_URL");
const MAKE_WELCOME_WEBHOOK_URL = defineSecret("MAKE_WELCOME_WEBHOOK_URL");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const GOOGLE_CALENDAR_ID = defineSecret("GOOGLE_CALENDAR_ID");
const REGION = "europe-west1";
const MAX_CAPACITY = 2;
const APPOINTMENT_SERVICE_TYPE = "Bono Mensual de Entrenamiento";
const ADMIN_NOTIFICATION_EMAIL = "infofocusclub2026@gmail.com";
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
const supportChat = createSupportChatHandlers(db, {
  notifySupportCustomer: sendSupportMessagePushNotificationSafely,
});

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
  role?: AdminUserRole;
  isTrainer?: boolean;
  pushNotificationsEnabled?: boolean;
}

type AdminUserRole = "admin" | "trainer" | "user";
type AdminUserAccessMethod = "password" | "email-reset";

interface CreateUserFromAdminRequest {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  accessMethod?: unknown;
  password?: unknown;
}

interface UpdateUserFromAdminRequest {
  targetUid?: unknown;
  name?: unknown;
  phone?: unknown;
  role?: unknown;
}

interface DeleteUserFromAdminRequest {
  targetUid?: unknown;
}

interface CreateAppointmentFromAdminRequest {
  userId?: unknown;
  date?: unknown;
  time?: unknown;
  durationMinutes?: unknown;
  serviceType?: unknown;
  assignedTrainer?: unknown;
  status?: unknown;
  comment?: unknown;
}

interface ParsedAdminUserData {
  name: string;
  email: string;
  phone: string;
  role: AdminUserRole;
  isTrainer: boolean;
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
  googleCalendarEventId?: string;
  googleCalendarSyncedAt?: string;
  googleCalendarSyncStatus?: "synced" | "error" | "deleted";
  googleCalendarSyncError?: string | null;
  googleCalendarSyncHash?: string;
  createdByAdmin?: boolean;
  createdByAdminUid?: string;
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
  active?: boolean;
}

interface ServiceDoc {
  title?: string;
  duration?: string;
  active?: boolean;
}

interface MakePayload {
  action: "confirmed" | "deleted";
  recipientType: "customer" | "admin";
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  sessionType: string;
  trainerName: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  appointmentStatus?: AppointmentDoc["status"] | "deleted";
  appointmentId?: string;
  duration?: AppointmentDuration;
  serviceType?: string;
}

interface WelcomeWebhookPayload {
  event: "user_welcome";
  recipientType: "customer";
  customerName: string;
  customerEmail: string;
  appName: "Focus Club";
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

async function sendWelcomeWebhook(payload: WelcomeWebhookPayload): Promise<void> {
  const webhookUrl = MAKE_WELCOME_WEBHOOK_URL.value();
  if (!webhookUrl) {
    throw new Error("Welcome webhook secret is not configured.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Make welcome webhook failed with status ${response.status}`);
  }
}

function getWelcomeCustomerName(data: Record<string, unknown>, email: string): string {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name) return name;

  const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
  if (displayName) return displayName;

  return email.split("@")[0] || email;
}

function shortErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Unknown welcome webhook error.";
  return rawMessage
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .slice(0, 180);
}

function buildMakePayload(
  action: "confirmed" | "deleted",
  appointment: AppointmentDoc,
  trainerName: string,
  recipientType: "customer" | "admin",
  recipientEmail: string,
  appointmentId?: string,
  appointmentStatus: AppointmentDoc["status"] | "deleted" = appointment.status,
): MakePayload {
  const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0];
  const payload: MakePayload = {
    action,
    recipientType,
    customerName: appointment.name,
    customerEmail: recipientEmail,
    date: slot?.date ?? "",
    time: slot?.time ?? "",
    sessionType: appointment.sessionType || appointment.serviceType || "",
    trainerName,
  };

  if (recipientType === "admin") {
    payload.clientName = appointment.name;
    payload.clientEmail = appointment.email;
    payload.clientPhone = appointment.phone;
    payload.appointmentStatus = appointmentStatus;
    payload.appointmentId = appointmentId;
    payload.duration = appointment.duration;
    payload.serviceType = appointment.serviceType;
  }

  return payload;
}

async function sendAppointmentMakeNotification(
  appointmentId: string,
  appointment: AppointmentDoc,
  action: "confirmed" | "deleted",
  recipientType: "customer" | "admin",
  recipientEmail: string,
  appointmentStatus?: AppointmentDoc["status"] | "deleted",
): Promise<void> {
  const trainerName = await resolveTrainerName(appointment.assignedTrainer);
  await sendMakeWebhook(buildMakePayload(
    action,
    appointment,
    trainerName,
    recipientType,
    recipientEmail,
    appointmentId,
    appointmentStatus,
  ));
  console.log("[Make] Appointment notification sent", {
    appointmentId,
    action,
    recipientType,
    recipientEmail,
  });
}

async function sendAppointmentMakeNotificationSafely(
  appointmentId: string,
  appointment: AppointmentDoc,
  action: "confirmed" | "deleted",
  recipientType: "customer" | "admin",
  recipientEmail: string,
  appointmentStatus?: AppointmentDoc["status"] | "deleted",
): Promise<void> {
  try {
    await sendAppointmentMakeNotification(
      appointmentId,
      appointment,
      action,
      recipientType,
      recipientEmail,
      appointmentStatus,
    );
  } catch (error) {
    console.error("[Make] Failed to send appointment notification", {
      appointmentId,
      action,
      recipientType,
      recipientEmail,
      error,
    });
  }
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

async function sendUserPushNotification(
  userId: string,
  notification: { title: string; body: string },
  data: Record<string, string>,
): Promise<void> {
  const userSnap = await db.collection("users").doc(userId).get();
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

  const messaging = getMessaging();

  for (let index = 0; index < tokenRefs.length; index += 500) {
    const batch = tokenRefs.slice(index, index + 500);
    const response = await messaging.sendEachForMulticast({
      tokens: batch.map((entry) => entry.token),
      notification,
      data,
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
}

async function sendAppointmentStatusPushNotification(
  appointmentId: string,
  appointment: AppointmentDoc,
  status: "approved" | "rejected",
): Promise<void> {
  await sendUserPushNotification(
    appointment.userId,
    appointmentStatusNotification(status, appointment),
    {
      type: "appointment_status",
      appointmentId,
      status,
    },
  );
}

async function sendSupportMessagePushNotificationSafely(
  input: SupportChatNotificationInput,
): Promise<void> {
  try {
    await sendUserPushNotification(
      input.userId,
      {
        title: "Nuevo mensaje de Focus Club",
        body: "Tienes una nueva respuesta en el chat.",
      },
      {
        type: "support_message",
        conversationId: input.conversationId,
      },
    );
  } catch (_) {
    console.error("Support message push notification failed.");
  }
}

function googleCalendarErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  if (typeof error.code === "number") return error.code;
  if (typeof error.status === "number") return error.status;

  const response = error.response;
  if (isRecord(response) && typeof response.status === "number") return response.status;

  return undefined;
}

function isGoogleCalendarMissingEventError(error: unknown): boolean {
  const status = googleCalendarErrorStatus(error);
  return status === 404 || status === 410;
}

function shortGoogleCalendarError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error desconocido al sincronizar Google Calendar.";
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

function getGoogleCalendarService(): calendar_v3.Calendar {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return google.calendar({ version: "v3", auth });
}

function getGoogleCalendarId(): string {
  const calendarId = GOOGLE_CALENDAR_ID.value().trim();
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID no esta configurado.");
  }
  return calendarId;
}

async function resolveAppointmentClient(appointment: AppointmentDoc): Promise<{ name: string; email: string; phone: string }> {
  if (appointment.userId) {
    const userSnap = await db.collection("users").doc(appointment.userId).get();
    if (userSnap.exists) {
      const user = userSnap.data() as Partial<UserProfile> | undefined;
      return {
        name: user?.name || appointment.name || "Cliente",
        email: user?.email || appointment.email || "",
        phone: user?.phone || appointment.phone || "",
      };
    }
  }

  return {
    name: appointment.name || "Cliente",
    email: appointment.email || "",
    phone: appointment.phone || "",
  };
}

async function deleteGoogleCalendarEventIfExists(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId?: string,
): Promise<void> {
  if (!eventId) return;

  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "none",
    });
  } catch (error) {
    if (isGoogleCalendarMissingEventError(error)) return;
    throw error;
  }
}

async function writeGoogleCalendarSyncError(ref: DocumentReference, error: unknown): Promise<void> {
  await ref.set({
    googleCalendarSyncStatus: "error",
    googleCalendarSyncError: shortGoogleCalendarError(error),
  }, { merge: true });
}

async function upsertGoogleCalendarEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string | undefined,
  payload: calendar_v3.Schema$Event,
): Promise<string> {
  if (eventId) {
    try {
      const response = await calendar.events.update({
        calendarId,
        eventId,
        requestBody: payload,
        sendUpdates: "none",
      });
      return response.data.id ?? eventId;
    } catch (error) {
      if (!isGoogleCalendarMissingEventError(error)) throw error;
    }
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: payload,
    sendUpdates: "none",
  });
  const createdEventId = response.data.id;
  if (!createdEventId) {
    throw new Error("Google Calendar no devolvio ID de evento.");
  }
  return createdEventId;
}

function parseAdminUserRole(value: unknown): AdminUserRole {
  if (value === "admin" || value === "trainer" || value === "user") {
    return value;
  }
  throw toHttpsError("invalid-argument", "El rol seleccionado no es valido.");
}

function getIsTrainerForRole(role: AdminUserRole): boolean {
  return role === "trainer";
}

function parseCreateUserFromAdminData(data: unknown): ParsedAdminUserData & {
  accessMethod: AdminUserAccessMethod;
  password?: string;
} {
  if (!isRecord(data)) {
    throw toHttpsError("invalid-argument", "Los datos del cliente no son validos.");
  }

  const name = normalizeTextField(data.name, "nombre", 120);
  const email = normalizeTextField(data.email, "email", 254).toLowerCase();
  const phone = normalizeTextField(data.phone, "telefono", 40, false);
  const role = parseAdminUserRole(data.role);
  const accessMethod = data.accessMethod;

  if (!isValidEmail(email)) {
    throw toHttpsError("invalid-argument", "El email no tiene un formato valido.");
  }
  if (accessMethod !== "password" && accessMethod !== "email-reset") {
    throw toHttpsError("invalid-argument", "El metodo de acceso no es valido.");
  }

  if (accessMethod === "password") {
    const password = normalizeTextField(data.password, "contrasena temporal", 128);
    if (password.length < 8) {
      throw toHttpsError("invalid-argument", "La contrasena temporal debe tener al menos 8 caracteres.");
    }
    return {
      name,
      email,
      phone,
      role,
      isTrainer: getIsTrainerForRole(role),
      accessMethod,
      password,
    };
  }

  return {
    name,
    email,
    phone,
    role,
    isTrainer: getIsTrainerForRole(role),
    accessMethod,
  };
}

function parseUpdateUserFromAdminData(data: unknown): ParsedAdminUserData & { targetUid: string } {
  if (!isRecord(data)) {
    throw toHttpsError("invalid-argument", "Los datos del cliente no son validos.");
  }

  const targetUid = normalizeTextField(data.targetUid, "usuario", 128);
  const name = normalizeTextField(data.name, "nombre", 120);
  const phone = normalizeTextField(data.phone, "telefono", 40, false);
  const role = parseAdminUserRole(data.role);

  return {
    targetUid,
    name,
    email: "",
    phone,
    role,
    isTrainer: getIsTrainerForRole(role),
  };
}

function parseDeleteUserFromAdminData(data: unknown): { targetUid: string } {
  if (!isRecord(data)) {
    throw toHttpsError("invalid-argument", "Los datos del cliente no son validos.");
  }

  return {
    targetUid: normalizeTextField(data.targetUid, "usuario", 128),
  };
}

function parseCreateAppointmentFromAdminData(data: unknown): ParsedAdminAppointmentData {
  if (!isRecord(data)) {
    throw toHttpsError("invalid-argument", "Los datos de la cita no son validos.");
  }

  const userId = normalizeTextField(data.userId, "cliente", 128);
  const date = normalizeTextField(data.date, "fecha", 10);
  const time = normalizeTextField(data.time, "hora", 5);
  const durationMinutes = Number(data.durationMinutes);
  const serviceType = normalizeTextField(data.serviceType, "servicio", 180);
  const assignedTrainer = normalizeTextField(data.assignedTrainer, "entrenador", 128);
  const status = data.status;
  const comment = normalizeTextField(data.comment, "comentario", 1000, false);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw toHttpsError("invalid-argument", "La fecha u hora no tiene un formato valido.");
  }
  if (![30, 45, 60].includes(durationMinutes)) {
    throw toHttpsError("invalid-argument", "La duracion de la cita no es valida.");
  }
  if (status !== "pending" && status !== "approved") {
    throw toHttpsError("invalid-argument", "El estado inicial de la cita no es valido.");
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
  };
}

function generateTemporaryPassword(): string {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

async function requireAdmin(requestUid: string): Promise<UserProfile> {
  const adminSnap = await db.collection("users").doc(requestUid).get();
  const adminProfile = adminSnap.exists ? adminSnap.data() as UserProfile : undefined;
  if (!adminProfile || adminProfile.role !== "admin") {
    throw toHttpsError("permission-denied", "Permisos insuficientes.");
  }
  return adminProfile;
}

async function getTrainerDocsByUid(uid: string) {
  return db.collection("trainers").where("uid", "==", uid).get();
}

async function syncTrainerProfile(uid: string, name: string, role: AdminUserRole): Promise<void> {
  const trainerSnap = await getTrainerDocsByUid(uid);

  if (role === "trainer") {
    if (trainerSnap.empty) {
      await db.collection("trainers").add({
        uid,
        name,
        active: true,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const batch = db.batch();
    trainerSnap.docs.forEach((docSnap) => {
      batch.set(docSnap.ref, { name, active: true }, { merge: true });
    });
    await batch.commit();
    return;
  }

  if (!trainerSnap.empty) {
    const batch = db.batch();
    trainerSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
}

async function deleteTrainerProfile(uid: string): Promise<void> {
  const [trainerDocSnap, trainerQuerySnap] = await Promise.all([
    db.collection("trainers").doc(uid).get(),
    getTrainerDocsByUid(uid),
  ]);

  const refs = new Map<string, DocumentReference>();
  if (trainerDocSnap.exists) {
    refs.set(trainerDocSnap.ref.path, trainerDocSnap.ref);
  }
  trainerQuerySnap.docs.forEach((docSnap) => {
    refs.set(docSnap.ref.path, docSnap.ref);
  });

  if (refs.size === 0) return;

  const batch = db.batch();
  refs.forEach((ref) => batch.delete(ref));
  await batch.commit();
}

async function addAdminUserActivityLog(data: Record<string, unknown>): Promise<void> {
  try {
    await db.collection("activity_logs").add({
      ...data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[AdminUsers] Failed to write activity log", error);
  }
}

function slotOccupancyDocId(date: string, time: string): string {
  return `${date}_${time}`;
}

function validateAdminAppointmentSlot(
  input: ParsedAdminAppointmentData,
  config: SiteConfig,
  blockedTimes: Set<string>,
  occupancyByTime: Map<string, number>,
  userAppointments: AppointmentDoc[],
): void {
  const slotBlocks = getSlotBlocks(input.slot.time, input.durationMinutes);
  const targetSlotKeys = new Set(slotBlocks.map((time) => `${input.slot.date}_${time}`));

  const slotDate = slotDateTime(input.slot);
  if (Number.isNaN(slotDate.getTime()) || slotDate <= getNowDate()) {
    throw toHttpsError("failed-precondition", "La franja seleccionada ya no esta disponible.");
  }

  const validSlots = new Set(generateTimeSlots(config));
  if (!validSlots.has(input.slot.time) || !doesSessionFitWithinSchedule(config, input.slot.time, input.durationMinutes)) {
    throw toHttpsError("failed-precondition", "La franja seleccionada no es valida para el horario configurado.");
  }

  if (slotBlocks.some((time) => blockedTimes.has(time))) {
    throw toHttpsError("failed-precondition", "La franja seleccionada esta bloqueada.");
  }

  if (slotBlocks.some((time) => (occupancyByTime.get(time) ?? 0) >= MAX_CAPACITY)) {
    throw toHttpsError("failed-precondition", "La franja seleccionada esta llena.");
  }

  const hasConflict = userAppointments.some((appointment) => {
    const existingKeys = appointmentSlotKeys(appointment);
    for (const key of existingKeys) {
      if (targetSlotKeys.has(key)) return true;
    }
    return false;
  });

  if (hasConflict) {
    throw toHttpsError("failed-precondition", "El cliente ya tiene una cita en esta franja.");
  }
}

function applyApprovedAppointmentWrites(
  transaction: Transaction,
  input: ParsedAdminAppointmentData,
  appointmentRef: DocumentReference,
  bonoDoc: QueryDocumentSnapshot | undefined,
  now: string,
): { bonoWarning?: string } {
  const slotBlocks = getSlotBlocks(input.slot.time, input.durationMinutes);
  slotBlocks.forEach((time) => {
    transaction.set(
      db.collection("slot_occupancy").doc(slotOccupancyDocId(input.slot.date, time)),
      { date: input.slot.date, time, count: FieldValue.increment(1) },
      { merge: true },
    );
  });

  if (!bonoDoc) {
    return { bonoWarning: "Cita creada aprobada sin descuento: el cliente no tiene bono activo." };
  }

  const bono = { id: bonoDoc.id, ...bonoDoc.data() } as BonoDoc;
  if (bono.fechaExpiracion && new Date(bono.fechaExpiracion) < getNowDate()) {
    return { bonoWarning: "Cita creada aprobada sin descuento: el bono activo esta expirado." };
  }

  const availableMinutes = getBonoMinutosRestantes(bono);
  if (availableMinutes < input.durationMinutes) {
    return {
      bonoWarning: `Cita creada aprobada sin descuento: el bono solo tiene ${availableMinutes} min disponibles.`,
    };
  }

  const remainingMinutes = Math.max(0, availableMinutes - input.durationMinutes);
  const update: Record<string, unknown> = {
    minutosRestantes: remainingMinutes,
    historial: FieldValue.arrayUnion({
      fecha: now,
      tipo: input.serviceType,
      duracion: input.duration,
      appointmentId: appointmentRef.id,
    }),
  };

  if (remainingMinutes <= 0) {
    update.estado = "agotado";
  }

  transaction.set(bonoDoc.ref, update, { merge: true });
  return {};
}

export const createSupportConversation = onCall(
  { region: REGION },
  supportChat.createSupportConversation,
);

export const sendSupportMessage = onCall(
  { region: REGION },
  supportChat.sendSupportMessage,
);

export const markSupportConversationRead = onCall(
  { region: REGION },
  supportChat.markSupportConversationRead,
);

export const adminSendSupportMessage = onCall(
  { region: REGION },
  supportChat.adminSendSupportMessage,
);

export const closeSupportConversation = onCall(
  { region: REGION },
  supportChat.closeSupportConversation,
);

export const reopenSupportConversation = onCall(
  { region: REGION },
  supportChat.reopenSupportConversation,
);

export const adminHideSupportConversation = onCall(
  { region: REGION },
  supportChat.adminHideSupportConversation,
);

export const createUserFromAdmin = onCall<CreateUserFromAdminRequest>(
  {
    region: REGION,
  },
  async (request) => {
    if (!request.auth) {
      throw toHttpsError("permission-denied", "Debes iniciar sesion como admin.");
    }

    await requireAdmin(request.auth.uid);
    const input = parseCreateUserFromAdminData(request.data);
    const auth = getAuth();

    try {
      await auth.getUserByEmail(input.email);
      throw new HttpsError("already-exists", "Ya existe un usuario con este email.");
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code !== "auth/user-not-found") {
        throw error;
      }
    }

    const password = input.accessMethod === "password" ? input.password : generateTemporaryPassword();
    const createdUser = await auth.createUser({
      email: input.email,
      displayName: input.name,
      password,
      emailVerified: false,
    });

    const now = new Date().toISOString();
    try {
      await db.collection("users").doc(createdUser.uid).set({
        uid: createdUser.uid,
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        isTrainer: input.isTrainer,
        createdAt: now,
        pushNotificationsEnabled: false,
      });

      await syncTrainerProfile(createdUser.uid, input.name, input.role);
    } catch (error) {
      await auth.deleteUser(createdUser.uid).catch((deleteError) => {
        console.error("[AdminUsers] Failed to delete auth user after Firestore error", deleteError);
      });
      throw error;
    }

    await addAdminUserActivityLog({
      action: "user_created_by_admin",
      adminUid: request.auth.uid,
      adminEmail: request.auth.token.email ?? "",
      targetUid: createdUser.uid,
      email: input.email,
      role: input.role,
    });

    return {
      success: true,
      uid: createdUser.uid,
      email: input.email,
    };
  },
);

export const updateUserFromAdmin = onCall<UpdateUserFromAdminRequest>(
  {
    region: REGION,
  },
  async (request) => {
    if (!request.auth) {
      throw toHttpsError("permission-denied", "Debes iniciar sesion como admin.");
    }

    await requireAdmin(request.auth.uid);
    const input = parseUpdateUserFromAdminData(request.data);

    if (input.targetUid === request.auth.uid && input.role !== "admin") {
      throw toHttpsError("permission-denied", "No puedes quitarte tu propio rol admin.");
    }

    const targetRef = db.collection("users").doc(input.targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw toHttpsError("failed-precondition", "No se ha encontrado el usuario indicado.");
    }

    await getAuth().updateUser(input.targetUid, {
      displayName: input.name,
    });

    await targetRef.set({
      name: input.name,
      phone: input.phone,
      role: input.role,
      isTrainer: input.isTrainer,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await syncTrainerProfile(input.targetUid, input.name, input.role);

    const target = targetSnap.data() as UserProfile | undefined;
    await addAdminUserActivityLog({
      action: "user_updated_by_admin",
      adminUid: request.auth.uid,
      adminEmail: request.auth.token.email ?? "",
      targetUid: input.targetUid,
      email: target?.email ?? "",
      role: input.role,
    });

    return {
      success: true,
      uid: input.targetUid,
    };
  },
);

export const deleteUserFromAdmin = onCall<DeleteUserFromAdminRequest>(
  {
    region: REGION,
  },
  async (request) => {
    if (!request.auth) {
      throw toHttpsError("permission-denied", "Debes iniciar sesion como admin.");
    }

    await requireAdmin(request.auth.uid);
    const input = parseDeleteUserFromAdminData(request.data);

    if (input.targetUid === request.auth.uid) {
      throw toHttpsError("failed-precondition", "No puedes eliminar tu propio usuario admin.");
    }

    const targetRef = db.collection("users").doc(input.targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw toHttpsError("failed-precondition", "No se ha encontrado el usuario indicado.");
    }

    const target = targetSnap.data() as UserProfile | undefined;
    const targetEmail = target?.email ?? "";
    const targetName = target?.name ?? "";
    const targetRole = target?.role ?? "";
    const auth = getAuth();

    try {
      await auth.deleteUser(input.targetUid);
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code !== "auth/user-not-found") {
        console.error("[AdminUsers] Failed to delete auth user", input.targetUid, error);
        throw toHttpsError("internal", "No se ha podido eliminar el acceso del usuario.");
      }
    }

    try {
      await Promise.all([
        targetRef.delete(),
        deleteTrainerProfile(input.targetUid),
      ]);
    } catch (error) {
      console.error("[AdminUsers] Failed to delete Firestore user data", input.targetUid, error);
      throw toHttpsError("internal", "No se han podido eliminar los datos basicos del usuario.");
    }

    await addAdminUserActivityLog({
      action: "user_deleted_by_admin",
      adminUid: request.auth.uid,
      adminEmail: request.auth.token.email ?? "",
      targetUid: input.targetUid,
      targetEmail,
      targetName,
      targetRole,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      uid: input.targetUid,
    };
  },
);

export const createAppointmentFromAdmin = onCall<CreateAppointmentFromAdminRequest>(
  {
    region: REGION,
    secrets: [MAKE_WEBHOOK_URL],
  },
  async (request) => {
    if (!request.auth) {
      throw toHttpsError("permission-denied", "Debes iniciar sesion como admin.");
    }

    await requireAdmin(request.auth.uid);
    const adminUid = request.auth.uid;
    const adminEmail = request.auth.token.email ?? "";
    const input = parseCreateAppointmentFromAdminData(request.data);
    const appointmentRef = db.collection("appointments").doc();
    const userRef = db.collection("users").doc(input.userId);
    const trainerRef = db.collection("trainers").doc(input.assignedTrainer);
    const serviceRef = input.serviceType.includes("/")
      ? null
      : db.collection("services").doc(input.serviceType);
    const siteConfigRef = db.collection("site_config").doc("main");
    const blockedSlotsQuery = db.collection("blocked_slots").where("date", "==", input.slot.date);
    const occupancyQuery = db.collection("slot_occupancy").where("date", "==", input.slot.date);
    const userAppointmentsQuery = db.collection("appointments")
      .where("userId", "==", input.userId)
      .where("status", "in", ["pending", "approved"]);
    const serviceTitleQuery = db.collection("services").where("title", "==", input.serviceType).limit(1);
    const bonosQuery = db.collection("bonos")
      .where("userId", "==", input.userId)
      .where("estado", "==", "activo")
      .limit(1);

    const result = await db.runTransaction(async (transaction) => {
      const [
        userSnap,
        trainerSnap,
        serviceIdSnap,
        siteConfigSnap,
        blockedSlotsSnap,
        occupancySnap,
        userAppointmentsSnap,
        serviceTitleSnap,
        bonosSnap,
      ] = await Promise.all([
        transaction.get(userRef),
        transaction.get(trainerRef),
        serviceRef ? transaction.get(serviceRef) : Promise.resolve(undefined),
        transaction.get(siteConfigRef),
        transaction.get(blockedSlotsQuery),
        transaction.get(occupancyQuery),
        transaction.get(userAppointmentsQuery),
        transaction.get(serviceTitleQuery),
        transaction.get(bonosQuery),
      ]);

      if (!userSnap.exists) {
        throw toHttpsError("failed-precondition", "No se ha encontrado el cliente indicado.");
      }

      const userProfile = userSnap.data() as UserProfile;
      if (!userProfile.email || !userProfile.name) {
        throw toHttpsError("failed-precondition", "El perfil del cliente no esta completo.");
      }

      if (!trainerSnap.exists) {
        throw toHttpsError("failed-precondition", "No se ha encontrado el entrenador indicado.");
      }
      const trainer = trainerSnap.data() as TrainerDoc;
      if (trainer.active === false) {
        throw toHttpsError("failed-precondition", "El entrenador seleccionado no esta activo.");
      }

      const service = serviceIdSnap?.exists
        ? serviceIdSnap.data() as ServiceDoc
        : serviceTitleSnap.docs[0]?.data() as ServiceDoc | undefined;
      if (!service) {
        throw toHttpsError("failed-precondition", "No se ha encontrado el servicio seleccionado.");
      }
      if (service.active === false) {
        throw toHttpsError("failed-precondition", "El servicio seleccionado no esta activo.");
      }

      const config = siteConfigSnap.exists
        ? normalizeSiteConfig(siteConfigSnap.data() as Partial<SiteConfig>)
        : normalizeSiteConfig();
      const blockedTimes = new Set<string>();
      blockedSlotsSnap.docs.forEach((docSnap) => {
        const blocked = docSnap.data() as TimeSlot;
        if (typeof blocked.time === "string") blockedTimes.add(blocked.time);
      });
      const occupancyByTime = new Map<string, number>();
      occupancySnap.docs.forEach((docSnap) => {
        const occupancy = docSnap.data() as SlotOccupancy;
        occupancyByTime.set(occupancy.time, occupancy.count ?? 0);
      });
      const userAppointments = userAppointmentsSnap.docs.map((docSnap) => docSnap.data() as AppointmentDoc);

      validateAdminAppointmentSlot(input, config, blockedTimes, occupancyByTime, userAppointments);

      const now = new Date().toISOString();
      const appointment: AppointmentDoc = {
        userId: input.userId,
        name: userProfile.name,
        email: userProfile.email,
        phone: userProfile.phone || "",
        serviceType: input.serviceType,
        sessionType: service.title || input.serviceType,
        duration: input.duration,
        preferredSlots: [input.slot],
        reason: input.comment,
        status: input.status,
        date: input.slot.date,
        time: input.slot.time,
        assignedTrainer: input.assignedTrainer,
        createdByAdmin: true,
        createdByAdminUid: adminUid,
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
          bonosSnap.docs[0],
          now,
        );
        bonoWarning = writeResult.bonoWarning;
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

      return { appointmentId: appointmentRef.id, appointment, bonoWarning };
    });

    if (result.appointment.status === "approved") {
      try {
        await sendAppointmentStatusPushNotification(result.appointmentId, result.appointment, "approved");
      } catch (error) {
        console.error("[Push] Failed to send admin-created approved appointment notification", result.appointmentId, error);
      }

      await Promise.all([
        sendAppointmentMakeNotificationSafely(
          result.appointmentId,
          result.appointment,
          "confirmed",
          "customer",
          result.appointment.email,
        ),
        sendAppointmentMakeNotificationSafely(
          result.appointmentId,
          result.appointment,
          "confirmed",
          "admin",
          ADMIN_NOTIFICATION_EMAIL,
        ),
      ]);
    }

    return {
      success: true,
      appointmentId: result.appointmentId,
      bonoWarning: result.bonoWarning,
    };
  },
);

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

export const syncAppointmentWithGoogleCalendar = onDocumentWritten(
  {
    document: "appointments/{appointmentId}",
    region: REGION,
    secrets: [GOOGLE_CALENDAR_ID],
  },
  async (event) => {
    const appointmentId = String(event.params.appointmentId);
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const before = beforeSnap?.exists ? beforeSnap.data() as AppointmentDoc : undefined;
    const after = afterSnap?.exists ? afterSnap.data() as AppointmentDoc : undefined;
    const previousEventId = after?.googleCalendarEventId || before?.googleCalendarEventId;

    if (!before && !after) return;

    if (before && after && onlyGoogleCalendarSyncFieldsChanged({ ...before }, { ...after })) {
      return;
    }

    if (!after) {
      const calendar = getGoogleCalendarService();
      const calendarId = getGoogleCalendarId();
      await deleteGoogleCalendarEventIfExists(calendar, calendarId, previousEventId);
      return;
    }

    const appointmentRef = afterSnap?.ref;
    if (!appointmentRef) return;

    try {
      const status = normalizeAppointmentStatus(after.status);
      if (!status) {
        throw new Error("Estado de cita no compatible con Google Calendar.");
      }

      const calendar = getGoogleCalendarService();
      const calendarId = getGoogleCalendarId();

      if (status === "rejected") {
        await deleteGoogleCalendarEventIfExists(calendar, calendarId, previousEventId);
        await appointmentRef.set({
          googleCalendarEventId: FieldValue.delete(),
          googleCalendarSyncedAt: new Date().toISOString(),
          googleCalendarSyncStatus: "deleted",
          googleCalendarSyncError: FieldValue.delete(),
          googleCalendarSyncHash: FieldValue.delete(),
        }, { merge: true });
        return;
      }

      const [client, trainerName] = await Promise.all([
        resolveAppointmentClient(after),
        resolveTrainerName(after.assignedTrainer),
      ]);
      const syncHash = buildCalendarSyncHash({
        appointmentId,
        appointment: after,
        client,
        trainerName,
      });

      if (after.googleCalendarEventId && after.googleCalendarSyncHash === syncHash) {
        return;
      }

      const eventPayload = buildCalendarEventPayload({
        appointmentId,
        appointment: after,
        client,
        trainerName,
      });
      if (!eventPayload) {
        throw new Error("No hay fecha/hora valida para sincronizar con Google Calendar.");
      }

      const syncedEventId = await upsertGoogleCalendarEvent(
        calendar,
        calendarId,
        after.googleCalendarEventId,
        eventPayload,
      );

      await appointmentRef.set({
        googleCalendarEventId: syncedEventId,
        googleCalendarSyncedAt: new Date().toISOString(),
        googleCalendarSyncStatus: "synced",
        googleCalendarSyncError: FieldValue.delete(),
        googleCalendarSyncHash: syncHash,
      }, { merge: true });
    } catch (error) {
      console.error("[GoogleCalendar] Failed to sync appointment", appointmentId, error);
      await writeGoogleCalendarSyncError(appointmentRef, error);
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

export const onUserProfileCreatedWelcomeEmail = onDocumentCreated(
  {
    document: "users/{uid}",
    region: REGION,
    secrets: [MAKE_WELCOME_WEBHOOK_URL],
  },
  async (event) => {
    const userSnap = event.data;
    const uid = String(event.params.uid);

    if (!userSnap) return;

    const data = userSnap.data();
    if (!data) return;

    if (data.welcomeEmailSentAt) {
      console.log("[WelcomeEmail] Welcome email already sent. Skipping webhook.", { uid });
      return;
    }

    const email = typeof data.email === "string" ? data.email.trim() : "";
    if (!isValidEmail(email)) {
      console.warn("[WelcomeEmail] User profile has no valid email. Skipping webhook.", { uid });
      return;
    }

    const payload: WelcomeWebhookPayload = {
      event: "user_welcome",
      recipientType: "customer",
      customerName: getWelcomeCustomerName(data, email),
      customerEmail: email,
      appName: "Focus Club",
    };

    try {
      await sendWelcomeWebhook(payload);

      const now = new Date().toISOString();
      await userSnap.ref.set({
        welcomeEmailSentAt: now,
        welcomeEmailStatus: "sent",
        welcomeEmailLastAttemptAt: now,
      }, { merge: true });

      console.log("[WelcomeEmail] Welcome webhook sent.", { uid });
    } catch (error) {
      const now = new Date().toISOString();
      const errorMessage = shortErrorMessage(error);

      console.error("[WelcomeEmail] Failed to send welcome webhook.", {
        uid,
        error: errorMessage,
      });

      try {
        await userSnap.ref.set({
          welcomeEmailStatus: "failed",
          welcomeEmailLastAttemptAt: now,
          welcomeEmailLastError: errorMessage,
        }, { merge: true });
      } catch (writeError) {
        console.error("[WelcomeEmail] Failed to store welcome email failure status.", {
          uid,
          error: shortErrorMessage(writeError),
        });
      }
    }
  },
);

export const onAppointmentCreated = onDocumentCreated(
  {
    document: "appointments/{appointmentId}",
    region: REGION,
    secrets: [MAKE_WEBHOOK_URL],
  },
  async (event) => {
    const appointment = event.data?.data() as AppointmentDoc | undefined;
    const appointmentId = String(event.params.appointmentId);

    if (!appointment || appointment.status !== "pending") return;

    await sendAppointmentMakeNotificationSafely(
      appointmentId,
      appointment,
      "confirmed",
      "admin",
      ADMIN_NOTIFICATION_EMAIL,
    );
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
    const appointmentId = String(event.params.appointmentId);

    if (!before || !after) return;

    const changedToApproved = before.status !== "approved" && after.status === "approved";
    const changedToRejected = before.status !== "rejected" && after.status === "rejected";
    if (!changedToApproved && !changedToRejected) return;

    const action = changedToApproved ? "confirmed" : "deleted";
    await Promise.all([
      sendAppointmentMakeNotificationSafely(appointmentId, after, action, "customer", after.email),
      sendAppointmentMakeNotificationSafely(appointmentId, after, action, "admin", ADMIN_NOTIFICATION_EMAIL),
    ]);
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
    const appointmentId = String(event.params.appointmentId);
    if (!appointment) return;

    await Promise.all([
      sendAppointmentMakeNotificationSafely(
        appointmentId,
        appointment,
        "deleted",
        "customer",
        appointment.email,
        "deleted",
      ),
      sendAppointmentMakeNotificationSafely(
        appointmentId,
        appointment,
        "deleted",
        "admin",
        ADMIN_NOTIFICATION_EMAIL,
        "deleted",
      ),
    ]);
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
    await sendAppointmentStatusPushNotification(appointmentId, after, status);
  },
);
