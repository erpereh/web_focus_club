import { Firestore, Timestamp } from "firebase-admin/firestore";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

export type SupportConversationStatus = "open" | "closed";
export type SupportSenderRole = "customer" | "admin";

export interface SupportConversation {
  userId: string;
  userName: string;
  userEmail: string;
  status: SupportConversationStatus;
  subject: string;
  lastMessage: string;
  lastMessageAt: Timestamp;
  lastMessageBy: SupportSenderRole;
  unreadAdminCount: number;
  unreadCustomerCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  adminHidden?: boolean;
  adminHiddenAt?: Timestamp;
  adminHiddenBy?: string;
}

export interface SupportMessage {
  senderId: string;
  senderRole: SupportSenderRole;
  text: string;
  createdAt: Timestamp;
}

interface SupportUserProfile {
  name?: unknown;
  email?: unknown;
  role?: unknown;
}

interface SupportCustomerIdentity {
  uid: string;
  email: string;
  name: string;
}

interface AuthenticatedSupportUser {
  uid: string;
  tokenEmail: string;
  tokenName: string;
}

interface SupportCustomerIdentityInput {
  uid: string;
  tokenEmail: string;
  tokenName: string;
  profile?: SupportUserProfile;
}

interface SupportConversationPayload {
  subject: string;
  initialMessage: string;
}

interface SupportMessagePayload {
  conversationId: string;
  text: string;
}

interface SupportConversationIdPayload {
  conversationId: string;
}

export interface SupportChatNotificationInput {
  userId: string;
  conversationId: string;
}

export interface SupportChatHandlerOptions {
  notifySupportCustomer?: (input: SupportChatNotificationInput) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_ROLES = new Set(["user", "customer"]);

export function normalizeSupportSubject(value: unknown): string {
  return normalizeRequiredText(value, "asunto", 3, 120);
}

export function normalizeSupportMessageText(value: unknown): string {
  return normalizeRequiredText(value, "mensaje", 1, 3000);
}

export function getSupportCustomerIdentity(input: SupportCustomerIdentityInput): SupportCustomerIdentity {
  const tokenEmail = normalizeEmail(input.tokenEmail);
  if (!tokenEmail) {
    throw new HttpsError("failed-precondition", "Tu cuenta debe tener un email valido para contactar con soporte.");
  }

  const role = normalizeOptionalText(input.profile?.role);
  if (role && !CUSTOMER_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Tu cuenta no puede iniciar conversaciones de soporte como cliente.");
  }

  const profileEmail = normalizeEmail(input.profile?.email);
  const name = getCustomerName(input.profile?.name, input.tokenName, profileEmail || tokenEmail);

  return {
    uid: input.uid,
    email: profileEmail || tokenEmail,
    name,
  };
}

export function createSupportChatHandlers(
  db: Firestore,
  { notifySupportCustomer = async () => {} }: SupportChatHandlerOptions = {},
) {
  return {
    createSupportConversation: async (request: CallableRequest<unknown>) => {
      const customer = await requireSupportCustomer(db, request);
      const payload = parseCreateSupportConversationPayload(request.data);
      const now = Timestamp.now();
      const conversationRef = db.collection("support_conversations").doc();
      const messageRef = conversationRef.collection("messages").doc();

      const conversation: SupportConversation = {
        userId: customer.uid,
        userName: customer.name,
        userEmail: customer.email,
        status: "open",
        subject: payload.subject,
        lastMessage: payload.initialMessage,
        lastMessageAt: now,
        lastMessageBy: "customer",
        unreadAdminCount: 1,
        unreadCustomerCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      const message: SupportMessage = {
        senderId: customer.uid,
        senderRole: "customer",
        text: payload.initialMessage,
        createdAt: now,
      };

      await db.runTransaction(async (transaction) => {
        transaction.create(conversationRef, conversation);
        transaction.create(messageRef, message);
      });

      return { conversationId: conversationRef.id };
    },

    sendSupportMessage: async (request: CallableRequest<unknown>) => {
      const customer = await requireSupportCustomer(db, request);
      const payload = parseSupportMessagePayload(request.data);
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, payload.conversationId);
      const messageRef = conversationRef.collection("messages").doc();

      await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        const conversation = requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        assertConversationOwner(conversation, customer.uid);
        assertSupportConversationOpen(conversation);

        transaction.create(messageRef, {
          senderId: customer.uid,
          senderRole: "customer",
          text: payload.text,
          createdAt: now,
        } satisfies SupportMessage);
        transaction.update(conversationRef, {
          lastMessage: payload.text,
          lastMessageAt: now,
          lastMessageBy: "customer" satisfies SupportSenderRole,
          unreadAdminCount: getUnreadCount(conversation.unreadAdminCount) + 1,
          updatedAt: now,
        });
      });

      return { success: true, conversationId: conversationRef.id };
    },

    markSupportConversationRead: async (request: CallableRequest<unknown>) => {
      const actor = await getSupportActor(db, request);
      const conversationId = parseSupportConversationIdPayload(request.data).conversationId;
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, conversationId);

      await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        const conversation = requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        if (actor.role === "customer") {
          assertConversationOwner(conversation, actor.customer.uid);
          transaction.update(conversationRef, {
            unreadCustomerCount: 0,
            updatedAt: now,
          });
          return;
        }

        transaction.update(conversationRef, {
          unreadAdminCount: 0,
          updatedAt: now,
        });
      });

      return { success: true, conversationId };
    },

    adminSendSupportMessage: async (request: CallableRequest<unknown>) => {
      const admin = await requireSupportAdmin(db, request);
      const payload = parseSupportMessagePayload(request.data);
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, payload.conversationId);
      const messageRef = conversationRef.collection("messages").doc();

      const notification = await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        const conversation = requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        assertSupportConversationOpen(conversation);

        transaction.create(messageRef, {
          senderId: admin.uid,
          senderRole: "admin",
          text: payload.text,
          createdAt: now,
        } satisfies SupportMessage);
        transaction.update(conversationRef, {
          lastMessage: payload.text,
          lastMessageAt: now,
          lastMessageBy: "admin" satisfies SupportSenderRole,
          unreadCustomerCount: getUnreadCount(conversation.unreadCustomerCount) + 1,
          updatedAt: now,
        });
        return {
          userId: conversation.userId,
          conversationId: conversationRef.id,
        } satisfies SupportChatNotificationInput;
      });

      try {
        await notifySupportCustomer(notification);
      } catch (_) {
        console.error("Support message push notification failed.");
      }

      return { success: true, conversationId: conversationRef.id };
    },

    closeSupportConversation: async (request: CallableRequest<unknown>) => {
      await requireSupportAdmin(db, request);
      const conversationId = parseSupportConversationIdPayload(request.data).conversationId;
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, conversationId);

      await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        transaction.update(conversationRef, { status: "closed" satisfies SupportConversationStatus, updatedAt: now });
      });

      return { success: true, conversationId };
    },

    reopenSupportConversation: async (request: CallableRequest<unknown>) => {
      await requireSupportAdmin(db, request);
      const conversationId = parseSupportConversationIdPayload(request.data).conversationId;
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, conversationId);

      await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        transaction.update(conversationRef, { status: "open" satisfies SupportConversationStatus, updatedAt: now });
      });

      return { success: true, conversationId };
    },

    adminHideSupportConversation: async (request: CallableRequest<unknown>) => {
      const admin = await requireSupportAdmin(db, request);
      const conversationId = parseSupportConversationIdPayload(request.data).conversationId;
      const now = Timestamp.now();
      const conversationRef = getConversationRef(db, conversationId);

      await db.runTransaction(async (transaction) => {
        const conversationSnap = await transaction.get(conversationRef);
        requireSupportConversation(conversationSnap.exists ? conversationSnap.data() : undefined);
        transaction.update(conversationRef, {
          adminHidden: true,
          adminHiddenAt: now,
          adminHiddenBy: admin.uid,
          updatedAt: now,
        });
      });

      return { success: true, conversationId };
    },
  };
}

function parseCreateSupportConversationPayload(data: unknown): SupportConversationPayload {
  const payload = requireRecord(data);
  return {
    subject: normalizeSupportSubject(payload.subject),
    initialMessage: normalizeSupportMessageText(payload.initialMessage),
  };
}

function parseSupportMessagePayload(data: unknown): SupportMessagePayload {
  const payload = requireRecord(data);
  return {
    conversationId: normalizeConversationId(payload.conversationId),
    text: normalizeSupportMessageText(payload.text),
  };
}

function parseSupportConversationIdPayload(data: unknown): SupportConversationIdPayload {
  const payload = requireRecord(data);
  return { conversationId: normalizeConversationId(payload.conversationId) };
}

async function getSupportActor(db: Firestore, request: CallableRequest<unknown>): Promise<
  | { role: "admin"; uid: string }
  | { role: "customer"; customer: SupportCustomerIdentity }
> {
  const authUser = requireAuthenticatedSupportUser(request);
  const profile = await getCustomerProfileForSupport(db, authUser.uid);
  const role = normalizeOptionalText(profile?.role);

  if (role === "admin") {
    return { role: "admin", uid: authUser.uid };
  }

  return {
    role: "customer",
    customer: getSupportCustomerIdentity({ ...authUser, profile }),
  };
}

async function requireSupportCustomer(db: Firestore, request: CallableRequest<unknown>): Promise<SupportCustomerIdentity> {
  const actor = await getSupportActor(db, request);
  if (actor.role === "admin") {
    throw new HttpsError("permission-denied", "Un administrador no puede iniciar conversaciones como cliente.");
  }
  return actor.customer;
}

async function requireSupportAdmin(db: Firestore, request: CallableRequest<unknown>): Promise<{ uid: string }> {
  const uid = requireAuthenticatedUid(request);
  const profile = await getCustomerProfileForSupport(db, uid);
  if (normalizeOptionalText(profile?.role) !== "admin") {
    throw new HttpsError("permission-denied", "Se requieren permisos de administrador.");
  }
  return { uid };
}

function requireAuthenticatedSupportUser(request: CallableRequest<unknown>): AuthenticatedSupportUser {
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion para usar el soporte.");
  }

  const tokenEmail = normalizeEmail(auth.token.email);
  if (!tokenEmail) {
    throw new HttpsError("failed-precondition", "Tu cuenta debe tener un email valido para contactar con soporte.");
  }

  return {
    uid: auth.uid,
    tokenEmail,
    tokenName: normalizeOptionalText(auth.token.name),
  };
}

function requireAuthenticatedUid(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion para usar el soporte.");
  }
  return request.auth.uid;
}

async function getCustomerProfileForSupport(db: Firestore, uid: string): Promise<SupportUserProfile | undefined> {
  const profileSnap = await db.collection("users").doc(uid).get();
  return profileSnap.exists ? profileSnap.data() as SupportUserProfile : undefined;
}

function getConversationRef(db: Firestore, conversationId: string) {
  return db.collection("support_conversations").doc(conversationId);
}

function requireSupportConversation(data: FirebaseFirestore.DocumentData | undefined): SupportConversation {
  if (!data) {
    throw new HttpsError("not-found", "No se ha encontrado la conversacion.");
  }
  if (typeof data.userId !== "string" || !data.userId) {
    throw new HttpsError("failed-precondition", "La conversacion no es valida.");
  }
  return data as SupportConversation;
}

function assertConversationOwner(conversation: SupportConversation, uid: string): void {
  if (conversation.userId !== uid) {
    throw new HttpsError("permission-denied", "No tienes acceso a esta conversacion.");
  }
}

export function assertSupportConversationOpen(
  conversation: Pick<SupportConversation, "status">,
): void {
  if (conversation.status === "closed") {
    throw new HttpsError(
      "failed-precondition",
      "Esta conversacion esta cerrada. Un administrador debe reabrirla antes de enviar mensajes.",
    );
  }
}

function normalizeRequiredText(value: unknown, fieldName: string, minLength: number, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} no es valido.`);
  }
  const text = value.trim();
  if (text.length < minLength) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado corto.`);
  }
  if (text.length > maxLength) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado largo.`);
  }
  return text;
}

function normalizeConversationId(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "La conversacion no es valida.");
  }
  const conversationId = value.trim();
  if (!conversationId || conversationId.length > 200 || conversationId.includes("/")) {
    throw new HttpsError("invalid-argument", "La conversacion no es valida.");
  }
  return conversationId;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  const email = normalizeOptionalText(value).toLowerCase();
  return EMAIL_RE.test(email) ? email : "";
}

function getCustomerName(profileName: unknown, tokenName: unknown, email: string): string {
  const profileValue = normalizeOptionalText(profileName);
  if (profileValue && profileValue.length <= 120) return profileValue;

  const tokenValue = normalizeOptionalText(tokenName);
  if (tokenValue && tokenValue.length <= 120) return tokenValue;

  return email.split("@", 1)[0] || "Cliente";
}

function getUnreadCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new HttpsError("invalid-argument", "Los datos de soporte no son validos.");
  }
  return value as Record<string, unknown>;
}
