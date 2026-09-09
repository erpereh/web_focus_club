import { randomBytes } from "node:crypto";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export type AdminUserRole = "admin" | "trainer" | "user";
export type AdminUserAccessMethod = "password" | "email-reset";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserFromAdminCommonInput {
  name: string;
  email: string;
  phone: string;
  role: AdminUserRole;
  isTrainer: boolean;
  accessMethod: AdminUserAccessMethod;
}

export interface CreateUserFromAdminResult {
  success: true;
  uid: string;
  email: string;
  repairedExistingAuth: boolean;
}

export interface CreateUserFromAdminCoreParams {
  db: Firestore;
  auth: Auth;
  input: CreateUserFromAdminCommonInput;
  rawData: unknown;
  adminUid: string;
  adminEmail: string;
  now?: Date;
  generateTemporaryPassword?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function normalizeTextField(value: unknown, fieldName: string, maxLength: number, required = true): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new HttpsError("invalid-argument", `El campo ${fieldName} no es valido.`);
  }

  const text = value.trim();
  if (required && !text) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es obligatorio.`);
  }
  if (text.length > maxLength) {
    throw new HttpsError("invalid-argument", `El campo ${fieldName} es demasiado largo.`);
  }

  return text;
}

function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

function parseAdminUserRole(value: unknown): AdminUserRole {
  if (value === "admin" || value === "trainer" || value === "user") {
    return value;
  }
  throw new HttpsError("invalid-argument", "El rol seleccionado no es valido.");
}

function getIsTrainerForRole(role: AdminUserRole): boolean {
  return role === "trainer";
}

export function parseCreateUserFromAdminCommonData(data: unknown): CreateUserFromAdminCommonInput {
  if (!isRecord(data)) {
    throw new HttpsError("invalid-argument", "Los datos del cliente no son validos.");
  }

  const name = normalizeTextField(data.name, "nombre", 120);
  const email = normalizeTextField(data.email, "email", 254).toLowerCase();
  const phone = normalizeTextField(data.phone, "telefono", 40, false);
  const role = parseAdminUserRole(data.role);
  const accessMethod = data.accessMethod;

  if (!isValidEmail(email)) {
    throw new HttpsError("invalid-argument", "El email no tiene un formato valido.");
  }
  if (accessMethod !== "password" && accessMethod !== "email-reset") {
    throw new HttpsError("invalid-argument", "El metodo de acceso no es valido.");
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

function parseCreateUserPassword(data: unknown): string {
  if (!isRecord(data)) {
    throw new HttpsError("invalid-argument", "Los datos del cliente no son validos.");
  }

  const password = normalizeTextField(data.password, "contrasena temporal", 128);
  if (password.length < 8) {
    throw new HttpsError("invalid-argument", "La contrasena temporal debe tener al menos 8 caracteres.");
  }
  return password;
}

export function generateTemporaryPassword(): string {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

export function toIsoFromAuthCreationTime(creationTime: string | undefined, now: Date): string {
  if (!creationTime) return now.toISOString();
  const parsed = new Date(creationTime);
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  return parsed.toISOString();
}

export async function getTrainerDocsByUid(db: Firestore, uid: string) {
  return db.collection("trainers").where("uid", "==", uid).get();
}

export async function syncTrainerProfile(
  db: Firestore,
  uid: string,
  name: string,
  role: AdminUserRole,
  now = new Date(),
): Promise<void> {
  const trainerSnap = await getTrainerDocsByUid(db, uid);

  if (role === "trainer") {
    if (trainerSnap.empty) {
      await db.collection("trainers").add({
        uid,
        name,
        active: true,
        createdAt: now.toISOString(),
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

async function addAdminUserActivityLog(
  db: Firestore,
  data: Record<string, unknown>,
  now: Date,
): Promise<void> {
  try {
    await db.collection("activity_logs").add({
      ...data,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[AdminUsers] Failed to write activity log", error);
  }
}

async function getExistingAuthUser(auth: Auth, email: string): Promise<UserRecord | null> {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (getErrorCode(error) !== "auth/user-not-found") {
      throw error;
    }
    return null;
  }
}

export async function createUserFromAdminCore(
  params: CreateUserFromAdminCoreParams,
): Promise<CreateUserFromAdminResult> {
  const {
    db,
    auth,
    input,
    rawData,
    adminUid,
    adminEmail,
  } = params;
  const now = params.now ?? new Date();
  const generatePassword = params.generateTemporaryPassword ?? generateTemporaryPassword;
  const existingAuthUser = await getExistingAuthUser(auth, input.email);

  if (existingAuthUser) {
    const profileRef = db.collection("users").doc(existingAuthUser.uid);
    const profileSnap = await profileRef.get();

    if (profileSnap.exists) {
      throw new HttpsError("already-exists", "Ya existe un usuario con este email.");
    }

    const email = existingAuthUser.email || input.email;
    const createdAt = toIsoFromAuthCreationTime(existingAuthUser.metadata?.creationTime, now);
    const nowIso = now.toISOString();

    await syncTrainerProfile(db, existingAuthUser.uid, input.name, input.role, now);
    await profileRef.set({
      uid: existingAuthUser.uid,
      name: input.name,
      email,
      phone: input.phone,
      role: input.role,
      isTrainer: input.isTrainer,
      createdAt,
      updatedAt: nowIso,
      pushNotificationsEnabled: false,
    });
    await addAdminUserActivityLog(db, {
      action: "user_profile_repaired_from_auth",
      adminUid,
      adminEmail,
      targetUid: existingAuthUser.uid,
      email,
      role: input.role,
      createdAt: nowIso,
    }, now);

    return {
      success: true,
      uid: existingAuthUser.uid,
      email,
      repairedExistingAuth: true,
    };
  }

  const password = input.accessMethod === "password"
    ? parseCreateUserPassword(rawData)
    : generatePassword();
  const createdUser = await auth.createUser({
    email: input.email,
    displayName: input.name,
    password,
    emailVerified: false,
  });

  const nowIso = now.toISOString();
  try {
    await db.collection("users").doc(createdUser.uid).set({
      uid: createdUser.uid,
      name: input.name,
      email: input.email,
      phone: input.phone,
      role: input.role,
      isTrainer: input.isTrainer,
      createdAt: nowIso,
      pushNotificationsEnabled: false,
    });

    await syncTrainerProfile(db, createdUser.uid, input.name, input.role, now);
  } catch (error) {
    await auth.deleteUser(createdUser.uid).catch((deleteError) => {
      console.error("[AdminUsers] Failed to delete auth user after Firestore error", deleteError);
    });
    throw error;
  }

  await addAdminUserActivityLog(db, {
    action: "user_created_by_admin",
    adminUid,
    adminEmail,
    targetUid: createdUser.uid,
    email: input.email,
    role: input.role,
  }, now);

  return {
    success: true,
    uid: createdUser.uid,
    email: input.email,
    repairedExistingAuth: false,
  };
}
