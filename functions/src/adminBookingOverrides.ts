import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getCanonicalSlotBlocks,
  isInsideBookingNotice,
  isSameDayBookingBlocked,
  madridCivilSlotToInstant,
} from "./appointmentLifecycle.js";
import { doesSessionFitWithinSchedule, generateTimeSlots } from "./siteConfig.js";
import type { SlotDayContext, SlotTimeSlot } from "./slotValidation.js";

/**
 * Availability rules an admin may knowingly skip when creating appointments.
 * Customer duplicates, professional conflicts, corrupt counters and bono
 * problems are never in this list: they stay hard errors.
 */
export type AdminOverridableReason =
  | "slot_not_future"
  | "same_day_booking_disabled"
  | "booking_notice_too_short"
  | "outside_schedule"
  | "slot_blocked"
  | "slot_full";

export interface AdminRestriction {
  date: string;
  time: string;
  reason: AdminOverridableReason;
  /** Only for `slot_full`: peak count over the session blocks before booking. */
  occupancy?: number;
  maxCapacity?: number;
}

export const ADMIN_RESTRICTION_LABELS: Record<AdminOverridableReason, string> = {
  slot_not_future: "fecha pasada",
  same_day_booking_disabled: "reservas para el mismo día desactivadas",
  booking_notice_too_short: "antelación insuficiente",
  outside_schedule: "fuera de horario",
  slot_blocked: "franja bloqueada",
  slot_full: "aforo completo",
};

export const ADMIN_OVERRIDE_REQUIRED = "admin_override_required";
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const ADMIN_BOOKING_REQUESTS = "admin_booking_requests";

/** Admin-chosen start time: quarter-hour aligned and ending by midnight. */
export function isValidAdminSlotTime(time: string, durationMinutes: number): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return false;
  const start = Number(match[1]) * 60 + Number(match[2]);
  return start % 15 === 0 && start + durationMinutes <= 24 * 60;
}

/**
 * Every overridable restriction that applies to one session. Same data and
 * rules as `evaluateSlot`, but it reports all of them instead of the first.
 * `invalid_occupancy` is returned as `hard` because a corrupt counter must
 * never be read (or overridden) as capacity.
 */
export function collectAdminSlotRestrictions(
  day: SlotDayContext,
  input: { slot: SlotTimeSlot; durationMinutes: number; now: Date },
): { restrictions: AdminRestriction[]; hard?: "invalid_occupancy" } {
  const { slot, durationMinutes, now } = input;
  const { config } = day;
  const restrictions: AdminRestriction[] = [];
  const add = (reason: AdminOverridableReason, extra: Partial<AdminRestriction> = {}) => {
    restrictions.push({ date: slot.date, time: slot.time, reason, ...extra });
  };

  const start = madridCivilSlotToInstant(slot);
  if (!start || start.getTime() <= now.getTime()) {
    add("slot_not_future");
  } else {
    if (isSameDayBookingBlocked(slot, now, config.blockSameDayBooking)) add("same_day_booking_disabled");
    if (isInsideBookingNotice(slot, now, config.minBookingNoticeHours)) add("booking_notice_too_short");
  }

  if (!new Set(generateTimeSlots(config)).has(slot.time)
    || !doesSessionFitWithinSchedule(config, slot.time, durationMinutes)) {
    add("outside_schedule");
  }

  const blocks = getCanonicalSlotBlocks(slot.time, durationMinutes);
  if (blocks.some((time) => day.blockedTimes.has(time))) add("slot_blocked");
  if (blocks.some((time) => day.invalidOccupancyTimes?.has(time))) return { restrictions, hard: "invalid_occupancy" };

  const occupancy = Math.max(0, ...blocks.map((time) => day.occupancyByTime.get(time) ?? 0));
  if (occupancy >= config.maxCapacity) add("slot_full", { occupancy, maxCapacity: config.maxCapacity });
  return { restrictions };
}

/** Stable identity of a restriction list: changes whenever the conditions change. */
export function restrictionsFingerprint(restrictions: AdminRestriction[]): string {
  return restrictions
    .map((item) => [item.date, item.time, item.reason, item.occupancy ?? "", item.maxCapacity ?? ""].join("|"))
    .sort()
    .join(";");
}

export interface AdminOverrideRequest {
  acknowledgedRestrictions?: string;
  confirmPastDate: boolean;
}

export function parseAdminOverrideRequest(data: Record<string, unknown>): AdminOverrideRequest {
  const acknowledged = data.acknowledgedRestrictions;
  if (acknowledged !== undefined && acknowledged !== null && typeof acknowledged !== "string") {
    throw new HttpsError("invalid-argument", "La confirmación de excepciones no es válida.");
  }
  return {
    acknowledgedRestrictions: typeof acknowledged === "string" && acknowledged ? acknowledged : undefined,
    confirmPastDate: data.confirmPastDate === true,
  };
}

export interface AdminOverrideAudit {
  authorizedByUid: string;
  authorizedByEmail: string;
  authorizedAt: string;
  restrictions: AdminRestriction[];
  pastDateConfirmed: boolean;
}

function describe(restrictions: AdminRestriction[]): string {
  return [...new Set(restrictions.map((item) => ADMIN_RESTRICTION_LABELS[item.reason]))].join(", ");
}

/** What the admin is doing when a restriction is skipped: only changes the wording. */
export type AdminOverrideOperation = "create" | "reschedule" | "approve";

const OVERRIDE_CONFIRM_ACTION: Record<AdminOverrideOperation, string> = {
  create: "crear la cita",
  reschedule: "guardar el cambio",
  approve: "aprobar",
};

/**
 * Never skips a restriction silently: without a matching acknowledgement the
 * caller gets `admin_override_required` with the full, current list (and
 * `changed` when what the admin confirmed is no longer what applies).
 * Returns the audit record to store, or undefined when nothing was overridden.
 * Creations may only override as approved; reschedules and approvals of a
 * pending appointment may too (a pending one takes no seat until approved).
 */
export function authorizeAdminOverride(input: {
  restrictions: AdminRestriction[];
  request: AdminOverrideRequest;
  status: "pending" | "approved";
  adminUid: string;
  adminEmail: string;
  now: string;
  operation?: AdminOverrideOperation;
}): AdminOverrideAudit | undefined {
  const { restrictions, request } = input;
  const operation = input.operation ?? "create";
  if (restrictions.length === 0) return undefined;

  const fingerprint = restrictionsFingerprint(restrictions);
  const requiresPastConfirmation = restrictions.some((item) => item.reason === "slot_not_future");
  if (operation === "create" && input.status !== "approved") {
    throw new HttpsError(
      "failed-precondition",
      `La franja tiene restricciones (${describe(restrictions)}). Solo se pueden autorizar excepciones en citas creadas como aprobadas.`,
      { reason: "override_requires_approved", restrictions },
    );
  }
  const changed = Boolean(request.acknowledgedRestrictions) && request.acknowledgedRestrictions !== fingerprint;
  const pastMissing = requiresPastConfirmation && !request.confirmPastDate;
  if (request.acknowledgedRestrictions !== fingerprint || pastMissing) {
    throw new HttpsError(
      "failed-precondition",
      changed
        ? "Las condiciones de la franja han cambiado. Revisa las restricciones y vuelve a confirmar."
        : pastMissing && request.acknowledgedRestrictions === fingerprint
          ? "Confirma explícitamente que quieres registrar una cita en fecha pasada."
          : `La franja tiene restricciones (${describe(restrictions)}). Confírmalas para ${OVERRIDE_CONFIRM_ACTION[operation]} igualmente.`,
      {
        reason: ADMIN_OVERRIDE_REQUIRED,
        restrictions,
        fingerprint,
        requiresPastConfirmation,
        changed,
      },
    );
  }
  return {
    authorizedByUid: input.adminUid,
    authorizedByEmail: input.adminEmail,
    authorizedAt: input.now,
    restrictions,
    pastDateConfirmed: requiresPastConfirmation,
  };
}

// ------------------------------------------------------------ idempotency

export function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID_RE.test(value)) {
    throw new HttpsError("invalid-argument", "Falta el identificador de la operación. Recarga la página e inténtalo de nuevo.", {
      reason: "invalid_request_id",
    });
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of what is being booked; confirmation fields are excluded on purpose. */
export function bookingPayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

/** One kind per admin operation, so an id can never be replayed as another operation. */
export type AdminRequestKind = "single" | "series" | "reschedule_single" | "reschedule_series";

/** Optional `requestId`: older clients that do not send one keep working without idempotency. */
export function parseOptionalRequestId(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : parseRequestId(value);
}

export interface IdempotencyMarker {
  ref: DocumentReference;
  /** Result of the earlier identical request, when this one is a repeat. */
  previous?: Record<string, unknown>;
}

/**
 * Reads the marker of `requestId` inside the transaction. A repeat of the same
 * request returns the stored result; reusing the id for other data is refused.
 */
export async function readIdempotencyMarker(
  transaction: Transaction,
  db: Firestore,
  input: { requestId: string; adminUid: string; kind: AdminRequestKind; payloadHash: string },
): Promise<IdempotencyMarker> {
  const ref = db.collection(ADMIN_BOOKING_REQUESTS).doc(input.requestId);
  const snap = await transaction.get(ref);
  if (!snap.exists) return { ref };
  const stored = snap.data() as { adminUid?: string; kind?: string; payloadHash?: string; result?: Record<string, unknown> };
  if (stored.adminUid !== input.adminUid || stored.kind !== input.kind || stored.payloadHash !== input.payloadHash) {
    throw new HttpsError("failed-precondition", "Esta operación ya se usó con otros datos. Vuelve a abrir el formulario.", {
      reason: "request_id_reused",
    });
  }
  return { ref, previous: stored.result ?? {} };
}

export function writeIdempotencyMarker(
  transaction: Transaction,
  marker: IdempotencyMarker,
  input: { adminUid: string; kind: AdminRequestKind; payloadHash: string; result: Record<string, unknown>; now: string },
): void {
  transaction.create(marker.ref, {
    adminUid: input.adminUid,
    kind: input.kind,
    payloadHash: input.payloadHash,
    result: input.result,
    createdAt: input.now,
  });
}
