import { createHash } from "node:crypto";
import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

export type CustomerSuggestionStatus = "new" | "reviewed" | "archived";

export interface CustomerSuggestion {
  userId: string;
  userName: string;
  userEmail: string;
  subject: string | null;
  message: string;
  status: CustomerSuggestionStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  reviewedAt: Timestamp | null;
  reviewedBy: string | null;
  reviewedByEmail: string | null;
  archivedAt: Timestamp | null;
  archivedBy: string | null;
  archivedByEmail: string | null;
}

export interface CustomerSuggestionMakeEvent {
  event: "customer_suggestion";
  suggestionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string | null;
  message: string;
  createdAt: string;
}

interface UserProfile {
  name?: unknown;
  email?: unknown;
  role?: unknown;
}

interface CustomerSuggestionPayload {
  subject: string | null;
  message: string;
}

interface CustomerIdentity {
  uid: string;
  name: string;
  email: string;
}

interface AdminIdentity {
  uid: string;
  email: string;
}

interface RateLimitData {
  windowStartMillis?: unknown;
  count?: unknown;
  lastContentHash?: unknown;
  lastSubmittedAtMillis?: unknown;
}

interface CustomerSuggestionHandlerOptions {
  now?: () => number;
  serverTimestamp?: () => unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_ROLES = new Set(["user", "customer"]);
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const DUPLICATE_COOLDOWN_MS = 60 * 1000;

export function normalizeCustomerSuggestionPayload(data: unknown): CustomerSuggestionPayload {
  const payload = requireRecord(data, "Los datos de la sugerencia no son validos.");
  const message = normalizeRequiredText(payload.message, "mensaje", 3, 2000);
  if (payload.subject !== undefined && typeof payload.subject !== "string") {
    throw new HttpsError("invalid-argument", "El campo asunto no es valido.");
  }
  const subject = normalizeOptionalText(payload.subject);
  if (subject.length > 120) {
    throw new HttpsError("invalid-argument", "El campo asunto es demasiado largo.");
  }
  return { subject: subject || null, message };
}

export function createCustomerSuggestionHandlers(
  db: Firestore,
  {
    now = () => Date.now(),
    serverTimestamp = () => FieldValue.serverTimestamp(),
  }: CustomerSuggestionHandlerOptions = {},
) {
  return {
    submitCustomerSuggestion: async (request: CallableRequest<unknown>) => {
      const customer = await requireCustomer(db, request);
      const payload = normalizeCustomerSuggestionPayload(request.data);
      const nowMillis = now();
      const contentHash = hashSuggestionContent(payload);
      const suggestionRef = db.collection("customer_suggestions").doc();
      const rateLimitRef = db.collection("customer_suggestion_rate_limits").doc(customer.uid);
      const timestamp = serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const rateLimitSnap = await transaction.get(rateLimitRef);
        const rateLimit = rateLimitSnap.exists ? rateLimitSnap.data() as RateLimitData : undefined;
        const nextRateLimit = getNextRateLimit(rateLimit, nowMillis, contentHash);

        transaction.create(suggestionRef, {
          userId: customer.uid,
          userName: customer.name,
          userEmail: customer.email,
          subject: payload.subject,
          message: payload.message,
          status: "new" satisfies CustomerSuggestionStatus,
          createdAt: timestamp,
          updatedAt: timestamp,
          reviewedAt: null,
          reviewedBy: null,
          reviewedByEmail: null,
          archivedAt: null,
          archivedBy: null,
          archivedByEmail: null,
        });
        transaction.set(rateLimitRef, {
          ...nextRateLimit,
          updatedAt: timestamp,
        }, { merge: true });
      });

      return { success: true, suggestionId: suggestionRef.id };
    },

    adminMarkSuggestionReviewed: async (request: CallableRequest<unknown>) => {
      const admin = await requireAdmin(db, request);
      const suggestionId = parseSuggestionId(request.data);
      const suggestionRef = db.collection("customer_suggestions").doc(suggestionId);

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(suggestionRef);
        const suggestion = requireSuggestion(snap.exists ? snap.data() : undefined);
        if (suggestion.status === "reviewed") return;
        if (suggestion.status === "archived") {
          throw new HttpsError("failed-precondition", "Restaura la sugerencia antes de marcarla como revisada.");
        }
        const timestamp = serverTimestamp();
        transaction.update(suggestionRef, {
          status: "reviewed" satisfies CustomerSuggestionStatus,
          reviewedAt: timestamp,
          reviewedBy: admin.uid,
          reviewedByEmail: admin.email,
          updatedAt: timestamp,
        });
      });

      return { success: true, suggestionId };
    },

    adminArchiveSuggestion: async (request: CallableRequest<unknown>) => {
      const admin = await requireAdmin(db, request);
      const suggestionId = parseSuggestionId(request.data);
      const suggestionRef = db.collection("customer_suggestions").doc(suggestionId);

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(suggestionRef);
        const suggestion = requireSuggestion(snap.exists ? snap.data() : undefined);
        if (suggestion.status === "archived") return;
        const timestamp = serverTimestamp();
        transaction.update(suggestionRef, {
          status: "archived" satisfies CustomerSuggestionStatus,
          archivedAt: timestamp,
          archivedBy: admin.uid,
          archivedByEmail: admin.email,
          updatedAt: timestamp,
        });
      });

      return { success: true, suggestionId };
    },

    adminRestoreSuggestion: async (request: CallableRequest<unknown>) => {
      const admin = await requireAdmin(db, request);
      const suggestionId = parseSuggestionId(request.data);
      const suggestionRef = db.collection("customer_suggestions").doc(suggestionId);

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(suggestionRef);
        const suggestion = requireSuggestion(snap.exists ? snap.data() : undefined);
        if (suggestion.status === "reviewed") return;
        if (suggestion.status !== "archived") {
          throw new HttpsError("failed-precondition", "Solo se pueden restaurar sugerencias archivadas.");
        }

        const timestamp = serverTimestamp();
        const update: Record<string, unknown> = {
          status: "reviewed" satisfies CustomerSuggestionStatus,
          archivedAt: null,
          archivedBy: null,
          archivedByEmail: null,
          updatedAt: timestamp,
        };
        if (!suggestion.reviewedAt || !suggestion.reviewedBy || !suggestion.reviewedByEmail) {
          update.reviewedAt = timestamp;
          update.reviewedBy = admin.uid;
          update.reviewedByEmail = admin.email;
        }
        transaction.update(suggestionRef, update);
      });

      return { success: true, suggestionId };
    },
  };
}

export function buildCustomerSuggestionMakeEvent(
  suggestionId: string,
  data: FirebaseFirestore.DocumentData,
): CustomerSuggestionMakeEvent {
  if (!(data.createdAt instanceof Timestamp)) {
    throw new Error("Customer suggestion createdAt is not a persisted Timestamp.");
  }
  return {
    event: "customer_suggestion",
    suggestionId,
    userId: requireStoredString(data.userId, "userId"),
    userName: requireStoredString(data.userName, "userName"),
    userEmail: requireStoredString(data.userEmail, "userEmail"),
    subject: data.subject === null ? null : requireStoredString(data.subject, "subject"),
    message: requireStoredString(data.message, "message"),
    createdAt: data.createdAt.toDate().toISOString(),
  };
}

export async function notifyCustomerSuggestionCreatedSafely(
  suggestionId: string,
  data: FirebaseFirestore.DocumentData,
  sendWebhook: (event: CustomerSuggestionMakeEvent) => Promise<void>,
  logError: (message: string) => void = console.error,
): Promise<void> {
  try {
    await sendWebhook(buildCustomerSuggestionMakeEvent(suggestionId, data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Make webhook error.";
    logError(`[Make] Customer suggestion notification failed: ${message}`);
  }
}

function getNextRateLimit(
  data: RateLimitData | undefined,
  nowMillis: number,
  contentHash: string,
): Record<string, unknown> {
  const windowStartMillis = finiteNumber(data?.windowStartMillis);
  const count = finiteNumber(data?.count);
  const lastSubmittedAtMillis = finiteNumber(data?.lastSubmittedAtMillis);
  const lastContentHash = typeof data?.lastContentHash === "string" ? data.lastContentHash : "";
  const resetWindow = windowStartMillis === null || nowMillis - windowStartMillis >= RATE_LIMIT_WINDOW_MS;

  if (!resetWindow && lastContentHash === contentHash && lastSubmittedAtMillis !== null
    && nowMillis - lastSubmittedAtMillis < DUPLICATE_COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Esta sugerencia ya se ha enviado recientemente.");
  }
  if (!resetWindow && (count ?? 0) >= RATE_LIMIT_MAX_REQUESTS) {
    throw new HttpsError("resource-exhausted", "Has enviado demasiadas sugerencias. Intentalo de nuevo mas tarde.");
  }

  return {
    windowStartMillis: resetWindow ? nowMillis : windowStartMillis,
    count: resetWindow ? 1 : (count ?? 0) + 1,
    lastContentHash: contentHash,
    lastSubmittedAtMillis: nowMillis,
  };
}

async function requireCustomer(db: Firestore, request: CallableRequest<unknown>): Promise<CustomerIdentity> {
  const auth = requireAuth(request);
  const profile = await getUserProfile(db, auth.uid);
  const role = normalizeOptionalText(profile?.role);
  if (role && !CUSTOMER_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Tu cuenta no puede enviar sugerencias como cliente.");
  }

  const tokenEmail = normalizeEmail(auth.token.email);
  const email = normalizeEmail(profile?.email) || tokenEmail;
  if (!email) {
    throw new HttpsError("failed-precondition", "Tu cuenta debe tener un email valido.");
  }
  const profileName = normalizeOptionalText(profile?.name);
  const tokenName = normalizeOptionalText(auth.token.name);
  const name = validName(profileName) || validName(tokenName) || email.split("@", 1)[0] || "Cliente";
  return { uid: auth.uid, name, email };
}

async function requireAdmin(db: Firestore, request: CallableRequest<unknown>): Promise<AdminIdentity> {
  const auth = requireAuth(request);
  const profile = await getUserProfile(db, auth.uid);
  if (normalizeOptionalText(profile?.role) !== "admin") {
    throw new HttpsError("permission-denied", "Se requieren permisos de administrador.");
  }
  const email = normalizeEmail(profile?.email) || normalizeEmail(auth.token.email);
  if (!email) {
    throw new HttpsError("failed-precondition", "El administrador debe tener un email valido.");
  }
  return { uid: auth.uid, email };
}

function requireAuth(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }
  return request.auth;
}

async function getUserProfile(db: Firestore, uid: string): Promise<UserProfile | undefined> {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() as UserProfile : undefined;
}

function parseSuggestionId(data: unknown): string {
  const payload = requireRecord(data, "Los datos de la sugerencia no son validos.");
  if (typeof payload.suggestionId !== "string") {
    throw new HttpsError("invalid-argument", "La sugerencia no es valida.");
  }
  const suggestionId = payload.suggestionId.trim();
  if (!suggestionId || suggestionId.length > 200 || suggestionId.includes("/")) {
    throw new HttpsError("invalid-argument", "La sugerencia no es valida.");
  }
  return suggestionId;
}

function requireSuggestion(data: FirebaseFirestore.DocumentData | undefined): CustomerSuggestion {
  if (!data) {
    throw new HttpsError("not-found", "No se ha encontrado la sugerencia.");
  }
  if (data.status !== "new" && data.status !== "reviewed" && data.status !== "archived") {
    throw new HttpsError("failed-precondition", "La sugerencia tiene un estado no valido.");
  }
  return data as CustomerSuggestion;
}

function hashSuggestionContent(payload: CustomerSuggestionPayload): string {
  return createHash("sha256")
    .update(`${payload.subject ?? ""}\0${payload.message}`)
    .digest("hex");
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", message);
  }
  return value as Record<string, unknown>;
}

function normalizeRequiredText(value: unknown, fieldName: string, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} no es valido.`);
  }
  const text = value.trim();
  if (text.length < min) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado corto.`);
  }
  if (text.length > max) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado largo.`);
  }
  return text;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  const email = normalizeOptionalText(value).toLowerCase();
  return EMAIL_RE.test(email) ? email : "";
}

function validName(value: string): string {
  return value.length > 0 && value.length <= 120 ? value : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireStoredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Customer suggestion ${fieldName} is invalid.`);
  }
  return value;
}
