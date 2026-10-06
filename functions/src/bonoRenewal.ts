import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  calculateAppointmentDeduction,
  getAppointmentEffectiveSlot,
  getBonoRemainingMinutes,
  getMadridDateKey,
  isBonoExpiredAt,
  type LifecycleBono,
} from "./appointmentLifecycle.js";
import { addUtcDays } from "./recurringAppointments.js";
import { bonoCivilDate } from "./notifications/bonoEvents.js";
import {
  MAX_RENEWAL_ITEMS,
  planRenewalCandidates,
  type RenewalCandidate,
  type RenewalSourceSeries,
  slotsEqual,
} from "./bonoRenewalPlanning.js";
import {
  appointmentDurationOf,
  evaluateSlot,
  getAppointmentType,
  type IdentifiedAppointment,
  loadCustomerActiveAppointments,
  loadSiteConfig,
  loadSlotDay,
  loadTrainer,
  type SlotDayContext,
  type SlotRejectionReason,
  type SlotTimeSlot,
  type SnapshotReader,
  directReader,
  type TrainerSnapshot,
} from "./slotValidation.js";
import type { CustomerConfirmation } from "./appointmentProposals.js";
import { sessionsOf, writeNotificationOutbox } from "./notifications/outbox.js";
import type { SiteConfig } from "./siteConfig.js";

export const BONO_RENEWALS_COLLECTION = "bono_renewals";

/** Reasons specific to renewals on top of the slot rejections. */
export type RenewalItemReason =
  | SlotRejectionReason
  | "insufficient_minutes"
  | "outside_bono_period"
  | "already_created";

export interface RenewalItemInput extends RenewalCandidate {
  /** True when the admin moved it away from the original pattern. */
  modified?: boolean;
}

export interface RenewalItemResult extends RenewalItemInput {
  status: "ready" | "conflict" | "created" | "already_created";
  reason?: RenewalItemReason;
  trainerName?: string;
  appointmentId?: string;
}

export interface BonoRenewalDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

interface SeriesDoc {
  userId?: string;
  bonoId?: string;
  status?: string;
  intervalDays?: number;
  duration?: string | number;
  serviceType?: string;
  assignedTrainer?: string | null;
  startDate?: string;
  startTime?: string;
}

interface OccurrenceDoc {
  status?: string;
  duration?: string | number;
  approvedSlot?: SlotTimeSlot | null;
  preferredSlots?: SlotTimeSlot[];
  date?: string;
  time?: string;
  assignedTrainer?: string | null;
  serviceType?: string;
  sessionType?: string;
  appointmentType?: unknown;
}

interface BonoDoc extends Omit<LifecycleBono, "id"> {
  userId?: string;
  fechaAsignacion?: string;
  historial?: unknown[];
}

function fail(code: "invalid-argument" | "failed-precondition" | "permission-denied", message: string, reason: string): never {
  throw new HttpsError(code, message, { reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isSlot(value: unknown): value is SlotTimeSlot {
  return isRecord(value) && typeof value.date === "string" && DATE_RE.test(value.date)
    && typeof value.time === "string" && TIME_RE.test(value.time);
}

function text(value: unknown, field: string, max = 256): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) fail("invalid-argument", `El campo ${field} no es válido.`, "invalid_request");
  return result;
}

function parseItems(value: unknown): RenewalItemInput[] {
  if (!Array.isArray(value) || value.length > MAX_RENEWAL_ITEMS) {
    fail("invalid-argument", "La lista de citas a renovar no es válida.", "invalid_items");
  }
  const keys = new Set<string>();
  return value.map((raw) => {
    if (!isRecord(raw) || !isSlot(raw.slot) || !isSlot(raw.originalSlot)) {
      fail("invalid-argument", "Una de las citas a renovar no es válida.", "invalid_items");
    }
    const key = text(raw.key, "clave", 200);
    if (keys.has(key)) fail("invalid-argument", "Hay citas duplicadas en la renovación.", "duplicate_items");
    keys.add(key);
    const durationMinutes = Number(raw.durationMinutes);
    if (![30, 45, 60].includes(durationMinutes)) {
      fail("invalid-argument", "La duración de una cita no es válida.", "invalid_items");
    }
    const trainerId = typeof raw.trainerId === "string" && raw.trainerId.trim() ? raw.trainerId.trim() : null;
    return {
      key,
      sourceSeriesId: text(raw.sourceSeriesId, "serie"),
      originalSlot: { date: raw.originalSlot.date, time: raw.originalSlot.time },
      slot: { date: raw.slot.date, time: raw.slot.time },
      durationMinutes,
      trainerId,
      serviceType: typeof raw.serviceType === "string" ? raw.serviceType.slice(0, 180) : "",
      sessionType: typeof raw.sessionType === "string" ? raw.sessionType.slice(0, 180) : "",
      modified: raw.modified === true || !slotsEqual(raw.slot, raw.originalSlot),
    };
  });
}

/** Deterministic id: retries of the same renewal never duplicate an appointment. */
export function renewalAppointmentId(renewalId: string, key: string): string {
  return `renewal_${renewalId}_${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
}

interface ValidationContext {
  config: SiteConfig;
  days: Map<string, SlotDayContext>;
  trainers: Map<string, TrainerSnapshot>;
  customerAppointments: IdentifiedAppointment[];
}

async function loadValidationContext(
  reader: SnapshotReader,
  db: Firestore,
  userId: string,
  items: RenewalItemInput[],
): Promise<ValidationContext> {
  const [config, customerAppointments] = await Promise.all([
    loadSiteConfig(reader, db),
    loadCustomerActiveAppointments(reader, db, userId),
  ]);
  const dates = [...new Set(items.map((item) => item.slot.date))];
  const trainerIds = [...new Set(items.map((item) => item.trainerId).filter((id): id is string => Boolean(id)))];
  const [days, trainers] = await Promise.all([
    Promise.all(dates.map((date) => loadSlotDay(reader, db, config, date))),
    Promise.all(trainerIds.map((id) => loadTrainer(reader, db, id))),
  ]);
  return {
    config,
    days: new Map(dates.map((date, index) => [date, days[index]])),
    trainers: new Map(trainerIds.map((id, index) => [id, trainers[index]])),
    customerAppointments,
  };
}

/**
 * Validates the batch in chronological order: each accepted item consumes
 * minutes and blocks its slot for the following ones, so the batch can
 * never overbook the bono or the customer.
 */
export function validateRenewalItems(
  items: RenewalItemInput[],
  context: ValidationContext,
  options: { availableMinutes: number; periodStart: string; periodEnd: string; now: Date },
): RenewalItemResult[] {
  let remaining = options.availableMinutes;
  const planned: Array<{ slot: SlotTimeSlot; durationMinutes: number }> = [];
  const ordered = [...items].sort((a, b) => `${a.slot.date}T${a.slot.time}|${a.key}`
    .localeCompare(`${b.slot.date}T${b.slot.time}|${b.key}`));
  return ordered.map((item) => {
    let reason: RenewalItemReason | undefined;
    if (item.slot.date < options.periodStart || item.slot.date > options.periodEnd) {
      reason = "outside_bono_period";
    } else {
      const day = context.days.get(item.slot.date);
      reason = day ? evaluateSlot(day, {
        slot: item.slot,
        durationMinutes: item.durationMinutes,
        appointmentType: "training",
        now: options.now,
        customerAppointments: context.customerAppointments,
        plannedCustomerSlots: planned,
        trainer: item.trainerId ? context.trainers.get(item.trainerId) : undefined,
      }) : "outside_schedule";
    }
    // Conflicts keep their minutes reserved in the budget: the admin may fix them.
    if (item.durationMinutes > remaining) {
      reason = "insufficient_minutes";
    } else {
      remaining -= item.durationMinutes;
    }
    if (!reason) planned.push({ slot: item.slot, durationMinutes: item.durationMinutes });
    return { ...item, status: reason ? "conflict" : "ready", ...(reason ? { reason } : {}) };
  });
}

function seriesPatternFrom(seriesId: string, series: SeriesDoc, occurrences: OccurrenceDoc[]): RenewalSourceSeries | undefined {
  const approved = occurrences
    .filter((occurrence) => occurrence.status === "approved" && getAppointmentType(occurrence) === "training")
    .map((occurrence) => ({ occurrence, slot: getAppointmentEffectiveSlot(occurrence) }))
    .filter((entry): entry is { occurrence: OccurrenceDoc; slot: SlotTimeSlot } => Boolean(entry.slot))
    .sort((a, b) => `${a.slot.date}T${a.slot.time}`.localeCompare(`${b.slot.date}T${b.slot.time}`));
  const last = approved.at(-1);
  const intervalDays = Number(series.intervalDays);
  const durationMinutes = last ? appointmentDurationOf(last.occurrence) : appointmentDurationOf(series);
  if (!last || !Number.isInteger(intervalDays) || intervalDays < 1 || !durationMinutes) return undefined;
  const trainer = last.occurrence.assignedTrainer ?? series.assignedTrainer ?? null;
  return {
    seriesId,
    intervalDays,
    durationMinutes,
    serviceType: last.occurrence.serviceType || series.serviceType || "",
    sessionType: last.occurrence.sessionType || "",
    trainerId: typeof trainer === "string" && trainer ? trainer : null,
    lastSlot: last.slot,
  };
}

export function createBonoRenewalHandlers(deps: BonoRenewalDeps) {
  const { db, requireAdmin, getNowDate } = deps;

  async function trainerNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const snaps = await Promise.all(unique.map((id) => db.collection("trainers").doc(id).get()));
    return new Map(unique.map((id, index) => {
      const name = snaps[index].exists ? (snaps[index].data() as { name?: unknown }).name : undefined;
      return [id, typeof name === "string" ? name : ""];
    }));
  }

  async function loadSourcePatterns(userId: string, sourceBonoId: string): Promise<RenewalSourceSeries[]> {
    const seriesSnap = await db.collection("appointment_recurrences")
      .where("userId", "==", userId)
      .where("bonoId", "==", sourceBonoId)
      .where("status", "==", "approved")
      .get();
    const patterns = await Promise.all(seriesSnap.docs.map(async (seriesDoc) => {
      const occurrences = await db.collection("appointments")
        .where("recurrenceSeriesId", "==", seriesDoc.id)
        .get();
      return seriesPatternFrom(
        seriesDoc.id,
        seriesDoc.data() as SeriesDoc,
        occurrences.docs.map((docSnap) => docSnap.data() as OccurrenceDoc),
      );
    }));
    return patterns.filter((pattern): pattern is RenewalSourceSeries => Boolean(pattern));
  }

  async function previewBonoAppointmentRenewalFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    if (!request.auth) fail("permission-denied", "Debes iniciar sesión como admin.", "unauthenticated");
    await requireAdmin(request.auth.uid);
    const data = isRecord(request.data) ? request.data : {};
    const userId = text(data.userId, "cliente", 128);
    const sourceBonoId = text(data.sourceBonoId, "bono anterior", 128);
    const periodStart = text(data.periodStart, "inicio", 10);
    const periodEnd = text(data.periodEnd, "fin", 10);
    if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd) || periodEnd < periodStart) {
      fail("invalid-argument", "El periodo del bono no es válido.", "invalid_period");
    }
    const availableMinutes = Number(data.availableMinutes);
    if (!Number.isInteger(availableMinutes) || availableMinutes < 0) {
      fail("invalid-argument", "Los minutos disponibles no son válidos.", "invalid_minutes");
    }

    const now = getNowDate();
    let items: RenewalItemInput[];
    if (data.items !== undefined) {
      items = parseItems(data.items);
    } else {
      const sourceBonoSnap = await db.collection("bonos").doc(sourceBonoId).get();
      if (!sourceBonoSnap.exists || (sourceBonoSnap.data() as BonoDoc).userId !== userId) {
        fail("failed-precondition", "No se ha encontrado el bono anterior del cliente.", "source_bono_not_found");
      }
      const patterns = await loadSourcePatterns(userId, sourceBonoId);
      items = planRenewalCandidates(patterns, periodStart, periodEnd, addUtcDays(getMadridDateKey(now), 1))
        .slice(0, MAX_RENEWAL_ITEMS);
    }

    const context = await loadValidationContext(directReader, db, userId, items);
    const results = validateRenewalItems(items, context, { availableMinutes, periodStart, periodEnd, now });
    const names = await trainerNames(results.map((item) => item.trainerId));
    return {
      items: results.map((item) => ({ ...item, trainerName: item.trainerId ? names.get(item.trainerId) ?? "" : "" })),
    };
  }

  async function commitBonoAppointmentRenewalFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    if (!request.auth) fail("permission-denied", "Debes iniciar sesión como admin.", "unauthenticated");
    await requireAdmin(request.auth.uid);
    const adminUid = request.auth.uid;
    const data = isRecord(request.data) ? request.data : {};
    const renewalId = text(data.renewalId, "renovación", 64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(renewalId)) {
      fail("invalid-argument", "El identificador de la renovación no es válido.", "invalid_request");
    }
    const userId = text(data.userId, "cliente", 128);
    const bonoId = text(data.bonoId, "bono", 128);
    const sourceBonoId = text(data.sourceBonoId, "bono anterior", 128);
    const items = parseItems(data.items);
    const skipped = Array.isArray(data.skipped)
      ? data.skipped.slice(0, MAX_RENEWAL_ITEMS).filter(isRecord).map((entry) => ({
        key: typeof entry.key === "string" ? entry.key.slice(0, 200) : "",
        originalSlot: isSlot(entry.originalSlot) ? { date: entry.originalSlot.date, time: entry.originalSlot.time } : null,
        reason: typeof entry.reason === "string" ? entry.reason.slice(0, 64) : "skipped_by_admin",
      }))
      : [];

    const renewalRef = db.collection(BONO_RENEWALS_COLLECTION).doc(renewalId);
    const bonoRef = db.collection("bonos").doc(bonoId);
    const userRef = db.collection("users").doc(userId);
    const appointmentRefs = new Map(items.map((item) => [
      item.key,
      db.collection("appointments").doc(renewalAppointmentId(renewalId, item.key)),
    ]));

    const result = await db.runTransaction(async (transaction) => {
      const [renewalSnap, bonoSnap, userSnap, ...existingSnaps] = await Promise.all([
        transaction.get(renewalRef),
        transaction.get(bonoRef),
        transaction.get(userRef),
        ...items.map((item) => transaction.get(appointmentRefs.get(item.key)!)),
      ]);
      const renewal = renewalSnap.exists ? renewalSnap.data() as Record<string, unknown> : undefined;
      if (renewal && (renewal.userId !== userId || renewal.bonoId !== bonoId)) {
        fail("failed-precondition", "La renovación indicada pertenece a otro bono.", "renewal_mismatch");
      }
      if (!bonoSnap.exists) fail("failed-precondition", "No se ha encontrado el nuevo bono.", "bono_not_found");
      const bono = bonoSnap.data() as BonoDoc;
      const now = getNowDate();
      if (bono.userId !== userId || bono.estado !== "activo" || isBonoExpiredAt({ ...bono, id: bonoId }, now)) {
        fail("failed-precondition", "El nuevo bono no está activo.", "bono_not_active");
      }
      if (!userSnap.exists) fail("failed-precondition", "No se ha encontrado el cliente.", "user_not_found");
      const user = userSnap.data() as { name?: string; email?: string; phone?: string };

      const alreadyCreated = new Set(items.filter((_item, index) => existingSnaps[index].exists).map((item) => item.key));
      const pending = items.filter((item) => !alreadyCreated.has(item.key));
      const context = await loadValidationContext(transaction, db, userId, pending);
      const periodStart = bonoCivilDate(bono.fechaAsignacion) ?? getMadridDateKey(now);
      const periodEnd = bonoCivilDate(bono.fechaExpiracion) ?? "9999-12-31";
      const validated = validateRenewalItems(pending, context, {
        availableMinutes: getBonoRemainingMinutes({ ...bono, id: bonoId }),
        periodStart,
        periodEnd,
        now,
      });

      const nowIso = now.toISOString();
      const ready = validated.filter((item) => item.status === "ready");
      const attempt = (typeof renewal?.attempts === "number" ? renewal.attempts : 0) + 1;
      const operationRef = db.collection("notification_outbox").doc(`renewal_${renewalId}_${attempt}`);
      let workingBono: LifecycleBono = { ...bono, id: bonoId };
      const historial = [...(Array.isArray(bono.historial) ? bono.historial : [])];
      const created: RenewalItemResult[] = [];

      for (const item of ready) {
        const deduction = calculateAppointmentDeduction(workingBono, item.durationMinutes, nowIso);
        if (!deduction.ok) {
          created.push({ ...item, status: "conflict", reason: "insufficient_minutes" });
          continue;
        }
        workingBono = { ...workingBono, minutosRestantes: deduction.remainingMinutes, estado: deduction.bonoStatus };
        const ref = appointmentRefs.get(item.key)!;
        const confirmation: CustomerConfirmation = {
          kind: "renewal",
          renewalId,
          requestedAt: nowIso,
          requestedBy: adminUid,
          response: null,
          respondedAt: null,
        };
        transaction.create(ref, {
          userId,
          name: user.name ?? "",
          email: user.email ?? "",
          phone: user.phone ?? "",
          serviceType: item.serviceType,
          ...(item.sessionType ? { sessionType: item.sessionType } : {}),
          appointmentType: "training",
          duration: String(item.durationMinutes),
          preferredSlots: [item.slot],
          date: item.slot.date,
          time: item.slot.time,
          reason: "",
          status: "pending",
          ...(item.trainerId ? { assignedTrainer: item.trainerId } : {}),
          createdByAdmin: true,
          createdByAdminUid: adminUid,
          bonoId,
          minutesDeducted: true,
          minutesDeductedAmount: item.durationMinutes,
          minutesDeductedAt: nowIso,
          minutesRefunded: false,
          minutesRefundedAmount: null,
          minutesRefundedAt: null,
          minutesRefundReason: null,
          customerConfirmation: confirmation,
          renewalId,
          renewalSourceSeriesId: item.sourceSeriesId,
          renewalOriginalSlot: item.originalSlot,
          renewalModified: item.modified === true,
          notificationOperationId: operationRef.id,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        historial.push({
          fecha: nowIso,
          tipo: item.serviceType,
          duracion: String(item.durationMinutes),
          appointmentId: ref.id,
          accion: "descuento_cita",
        });
        created.push({ ...item, status: "created", appointmentId: ref.id });
      }

      const createdItems = created.filter((item) => item.status === "created");
      if (createdItems.length) {
        transaction.set(bonoRef, {
          minutosRestantes: workingBono.minutosRestantes,
          estado: workingBono.estado,
          historial,
        }, { merge: true });
      }

      const conflicts = [
        ...validated.filter((item) => item.status === "conflict"),
        ...created.filter((item) => item.status === "conflict"),
      ];
      const previousCreated = Array.isArray(renewal?.created) ? renewal.created as Array<Record<string, unknown>> : [];
      const summaryCreated = [
        ...previousCreated,
        ...createdItems.map((item) => ({
          key: item.key,
          appointmentId: item.appointmentId,
          slot: item.slot,
          originalSlot: item.originalSlot,
          modified: item.modified === true,
        })),
      ];
      const previousSkipped = Array.isArray(renewal?.skipped) ? renewal.skipped as Array<{ key?: string }> : [];
      const skippedKeys = new Set(previousSkipped.map((entry) => entry.key));
      transaction.set(renewalRef, {
        userId,
        bonoId,
        sourceBonoId,
        createdBy: renewal?.createdBy ?? adminUid,
        createdAt: renewal?.createdAt ?? nowIso,
        updatedAt: nowIso,
        attempts: attempt,
        created: summaryCreated,
        skipped: [...previousSkipped, ...skipped.filter((entry) => !skippedKeys.has(entry.key))],
        conflicts: conflicts.map((item) => ({ key: item.key, slot: item.slot, reason: item.reason ?? null })),
        status: conflicts.length ? "has_conflicts" : "completed",
      }, { merge: true });

      writeNotificationOutbox(transaction, { operationId: operationRef.id, ref: operationRef }, {
        userId,
        event: "appointment_series_renewal_pending",
        seriesId: renewalId,
        appointmentIds: createdItems.map((item) => item.appointmentId as string),
        sessions: sessionsOf(createdItems.map((item) => ({ preferredSlots: [item.slot] }))),
        customerName: user.name ?? "",
        customerEmail: user.email ?? "",
        actor: "admin",
        createdAt: nowIso,
      });
      if (createdItems.length) {
        transaction.create(db.collection("activity_logs").doc(), {
          action: "bono_appointments_renewed_by_admin",
          adminUid,
          renewalId,
          bonoId,
          sourceBonoId,
          targetUid: userId,
          createdCount: createdItems.length,
          conflictCount: conflicts.length,
          createdAt: nowIso,
          timestamp: nowIso,
        });
      }

      return {
        created: createdItems,
        alreadyCreated: items.filter((item) => alreadyCreated.has(item.key))
          .map((item) => ({ ...item, status: "already_created" as const, reason: "already_created" as const })),
        conflicts,
      };
    });

    const names = await trainerNames([...result.created, ...result.conflicts].map((item) => item.trainerId));
    const withName = (item: RenewalItemResult) => ({
      ...item,
      trainerName: item.trainerId ? names.get(item.trainerId) ?? "" : "",
    });
    return {
      success: true,
      renewalId,
      created: result.created.map(withName),
      alreadyCreated: result.alreadyCreated.map(withName),
      conflicts: result.conflicts.map(withName),
    };
  }

  return { previewBonoAppointmentRenewalFromAdmin, commitBonoAppointmentRenewalFromAdmin };
}
