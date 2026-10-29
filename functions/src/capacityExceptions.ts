import type { Firestore } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { getMadridDateKey, madridCivilSlotToInstant } from "./appointmentLifecycle.js";
import {
  bookingPayloadHash,
  parseRequestId,
  readIdempotencyMarker,
  restrictionsFingerprint,
  writeIdempotencyMarker,
} from "./adminBookingOverrides.js";
import { MAX_MAX_CAPACITY, MIN_MAX_CAPACITY, normalizeMaxCapacity, normalizeSiteConfig, type SiteConfig } from "./siteConfig.js";
import { parseOccupancyCount } from "./slotOccupancy.js";
import type { SnapshotReader } from "./slotValidation.js";

/**
 * Per-date capacity ("aforo por fecha"). `capacity_exceptions/{YYYY-MM-DD}`
 * replaces `site_config/main.maxCapacity` for every slot of that Madrid civil
 * day. Every capacity decision reads the exception document of its date in
 * the same transaction as the occupancy counters, so a concurrent change of
 * the exception retries the booking instead of letting it pass on a stale value.
 */

export const CAPACITY_EXCEPTIONS_COLLECTION = "capacity_exceptions";
/** Dates per admin request: about two months of single days. */
export const MAX_CAPACITY_EXCEPTION_DATES = 62;
export const CAPACITY_REDUCTION_CONFIRMATION_REQUIRED = "capacity_reduction_confirmation_required";

export interface CapacityExceptionDoc {
  date: string;
  maxCapacity: number;
  updatedAt: string;
  updatedByUid: string;
  updatedByEmail: string;
}

/** Stored capacity of an exception, or undefined when the document is unusable (falls back to global). */
export function parseCapacityExceptionCapacity(data: unknown): number | undefined {
  const raw = (data as { maxCapacity?: unknown } | undefined)?.maxCapacity;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? normalizeMaxCapacity(parsed) : undefined;
}

/** Effective capacity of `date`: its exception when there is one, the global value otherwise. */
export function resolveMaxCapacity(
  config: Pick<SiteConfig, "maxCapacity">,
  exceptions: ReadonlyMap<string, number>,
  date: string,
): number {
  return exceptions.get(date) ?? config.maxCapacity;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** Exceptions of `dates`, read document by document (inside a transaction when `reader` is one). */
export async function loadCapacityExceptions(
  reader: SnapshotReader,
  db: Firestore,
  dates: Iterable<string>,
): Promise<Map<string, number>> {
  const unique = [...new Set(dates)].filter(isIsoDate).sort();
  const snaps = await Promise.all(unique.map((date) => reader.get(
    db.collection(CAPACITY_EXCEPTIONS_COLLECTION).doc(date),
  ) as Promise<{ exists: boolean; data(): unknown }>));
  const exceptions = new Map<string, number>();
  snaps.forEach((snap, index) => {
    if (!snap.exists) return;
    const capacity = parseCapacityExceptionCapacity(snap.data());
    if (capacity !== undefined) exceptions.set(unique[index], capacity);
  });
  return exceptions;
}

/** Effective capacity for each of `dates`. */
export async function loadDateCapacities(
  reader: SnapshotReader,
  db: Firestore,
  config: Pick<SiteConfig, "maxCapacity">,
  dates: Iterable<string>,
): Promise<Map<string, number>> {
  const list = [...new Set(dates)];
  const exceptions = await loadCapacityExceptions(reader, db, list);
  return new Map(list.map((date) => [date, resolveMaxCapacity(config, exceptions, date)]));
}

// ------------------------------------------------------- reduction warnings

/** An upcoming block whose approved seats exceed the capacity being set. Nothing is cancelled. */
export interface CapacityReductionRestriction {
  date: string;
  time: string;
  reason: "capacity_below_occupancy";
  occupancy: number;
  maxCapacity: number;
}

/**
 * Upcoming blocks of the target dates that already hold more approved seats
 * than their new capacity. `occupancyDocs` are `slot_occupancy` documents read
 * in the same transaction; corrupt counters are ignored here (they are reported
 * by the booking paths, never treated as seats).
 */
export function collectCapacityReductionRestrictions(input: {
  targets: ReadonlyMap<string, number>;
  occupancyDocs: Array<{ date?: unknown; time?: unknown; count?: unknown }>;
  now: Date;
}): CapacityReductionRestriction[] {
  const restrictions: CapacityReductionRestriction[] = [];
  for (const doc of input.occupancyDocs) {
    if (typeof doc.date !== "string" || typeof doc.time !== "string") continue;
    const maxCapacity = input.targets.get(doc.date);
    if (maxCapacity === undefined) continue;
    const count = parseOccupancyCount(doc.count);
    if (count === undefined || count <= maxCapacity) continue;
    const start = madridCivilSlotToInstant({ date: doc.date, time: doc.time });
    if (!start || start.getTime() <= input.now.getTime()) continue;
    restrictions.push({ date: doc.date, time: doc.time, reason: "capacity_below_occupancy", occupancy: count, maxCapacity });
  }
  return restrictions.sort((a, b) => `${a.date}_${a.time}`.localeCompare(`${b.date}_${b.time}`));
}

/**
 * Same contract as the booking overrides: without the fingerprint of the
 * current list, the caller gets the list to confirm (and `changed` when what
 * was confirmed no longer applies). Existing appointments are never touched.
 */
export function requireCapacityReductionAcknowledgement(
  restrictions: CapacityReductionRestriction[],
  acknowledged: string | undefined,
): void {
  if (restrictions.length === 0) return;
  const fingerprint = restrictionsFingerprint(restrictions);
  if (acknowledged === fingerprint) return;
  const changed = Boolean(acknowledged);
  throw new HttpsError(
    "failed-precondition",
    changed
      ? "La ocupación ha cambiado. Revisa las franjas afectadas y vuelve a confirmar."
      : "Hay franjas con más citas aprobadas que el nuevo aforo. Las citas existentes se mantienen; confirma para guardar igualmente.",
    { reason: CAPACITY_REDUCTION_CONFIRMATION_REQUIRED, restrictions, fingerprint, changed },
  );
}

// ------------------------------------------------------------ admin handlers

export interface CapacityAdminDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

function parseAcknowledged(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "La confirmación no es válida.");
  }
  return value;
}

function parseCapacityValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_MAX_CAPACITY || value > MAX_MAX_CAPACITY) {
    throw new HttpsError(
      "invalid-argument",
      `El aforo debe ser un número entero entre ${MIN_MAX_CAPACITY} y ${MAX_MAX_CAPACITY}.`,
      { reason: "invalid_capacity" },
    );
  }
  return value;
}

/** Unique, sorted, valid dates from today (Madrid) onwards. */
export function parseCapacityExceptionDates(value: unknown, now: Date): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError("invalid-argument", "Selecciona al menos una fecha.", { reason: "invalid_dates" });
  }
  if (value.some((date) => typeof date !== "string" || !isIsoDate(date))) {
    throw new HttpsError("invalid-argument", "Alguna fecha no es válida.", { reason: "invalid_dates" });
  }
  const dates = [...new Set(value as string[])].sort();
  if (dates.length > MAX_CAPACITY_EXCEPTION_DATES) {
    throw new HttpsError(
      "invalid-argument",
      `Puedes modificar como máximo ${MAX_CAPACITY_EXCEPTION_DATES} fechas a la vez.`,
      { reason: "too_many_dates" },
    );
  }
  const today = getMadridDateKey(now);
  if (dates.some((date) => date < today)) {
    throw new HttpsError("invalid-argument", "No se puede cambiar el aforo de fechas pasadas.", { reason: "past_date" });
  }
  return dates;
}

export function createCapacityAdminHandlers(deps: CapacityAdminDeps) {
  const { db, requireAdmin, getNowDate } = deps;
  const configRef = db.collection("site_config").doc("main");

  async function authenticate(request: CallableRequest): Promise<{ adminUid: string; adminEmail: string }> {
    if (!request.auth) throw new HttpsError("permission-denied", "Debes iniciar sesion como admin.");
    await requireAdmin(request.auth.uid);
    return { adminUid: request.auth.uid, adminEmail: request.auth.token.email ?? "" };
  }

  async function readDayOccupancy(transaction: SnapshotReader, dates: string[]) {
    const snaps = await Promise.all(dates.map((date) => transaction.get(
      db.collection("slot_occupancy").where("date", "==", date),
    ) as Promise<{ docs: Array<{ data(): unknown }> }>));
    return snaps.flatMap((snap) => snap.docs.map((doc) => doc.data() as { date?: unknown; time?: unknown; count?: unknown }));
  }

  async function upsertCapacityExceptionsFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const { adminUid, adminEmail } = await authenticate(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const nowDate = getNowDate();
    const dates = parseCapacityExceptionDates(data.dates, nowDate);
    const maxCapacity = parseCapacityValue(data.maxCapacity);
    const acknowledged = parseAcknowledged(data.acknowledgedRestrictions);
    const requestId = parseRequestId(data.requestId);
    const payloadHash = bookingPayloadHash({ kind: "capacity_exceptions", dates, maxCapacity });

    return db.runTransaction(async (transaction) => {
      const marker = await readIdempotencyMarker(transaction, db, { requestId, adminUid, kind: "capacity_exceptions", payloadHash });
      if (marker.previous) return { ...marker.previous, replayed: true };

      const [configSnap, previous, occupancyDocs] = await Promise.all([
        transaction.get(configRef),
        loadCapacityExceptions(transaction, db, dates),
        readDayOccupancy(transaction, dates),
      ]);
      const config = normalizeSiteConfig(configSnap.exists ? configSnap.data() as Partial<SiteConfig> : {});
      if (!config.capacityExceptionsEnabled) {
        throw new HttpsError(
          "failed-precondition",
          "El aforo por fecha todavía no está activado.",
          { reason: "capacity_exceptions_disabled" },
        );
      }
      // Only dates whose capacity actually goes down can need a confirmation.
      const reduced = new Map(dates
        .filter((date) => maxCapacity < resolveMaxCapacity(config, previous, date))
        .map((date) => [date, maxCapacity]));
      const restrictions = collectCapacityReductionRestrictions({ targets: reduced, occupancyDocs, now: nowDate });
      requireCapacityReductionAcknowledgement(restrictions, acknowledged);

      const now = nowDate.toISOString();
      for (const date of dates) {
        const doc: CapacityExceptionDoc = { date, maxCapacity, updatedAt: now, updatedByUid: adminUid, updatedByEmail: adminEmail };
        transaction.set(db.collection(CAPACITY_EXCEPTIONS_COLLECTION).doc(date), doc);
      }
      transaction.create(db.collection("activity_logs").doc(), {
        action: "capacity_exception_upserted",
        adminUid,
        adminEmail,
        dates,
        maxCapacity,
        previous: Object.fromEntries(dates.map((date) => [date, previous.get(date) ?? null])),
        restrictions,
        createdAt: now,
        timestamp: now,
      });
      const response = { success: true, dates, maxCapacity, acknowledgedRestrictions: restrictions };
      writeIdempotencyMarker(transaction, marker, { adminUid, kind: "capacity_exceptions", payloadHash, result: response, now });
      return response;
    });
  }

  async function deleteCapacityExceptionsFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const { adminUid, adminEmail } = await authenticate(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const nowDate = getNowDate();
    const dates = parseCapacityExceptionDates(data.dates, nowDate);
    const acknowledged = parseAcknowledged(data.acknowledgedRestrictions);
    const requestId = parseRequestId(data.requestId);
    const payloadHash = bookingPayloadHash({ kind: "capacity_exceptions_delete", dates });

    return db.runTransaction(async (transaction) => {
      const marker = await readIdempotencyMarker(transaction, db, { requestId, adminUid, kind: "capacity_exceptions_delete", payloadHash });
      if (marker.previous) return { ...marker.previous, replayed: true };

      const [configSnap, previous, occupancyDocs] = await Promise.all([
        transaction.get(configRef),
        loadCapacityExceptions(transaction, db, dates),
        readDayOccupancy(transaction, dates),
      ]);
      const config = normalizeSiteConfig(configSnap.exists ? configSnap.data() as Partial<SiteConfig> : {});
      const existing = dates.filter((date) => previous.has(date));
      // Removing an exception falls back to the global capacity: confirm when that is lower.
      const reduced = new Map(existing
        .filter((date) => config.maxCapacity < (previous.get(date) ?? config.maxCapacity))
        .map((date) => [date, config.maxCapacity]));
      const restrictions = collectCapacityReductionRestrictions({ targets: reduced, occupancyDocs, now: nowDate });
      requireCapacityReductionAcknowledgement(restrictions, acknowledged);

      const now = nowDate.toISOString();
      existing.forEach((date) => transaction.delete(db.collection(CAPACITY_EXCEPTIONS_COLLECTION).doc(date)));
      if (existing.length > 0) {
        transaction.create(db.collection("activity_logs").doc(), {
          action: "capacity_exception_deleted",
          adminUid,
          adminEmail,
          dates: existing,
          previous: Object.fromEntries(existing.map((date) => [date, previous.get(date) ?? null])),
          maxCapacity: config.maxCapacity,
          restrictions,
          createdAt: now,
          timestamp: now,
        });
      }
      const response = { success: true, dates: existing, acknowledgedRestrictions: restrictions };
      writeIdempotencyMarker(transaction, marker, { adminUid, kind: "capacity_exceptions_delete", payloadHash, result: response, now });
      return response;
    });
  }

  async function updateMaxCapacityFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const { adminUid, adminEmail } = await authenticate(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const maxCapacity = parseCapacityValue(data.maxCapacity);
    const acknowledged = parseAcknowledged(data.acknowledgedRestrictions);
    const requestId = parseRequestId(data.requestId);
    const payloadHash = bookingPayloadHash({ kind: "max_capacity", maxCapacity });
    const nowDate = getNowDate();
    const today = getMadridDateKey(nowDate);

    return db.runTransaction(async (transaction) => {
      const marker = await readIdempotencyMarker(transaction, db, { requestId, adminUid, kind: "max_capacity", payloadHash });
      if (marker.previous) return { ...marker.previous, replayed: true };

      const [configSnap, occupancySnap, exceptionsSnap] = await Promise.all([
        transaction.get(configRef),
        transaction.get(db.collection("slot_occupancy").where("date", ">=", today)),
        transaction.get(db.collection(CAPACITY_EXCEPTIONS_COLLECTION).where("date", ">=", today)),
      ]);
      const config = normalizeSiteConfig(configSnap.exists ? configSnap.data() as Partial<SiteConfig> : {});
      const previous = config.maxCapacity;
      const now = nowDate.toISOString();
      if (configSnap.exists && previous === maxCapacity && configSnap.data()?.maxCapacity === maxCapacity) {
        const response = { success: true, maxCapacity, previousMaxCapacity: previous, changed: false, acknowledgedRestrictions: [] };
        writeIdempotencyMarker(transaction, marker, { adminUid, kind: "max_capacity", payloadHash, result: response, now });
        return response;
      }

      let restrictions: CapacityReductionRestriction[] = [];
      if (maxCapacity < previous) {
        // Dates with their own exception keep it: only days that follow the global value change.
        const withException = new Set(exceptionsSnap.docs
          .filter((doc) => parseCapacityExceptionCapacity(doc.data()) !== undefined)
          .map((doc) => doc.id));
        const occupancyDocs = occupancySnap.docs
          .map((doc) => doc.data() as { date?: unknown; time?: unknown; count?: unknown })
          .filter((doc) => typeof doc.date === "string" && !withException.has(doc.date));
        const targets = new Map(occupancyDocs.map((doc) => [doc.date as string, maxCapacity]));
        restrictions = collectCapacityReductionRestrictions({ targets, occupancyDocs, now: nowDate });
      }
      requireCapacityReductionAcknowledgement(restrictions, acknowledged);

      transaction.set(configRef, { maxCapacity, updatedAt: now }, { merge: true });
      transaction.create(db.collection("activity_logs").doc(), {
        action: "max_capacity_updated",
        adminUid,
        adminEmail,
        previousMaxCapacity: previous,
        maxCapacity,
        restrictions,
        createdAt: now,
        timestamp: now,
      });
      const response = { success: true, maxCapacity, previousMaxCapacity: previous, changed: true, acknowledgedRestrictions: restrictions };
      writeIdempotencyMarker(transaction, marker, { adminUid, kind: "max_capacity", payloadHash, result: response, now });
      return response;
    });
  }

  return { upsertCapacityExceptionsFromAdmin, deleteCapacityExceptionsFromAdmin, updateMaxCapacityFromAdmin };
}
