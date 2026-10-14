import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getAppointmentEffectiveSlot,
  getCanonicalSlotBlocks,
  madridCivilSlotToInstant,
  slotOccupancyDocId,
} from "./appointmentLifecycle.js";
import {
  applyApprovalDeductionInTransaction,
  type FinanceAppointment,
  type FinanceContext,
  type FinanceSnapshot,
  readFinanceContext,
  refundAppointmentMinutesInTransaction,
} from "./appointmentFinance.js";
import { openCustomerConfirmation, withdrawOpenProposalPatch, type CustomerConfirmation, type AppointmentProposal, type ProposalHistoryEntry } from "./appointmentProposals.js";
import { readSeriesForOccurrence, type SeriesReadResult, seriesMetadataPatch } from "./seriesMetadata.js";
import {
  addOccupancyDelta,
  appointmentOccupancyKeys,
  InvalidOccupancyError,
  occupancyKeysForSlot,
  planOccupancyWrites,
  sessionMinutesOf,
} from "./slotOccupancy.js";
import {
  evaluateSlot,
  getAppointmentType,
  loadCustomerActiveAppointments,
  loadSiteConfig,
  loadSlotDay,
  loadTrainer,
  loadTrainerActiveAppointments,
  SLOT_REJECTION_MESSAGES,
  type SlotDayContext,
  type SlotRejectionReason,
} from "./slotValidation.js";

/**
 * Admin booking operations that used to run as several independent writes in
 * the browser (status change + `slot_occupancy` ± 1, delete + decrement,
 * block + delete, deactivate bono + create bono). Each one is now a single
 * Firestore transaction that re-reads the real state, so a double click, a
 * stale admin screen or a concurrent customer action can no longer apply an
 * operation twice or leave counters half-updated.
 */

export interface AdminAppointmentStatusDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

interface CallableRequest {
  auth?: { uid: string; token?: { email?: string } };
  data: unknown;
}

type AppointmentStatus = "pending" | "approved" | "rejected" | "cancelled";
const STATUSES: readonly AppointmentStatus[] = ["pending", "approved", "rejected", "cancelled"];

/** Transitions the admin panel offers. Anything else is refused. */
const ALLOWED_TRANSITIONS = new Set([
  "pending>approved",
  "pending>rejected",
  "approved>cancelled",
  "approved>pending",
  "rejected>pending",
]);

const MAX_DELETE_BATCH = 40;

interface SlotLike {
  date: string;
  time: string;
}

interface AdminAppointmentData extends FinanceAppointment {
  name?: string;
  email?: string;
  status: AppointmentStatus;
  duration?: string | number;
  appointmentType?: unknown;
  serviceType?: string;
  approvedSlot?: SlotLike | null;
  preferredSlots?: SlotLike[];
  date?: string;
  time?: string;
  assignedTrainer?: string | null;
  recurrenceSeriesId?: string;
  customerConfirmation?: CustomerConfirmation | null;
  proposal?: AppointmentProposal | null;
  proposalHistory?: ProposalHistoryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: "invalid-argument" | "failed-precondition" | "permission-denied" | "not-found", message: string, reason: string, extra: Record<string, unknown> = {}): never {
  throw new HttpsError(code, message, { reason, ...extra });
}

async function requireAdminRequest(deps: AdminAppointmentStatusDeps, request: CallableRequest): Promise<{ uid: string; email: string }> {
  if (!request.auth) fail("permission-denied", "Debes iniciar sesión como admin.", "unauthenticated");
  await deps.requireAdmin(request.auth.uid);
  return { uid: request.auth.uid, email: request.auth.token?.email ?? "" };
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("/")) {
    fail("invalid-argument", `${label} no es válido.`, "invalid_request");
  }
  return value.trim();
}

function parseStatus(value: unknown): AppointmentStatus {
  if (typeof value !== "string" || !STATUSES.includes(value as AppointmentStatus)) {
    fail("invalid-argument", "El estado indicado no es válido.", "invalid_request");
  }
  return value as AppointmentStatus;
}

function isSlot(value: unknown): value is SlotLike {
  return isRecord(value)
    && typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time);
}

/** Slot of a request before approval: preferredSlots[0], else legacy date/time (never a stale approvedSlot). */
function requestedSlot(appointment: AdminAppointmentData): SlotLike | undefined {
  return getAppointmentEffectiveSlot({ preferredSlots: appointment.preferredSlots, date: appointment.date, time: appointment.time });
}

function rejection(reason: SlotRejectionReason, extra: Record<string, unknown> = {}): never {
  fail("failed-precondition", SLOT_REJECTION_MESSAGES[reason], reason, extra);
}

function occupancyFailure(error: unknown): never {
  if (error instanceof InvalidOccupancyError) rejection("invalid_occupancy", { key: error.key });
  throw error;
}

/** Highest count among the blocks of a session (for the over-capacity prompt). */
function peakOccupancy(day: SlotDayContext, slot: SlotLike, durationMinutes: number): number {
  return Math.max(0, ...getCanonicalSlotBlocks(slot.time, durationMinutes).map((time) => day.occupancyByTime.get(time) ?? 0));
}

function writeOccupancy(transaction: Transaction, db: Firestore, delta: Map<string, number>, raw: Map<string, unknown>): void {
  let planned: ReturnType<typeof planOccupancyWrites>;
  try {
    planned = planOccupancyWrites(delta, raw);
  } catch (error) {
    occupancyFailure(error);
  }
  if (planned.clamped.length) console.warn("[AdminStatus] Occupancy release clamped at 0", { keys: planned.clamped });
  planned.writes.forEach((write) => {
    transaction.set(db.collection("slot_occupancy").doc(write.key), {
      date: write.date,
      time: write.time,
      count: write.count,
    }, { merge: true });
  });
}

async function readOccupancyRaw(transaction: Transaction, db: Firestore, keys: Iterable<string>): Promise<Map<string, unknown>> {
  const unique = [...new Set(keys)].sort();
  const snaps = await Promise.all(unique.map((key) => transaction.get(db.collection("slot_occupancy").doc(key))));
  const raw = new Map<string, unknown>();
  snaps.forEach((snap, index) => {
    if (snap.exists) raw.set(unique[index], (snap.data() as { count?: unknown }).count);
  });
  return raw;
}

// --------------------------------------------------------------- bono working copies

/**
 * Several refunds in one transaction may hit the same bono. Snapshots share a
 * working copy so each refund sees the minutes left by the previous one.
 */
class BonoLedger {
  private readonly working = new Map<string, Record<string, unknown>>();
  private readonly refs = new Map<string, DocumentReference>();

  wrap(snap: FinanceSnapshot | undefined): FinanceSnapshot | undefined {
    if (!snap) return undefined;
    if (snap.exists && !this.working.has(snap.id)) {
      this.working.set(snap.id, { ...(snap.data() as Record<string, unknown>) });
      this.refs.set(snap.id, snap.ref);
    }
    return {
      exists: snap.exists,
      id: snap.id,
      ref: snap.ref,
      data: () => (snap.exists ? { ...this.working.get(snap.id) } : undefined),
    };
  }

  context(context: FinanceContext): FinanceContext {
    return {
      originalBono: this.wrap(context.originalBono),
      activeBonos: context.activeBonos.map((snap) => this.wrap(snap) as FinanceSnapshot),
    };
  }

  /** Transaction proxy that keeps the working copy in sync with bono writes. */
  transaction(transaction: Transaction): Transaction {
    return new Proxy(transaction, {
      get: (target, property) => {
        if (property !== "set") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (ref: DocumentReference, value: Record<string, unknown>, options?: unknown) => {
          const id = ref.id;
          if (this.refs.has(id) && this.refs.get(id)?.path === ref.path) {
            const next = { ...this.working.get(id) };
            for (const [field, fieldValue] of Object.entries(value)) {
              if (field !== "historial") next[field] = fieldValue;
            }
            this.working.set(id, next);
          }
          return (target.set as (...args: unknown[]) => unknown).call(target, ref, value, options);
        };
      },
    }) as Transaction;
  }
}

// --------------------------------------------------------------- deletion core

interface PreparedDeletion {
  ref: DocumentReference;
  id: string;
  data: AdminAppointmentData;
  finance: FinanceContext;
}

interface DeletionReadResult {
  prepared: PreparedDeletion[];
  missing: string[];
  occupancyRaw: Map<string, unknown>;
  occupancyDelta: Map<string, number>;
  series: Map<string, SeriesReadResult>;
}

async function readDeletions(transaction: Transaction, db: Firestore, ids: string[]): Promise<DeletionReadResult> {
  const refs = ids.map((id) => db.collection("appointments").doc(id));
  const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
  const existing = snaps
    .map((snap, index) => ({ snap, ref: refs[index], id: ids[index] }))
    .filter(({ snap }) => snap.exists);
  const missing = snaps.map((snap, index) => (snap.exists ? undefined : ids[index])).filter((id): id is string => Boolean(id));

  const occupancyDelta = new Map<string, number>();
  for (const { snap } of existing) {
    const data = snap.data() as AdminAppointmentData;
    if (data.status === "approved") addOccupancyDelta(occupancyDelta, appointmentOccupancyKeys(data), -1);
  }
  const seriesIds = [...new Set(existing
    .map(({ snap }) => (snap.data() as AdminAppointmentData).recurrenceSeriesId)
    .filter((id): id is string => typeof id === "string" && id.length > 0))];

  const [finances, seriesResults, occupancyRaw] = await Promise.all([
    Promise.all(existing.map(({ snap }) => readFinanceContext(transaction, db, snap.data() as AdminAppointmentData))),
    Promise.all(seriesIds.map((seriesId) => readSeriesForOccurrence(transaction, db, seriesId))),
    readOccupancyRaw(transaction, db, occupancyDelta.keys()),
  ]);
  return {
    prepared: existing.map(({ snap, ref, id }, index) => ({ ref, id, data: snap.data() as AdminAppointmentData, finance: finances[index] })),
    missing,
    occupancyRaw,
    occupancyDelta,
    series: new Map(seriesIds.map((seriesId, index) => [seriesId, seriesResults[index]])),
  };
}

function commitDeletions(
  transaction: Transaction,
  db: Firestore,
  read: DeletionReadResult,
  actor: { uid: string; email: string },
  now: Date,
  logAction: string,
): { deletedIds: string[]; refundedIds: string[] } {
  const nowIso = now.toISOString();
  const ledger = new BonoLedger();
  const tx = ledger.transaction(transaction);
  const refundedIds: string[] = [];

  writeOccupancy(transaction, db, read.occupancyDelta, read.occupancyRaw);
  for (const item of read.prepared) {
    const refund = refundAppointmentMinutesInTransaction(tx, item.ref, item.data, ledger.context(item.finance), nowIso, {
      persistAppointment: false,
    });
    if (refund.refunded) refundedIds.push(item.id);
  }
  for (const [seriesId, series] of read.series) {
    if (!series.exists) continue;
    const changes = new Map<string, string | null>(read.prepared
      .filter((item) => item.data.recurrenceSeriesId === seriesId)
      .map((item) => [item.id, null]));
    const patch = seriesMetadataPatch(series.occurrences, changes, now, () => FieldValue.delete());
    if (patch) transaction.set(series.seriesRef, patch, { merge: true });
  }
  for (const item of read.prepared) {
    transaction.delete(item.ref);
    transaction.create(db.collection("activity_logs").doc(), {
      action: logAction,
      adminUid: actor.uid,
      adminEmail: actor.email || "unknown",
      appointmentId: item.id,
      details: `Cita de ${item.data.name ?? ""} (ID: ${item.id})`,
      previousStatus: item.data.status,
      minutesRefunded: refundedIds.includes(item.id),
      timestamp: nowIso,
      createdAt: nowIso,
    });
  }
  return { deletedIds: read.prepared.map((item) => item.id), refundedIds };
}

function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DELETE_BATCH) {
    fail("invalid-argument", `Indica entre 1 y ${MAX_DELETE_BATCH} citas.`, "invalid_request");
  }
  return [...new Set(value.map((id) => parseId(id, "La cita")))];
}

// --------------------------------------------------------------- blocked slots

const SLOT_INTERVALS = new Set([15, 30, 45, 60]);

interface BlockedSlotDocument {
  id: string;
  date: string;
  time: string;
  reason?: string;
  createdBy: string;
  createdAt: string;
  blockGroupId: string;
  groupStartTime: string;
  groupDurationMinutes: number;
  sourceSlotInterval: number;
}

/** Same documents as the web `buildCanonicalBlockedSlotDocuments`. */
export function buildBlockedSlotDocuments(input: {
  date: string;
  startTimes: string[];
  groupDurationMinutes: number;
  reason?: string;
  createdBy: string;
  createdAt: string;
}): BlockedSlotDocument[] {
  const documents = new Map<string, BlockedSlotDocument>();
  for (const startTime of [...new Set(input.startTimes)].sort()) {
    const blockGroupId = `${input.date}_${startTime}_${input.groupDurationMinutes}`;
    for (const time of getCanonicalSlotBlocks(startTime, input.groupDurationMinutes)) {
      const id = slotOccupancyDocId(input.date, time);
      if (documents.has(id)) fail("invalid-argument", `El bloque ${input.date} ${time} pertenece a más de una selección.`, "invalid_request");
      documents.set(id, {
        id,
        date: input.date,
        time,
        ...(input.reason ? { reason: input.reason } : {}),
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        blockGroupId,
        groupStartTime: startTime,
        groupDurationMinutes: input.groupDurationMinutes,
        sourceSlotInterval: input.groupDurationMinutes,
      });
    }
  }
  return [...documents.values()].sort((left, right) => left.id.localeCompare(right.id));
}

// --------------------------------------------------------------- handlers

export function createAdminAppointmentStatusHandlers(deps: AdminAppointmentStatusDeps) {
  const { db } = deps;

  async function updateAppointmentStatusFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const actor = await requireAdminRequest(deps, request);
    const data = isRecord(request.data) ? request.data : {};
    const appointmentId = parseId(data.appointmentId, "La cita");
    const target = parseStatus(data.status);
    const expectedStatus = parseStatus(data.expectedStatus);
    const allowOverCapacity = data.allowOverCapacity === true;
    const requestedTrainer = data.assignedTrainer === undefined || data.assignedTrainer === null || data.assignedTrainer === ""
      ? undefined
      : parseId(data.assignedTrainer, "El profesional");
    const appointmentRef = db.collection("appointments").doc(appointmentId);

    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(appointmentRef);
      if (!snap.exists) fail("failed-precondition", "No se ha encontrado la cita indicada.", "appointment_not_found");
      const appointment = snap.data() as AdminAppointmentData;
      const current = appointment.status;

      // Idempotent: repeating the same operation (double click, retry) changes nothing.
      if (current === target) return { success: true, appointmentId, status: current, changed: false };
      if (current !== expectedStatus) {
        fail("failed-precondition", "La cita ha cambiado mientras la gestionabas. Revisa su estado actual.", "status_changed", {
          currentStatus: current,
        });
      }
      if (!ALLOWED_TRANSITIONS.has(`${current}>${target}`)) {
        fail("failed-precondition", "Este cambio de estado no está permitido.", "invalid_transition");
      }
      if (appointment.recurrenceSeriesId && !(current === "approved" && target === "cancelled")) {
        fail("failed-precondition", "Las citas recurrentes se gestionan como serie.", "recurring_series_action");
      }

      const nowDate = deps.getNowDate();
      const now = nowDate.toISOString();
      const duration = sessionMinutesOf(appointment);
      const logBase = {
        adminUid: actor.uid,
        adminEmail: actor.email || "unknown",
        appointmentId,
        details: `Cita ID: ${appointmentId}`,
        previousStatus: current,
        timestamp: now,
        createdAt: now,
      };

      if (target === "approved") {
        const slot = requestedSlot(appointment);
        if (!slot || !isSlot(slot)) fail("failed-precondition", "La cita no tiene una franja válida.", "invalid_slot");
        if (!duration) fail("failed-precondition", "La duración de la cita no es válida.", "invalid_duration");
        const confirmation = openCustomerConfirmation(appointment);
        if (confirmation?.kind === "renewal") {
          fail("failed-precondition", "Esta cita renovada está pendiente de confirmación del cliente.", "renewal_pending");
        }
        const appointmentType = getAppointmentType(appointment);
        const trainerId = requestedTrainer
          ?? (typeof appointment.assignedTrainer === "string" && appointment.assignedTrainer ? appointment.assignedTrainer : undefined);
        if (appointmentType === "nutrition" && !trainerId) {
          fail("invalid-argument", "Selecciona el profesional de nutrición que atenderá la consulta.", "trainer_required");
        }

        const [config, customerAppointments, trainer, trainerAppointments, finance] = await Promise.all([
          loadSiteConfig(transaction, db),
          loadCustomerActiveAppointments(transaction, db, appointment.userId),
          trainerId ? loadTrainer(transaction, db, trainerId) : Promise.resolve(undefined),
          trainerId && appointmentType === "nutrition"
            ? loadTrainerActiveAppointments(transaction, db, trainerId)
            : Promise.resolve([]),
          readFinanceContext(transaction, db, appointment),
        ]);
        const day = await loadSlotDay(transaction, db, config, slot.date);
        const start = madridCivilSlotToInstant(slot);
        const isPast = !start || start.getTime() <= nowDate.getTime();
        const blocks = getCanonicalSlotBlocks(slot.time, duration);
        if (blocks.some((time) => day.invalidOccupancyTimes?.has(time))) rejection("invalid_occupancy");

        let overCapacity = false;
        if (isPast) {
          // Registering a session that already happened: no availability check
          // (same rule as the admin reschedule), but the professional must be valid.
          if (trainer && (!trainer.exists || trainer.active === false)) rejection("trainer_unavailable");
          if (trainer && appointmentType === "nutrition" && trainer.offersNutrition !== true) rejection("trainer_not_nutrition");
        } else {
          const input = {
            slot,
            durationMinutes: duration,
            appointmentType,
            now: nowDate,
            customerAppointments,
            excludeAppointmentIds: [appointmentId],
            trainer,
            trainerAppointments,
          };
          const reason = evaluateSlot(day, input);
          if (reason === "slot_full") {
            // Capacity is the only rule an admin may override, and only once every other rule passes.
            const relaxed = evaluateSlot({ ...day, config: { ...day.config, maxCapacity: Number.MAX_SAFE_INTEGER } }, input);
            if (relaxed) rejection(relaxed);
            if (!allowOverCapacity) {
              rejection("slot_full", {
                overridable: true,
                occupancy: peakOccupancy(day, slot, duration),
                maxCapacity: day.config.maxCapacity,
              });
            }
            overCapacity = true;
          } else if (reason) {
            rejection(reason);
          }
        }

        const delta = new Map<string, number>();
        addOccupancyDelta(delta, occupancyKeysForSlot(slot, duration), 1);
        const raw = new Map<string, unknown>();
        blocks.forEach((time) => raw.set(slotOccupancyDocId(slot.date, time), day.occupancyByTime.get(time) ?? 0));
        writeOccupancy(transaction, db, delta, raw);

        const proposalPatch = withdrawOpenProposalPatch(appointment, actor.uid, now, () => FieldValue.delete()) ?? {};
        transaction.set(appointmentRef, {
          ...proposalPatch,
          status: "approved",
          approvedSlot: slot,
          date: slot.date,
          time: slot.time,
          ...(trainerId ? { assignedTrainer: trainerId } : {}),
          ...(appointment.serviceType ? { sessionType: appointment.serviceType } : {}),
          approvedAt: now,
          approvedBy: "admin",
          approvedByAdminUid: actor.uid,
          updatedAt: now,
        }, { merge: true });
        applyApprovalDeductionInTransaction(
          transaction,
          appointmentRef,
          appointment,
          duration,
          finance,
          now,
        );
        transaction.create(db.collection("activity_logs").doc(), { ...logBase, action: "appointment_approved" });
        if (overCapacity) {
          transaction.create(db.collection("activity_logs").doc(), {
            ...logBase,
            action: "appointment_approved_over_capacity",
            date: slot.date,
            time: slot.time,
            occupancyBefore: peakOccupancy(day, slot, duration),
            maxCapacity: day.config.maxCapacity,
          });
        }
        return { success: true, appointmentId, status: "approved", changed: true, overCapacity };
      }

      if (target === "rejected") {
        const finance = await readFinanceContext(transaction, db, appointment);
        refundAppointmentMinutesInTransaction(transaction, appointmentRef, appointment, finance, now);
        transaction.set(appointmentRef, { status: "rejected", updatedAt: now }, { merge: true });
        transaction.create(db.collection("activity_logs").doc(), { ...logBase, action: "appointment_rejected" });
        return { success: true, appointmentId, status: "rejected", changed: true };
      }

      const releaseKeys = current === "approved" ? appointmentOccupancyKeys(appointment) : [];
      const [occupancyRaw, finance, series] = await Promise.all([
        readOccupancyRaw(transaction, db, releaseKeys),
        target === "cancelled" ? readFinanceContext(transaction, db, appointment) : Promise.resolve(undefined),
        target === "cancelled" && appointment.recurrenceSeriesId
          ? readSeriesForOccurrence(transaction, db, appointment.recurrenceSeriesId)
          : Promise.resolve(undefined),
      ]);
      const delta = new Map<string, number>();
      addOccupancyDelta(delta, releaseKeys, -1);
      writeOccupancy(transaction, db, delta, occupancyRaw);

      if (target === "cancelled") {
        if (finance) refundAppointmentMinutesInTransaction(transaction, appointmentRef, appointment, finance, now);
        if (series?.exists) {
          const patch = seriesMetadataPatch(series.occurrences, new Map([[appointmentId, "cancelled"]]), nowDate, () => FieldValue.delete());
          if (patch) transaction.set(series.seriesRef, patch, { merge: true });
        }
        transaction.set(appointmentRef, {
          status: "cancelled",
          cancelledBy: "admin",
          cancelledAt: now,
          updatedAt: now,
        }, { merge: true });
        transaction.create(db.collection("activity_logs").doc(), { ...logBase, action: "appointment_cancelled" });
        return { success: true, appointmentId, status: "cancelled", changed: true };
      }

      // Back to pending: keep the slot the admin sees, drop the stale approvedSlot.
      const slot = getAppointmentEffectiveSlot(appointment);
      transaction.set(appointmentRef, {
        status: "pending",
        ...(appointment.approvedSlot ? { approvedSlot: FieldValue.delete() } : {}),
        ...(slot ? { preferredSlots: [slot], date: slot.date, time: slot.time } : {}),
        updatedAt: now,
      }, { merge: true });
      transaction.create(db.collection("activity_logs").doc(), { ...logBase, action: "appointment_pending" });
      return { success: true, appointmentId, status: "pending", changed: true };
    });
  }

  async function deleteAppointmentsFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const actor = await requireAdminRequest(deps, request);
    const data = isRecord(request.data) ? request.data : {};
    const ids = parseIdList(data.appointmentIds);
    return db.runTransaction(async (transaction) => {
      const read = await readDeletions(transaction, db, ids);
      const result = commitDeletions(transaction, db, read, actor, deps.getNowDate(), "appointment_deleted");
      return { success: true, ...result, alreadyDeletedIds: read.missing };
    });
  }

  async function blockSlotsFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const actor = await requireAdminRequest(deps, request);
    const data = isRecord(request.data) ? request.data : {};
    const date = typeof data.date === "string" ? data.date : "";
    const groupDurationMinutes = Number(data.groupDurationMinutes);
    const startTimes = Array.isArray(data.startTimes) ? data.startTimes : [];
    if (!isSlot({ date, time: "00:00" }) || !SLOT_INTERVALS.has(groupDurationMinutes) || startTimes.length === 0
      || startTimes.length > 96 || !startTimes.every((time) => isSlot({ date, time }))) {
      fail("invalid-argument", "La selección de franjas no es válida.", "invalid_request");
    }
    const reason = typeof data.reason === "string" && data.reason.trim() ? data.reason.trim().slice(0, 300) : undefined;
    const deleteIds = data.deleteAppointmentIds === undefined || (Array.isArray(data.deleteAppointmentIds) && data.deleteAppointmentIds.length === 0)
      ? []
      : parseIdList(data.deleteAppointmentIds);

    return db.runTransaction(async (transaction) => {
      const nowDate = deps.getNowDate();
      const now = nowDate.toISOString();
      const documents = buildBlockedSlotDocuments({
        date,
        startTimes: startTimes as string[],
        groupDurationMinutes,
        ...(reason ? { reason } : {}),
        createdBy: actor.uid,
        createdAt: now,
      });
      const blockedRefs = documents.map((document) => db.collection("blocked_slots").doc(document.id));
      const [blockedSnaps, read] = await Promise.all([
        Promise.all(blockedRefs.map((ref) => transaction.get(ref))),
        deleteIds.length ? readDeletions(transaction, db, deleteIds) : Promise.resolve(undefined),
      ]);
      if (blockedSnaps.some((snap) => snap.exists)) {
        fail("failed-precondition", "Una de las franjas seleccionadas ya está bloqueada.", "slot_already_blocked");
      }
      const selection = new Set(documents.map((document) => document.id));
      for (const item of read?.prepared ?? []) {
        const keys = appointmentOccupancyKeys(item.data);
        if (!keys.some((key) => selection.has(key))) {
          fail("failed-precondition", "Una de las citas indicadas no está en las franjas a bloquear.", "appointment_not_in_selection");
        }
      }

      documents.forEach(({ id: _id, ...blockedSlot }, index) => transaction.create(blockedRefs[index], blockedSlot));
      const result = read
        ? commitDeletions(transaction, db, read, actor, nowDate, "appointment_deleted_on_block")
        : { deletedIds: [], refundedIds: [] };
      return {
        success: true,
        blockedSlotIds: documents.map((document) => document.id),
        ...result,
        alreadyDeletedIds: read?.missing ?? [],
      };
    });
  }

  async function assignBonoFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    const actor = await requireAdminRequest(deps, request);
    const data = isRecord(request.data) ? request.data : {};
    const userId = parseId(data.userId, "El cliente");
    const requestId = typeof data.requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(data.requestId) ? data.requestId : undefined;
    if (!requestId) fail("invalid-argument", "La solicitud no es válida.", "invalid_request");
    const tamano = Number(data.tamano);
    if (!Number.isInteger(tamano) || tamano < 15 || tamano > 100_000) {
      fail("invalid-argument", "El tamaño del bono no es válido.", "invalid_request");
    }
    const fechaAsignacion = typeof data.fechaAsignacion === "string" ? data.fechaAsignacion : "";
    const fechaExpiracion = typeof data.fechaExpiracion === "string" ? data.fechaExpiracion : "";
    const start = Date.parse(fechaAsignacion);
    const end = Date.parse(fechaExpiracion);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      fail("invalid-argument", "Las fechas del bono no son válidas.", "invalid_request");
    }

    const bonoRef = db.collection("bonos").doc(requestId);
    return db.runTransaction(async (transaction) => {
      const [existing, userSnap, activeSnap] = await Promise.all([
        transaction.get(bonoRef),
        transaction.get(db.collection("users").doc(userId)),
        transaction.get(db.collection("bonos").where("userId", "==", userId).where("estado", "==", "activo")),
      ]);
      if (existing.exists) {
        // Same request repeated (double click / retry): return the bono already created.
        if ((existing.data() as { userId?: string }).userId !== userId) {
          fail("failed-precondition", "La solicitud ya se usó para otro cliente.", "request_conflict");
        }
        return { success: true, bonoId: requestId, alreadyCreated: true, replacedBonoIds: [] };
      }
      if (!userSnap.exists) fail("failed-precondition", "No se ha encontrado el cliente indicado.", "user_not_found");

      const now = deps.getNowDate().toISOString();
      const replacedBonoIds = activeSnap.docs.map((snap) => snap.id);
      activeSnap.docs.forEach((snap) => {
        transaction.set(snap.ref, { estado: "agotado", replacedByBonoId: requestId, replacedAt: now }, { merge: true });
      });
      transaction.create(bonoRef, {
        userId,
        tamano,
        minutosTotales: tamano,
        minutosRestantes: tamano,
        fechaAsignacion,
        fechaExpiracion,
        estado: "activo",
        historial: [],
        asignadoPor: actor.email || "admin",
        createdAt: now,
      });
      return { success: true, bonoId: requestId, alreadyCreated: false, replacedBonoIds };
    });
  }

  return {
    updateAppointmentStatusFromAdmin,
    deleteAppointmentsFromAdmin,
    blockSlotsFromAdmin,
    assignBonoFromAdmin,
  };
}
