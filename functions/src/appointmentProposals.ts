import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import {
  getAppointmentEffectiveSlot,
  getCanonicalSlotBlocks,
  reconcileAppointmentMinutes,
  slotOccupancyDocId,
  type LifecycleBono,
} from "./appointmentLifecycle.js";
import {
  appointmentDurationOf,
  type AppointmentType,
  evaluateSlot,
  getAppointmentType,
  loadCustomerActiveAppointments,
  loadSiteConfig,
  loadSlotDay,
  loadTrainer,
  loadTrainerActiveAppointments,
  SLOT_REJECTION_MESSAGES,
  type SlotAppointmentLike,
  type SlotRejectionReason,
  type SlotTimeSlot,
} from "./slotValidation.js";

/**
 * Appointments that wait for the customer's answer keep `status: "pending"`
 * (installed apps reject unknown statuses) and carry this marker instead.
 * - `proposal`: the admin offered another slot for the customer's request.
 * - `renewal`: the admin pre-booked it when assigning a new bono.
 */
export type CustomerConfirmationKind = "proposal" | "renewal";
export type CustomerConfirmationResponse = "accepted" | "declined";

export interface CustomerConfirmation {
  kind: CustomerConfirmationKind;
  requestedAt: string;
  requestedBy: string;
  renewalId?: string;
  response?: CustomerConfirmationResponse | null;
  respondedAt?: string | null;
}

export type ProposalStatus = "pending" | "accepted" | "declined" | "superseded";

export interface AppointmentProposal {
  status: ProposalStatus;
  originalSlot: SlotTimeSlot | null;
  originalTrainer: string | null;
  proposedSlot: SlotTimeSlot;
  proposedTrainer: string | null;
  proposedBy: string;
  proposedAt: string;
  respondedAt?: string | null;
}

export interface ProposalHistoryEntry {
  event: "proposed" | "superseded" | "accepted" | "declined" | "withdrawn";
  at: string;
  by: string;
  slot?: SlotTimeSlot | null;
  trainer?: string | null;
}

interface ProposalAppointment extends SlotAppointmentLike {
  userId: string;
  status: string;
  serviceType?: string;
  duration: string;
  recurrenceSeriesId?: string;
  bonoId?: string;
  minutesDeducted?: boolean;
  minutesDeductedAmount?: number;
  minutesDeductedAt?: string | null;
  minutesRefundedAt?: string | null;
  customerConfirmation?: CustomerConfirmation | null;
  proposal?: AppointmentProposal | null;
  proposalHistory?: ProposalHistoryEntry[];
}

export interface AppointmentProposalDeps {
  db: Firestore;
  requireAdmin: (uid: string) => Promise<unknown>;
  getNowDate: () => Date;
}

type HttpsCode = "invalid-argument" | "failed-precondition" | "permission-denied" | "not-found";

function fail(code: HttpsCode, message: string, reason: string): never {
  throw new HttpsError(code, message, { reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSlot(value: unknown): value is SlotTimeSlot {
  return isRecord(value)
    && typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time);
}

function appointmentIdFrom(data: Record<string, unknown>): string {
  const id = typeof data.appointmentId === "string" ? data.appointmentId.trim() : "";
  if (!id || id.length > 256) fail("invalid-argument", "La cita indicada no es válida.", "invalid_request");
  return id;
}

/** Customer-facing copy for every reason an acceptance can fail. */
export const CONFIRMATION_REJECTION_MESSAGES: Record<SlotRejectionReason, string> = {
  ...SLOT_REJECTION_MESSAGES,
  slot_not_future: "Esta franja ya ha pasado y no se puede confirmar.",
  slot_blocked: "Esta franja se ha bloqueado y ya no está disponible. Contacta con el gimnasio para elegir otra.",
  slot_full: "Esta franja se ha completado y ya no está disponible. Contacta con el gimnasio para elegir otra.",
  appointment_conflict: "Ya tienes otra cita en esta franja.",
  trainer_unavailable: "El profesional de esta cita ya no está disponible. Contacta con el gimnasio.",
  trainer_not_nutrition: "El profesional de esta cita ya no atiende nutrición. Contacta con el gimnasio.",
  professional_conflict: "El profesional ya no está disponible en esta franja. Contacta con el gimnasio.",
};

/** The open confirmation request of an appointment, if any. */
export function openCustomerConfirmation(appointment: {
  status?: string;
  customerConfirmation?: CustomerConfirmation | null;
}): CustomerConfirmation | undefined {
  const confirmation = appointment.customerConfirmation;
  if (appointment.status !== "pending" || !confirmation || confirmation.response) return undefined;
  return confirmation;
}

/**
 * Patch that withdraws an open counter-proposal when the appointment is
 * changed by other means (customer or admin reschedule). Renewal
 * confirmations survive: the customer still has to confirm the new slot.
 */
export function withdrawOpenProposalPatch(
  appointment: {
    status?: string;
    customerConfirmation?: CustomerConfirmation | null;
    proposal?: AppointmentProposal | null;
    proposalHistory?: ProposalHistoryEntry[];
  },
  by: string,
  now: string,
  deleteField: () => unknown,
): Record<string, unknown> | undefined {
  const confirmation = openCustomerConfirmation(appointment);
  if (confirmation?.kind !== "proposal" || appointment.proposal?.status !== "pending") return undefined;
  return {
    customerConfirmation: deleteField(),
    proposal: { ...appointment.proposal, status: "superseded" satisfies ProposalStatus, respondedAt: now },
    proposalHistory: appendHistory(appointment, { event: "withdrawn", at: now, by }),
  };
}

function appendHistory(appointment: { proposalHistory?: ProposalHistoryEntry[] }, entry: ProposalHistoryEntry) {
  return [...(Array.isArray(appointment.proposalHistory) ? appointment.proposalHistory : []), entry];
}

/** Writes absolute counts (+1) for every block of an approved slot. */
function occupyApprovedSlot(
  transaction: Transaction,
  db: Firestore,
  slot: SlotTimeSlot,
  durationMinutes: number,
  occupancyByTime: Map<string, number>,
): void {
  getCanonicalSlotBlocks(slot.time, durationMinutes).forEach((time) => {
    transaction.set(
      db.collection("slot_occupancy").doc(slotOccupancyDocId(slot.date, time)),
      { date: slot.date, time, count: (occupancyByTime.get(time) ?? 0) + 1 },
      { merge: true },
    );
  });
}

/** Refunds the minutes reserved by a training appointment exactly once. */
function refundReservedMinutes(
  transaction: Transaction,
  appointmentRef: DocumentReference,
  appointment: ProposalAppointment,
  bonoSnap: { exists: boolean; id: string; ref: DocumentReference; data(): unknown } | undefined,
  now: string,
): Record<string, unknown> {
  if (!bonoSnap?.exists) return {};
  const bonoData = bonoSnap.data() as LifecycleBono & { historial?: unknown[] };
  let bonoPatch: Record<string, unknown> | undefined;
  let appointmentPatch: Record<string, unknown> = {};
  const result = reconcileAppointmentMinutes({
    action: "refund",
    appointment,
    bono: { ...bonoData, id: bonoSnap.id },
    now,
    transaction: {
      setBono: (_id, patch) => { bonoPatch = patch; },
      setAppointment: (patch) => { appointmentPatch = patch; },
    },
  });
  if (!result.ok || !bonoPatch) return {};
  transaction.set(bonoSnap.ref, {
    ...bonoPatch,
    historial: [...(Array.isArray(bonoData.historial) ? bonoData.historial : []), {
      fecha: now,
      tipo: appointment.serviceType ?? "",
      duracion: appointment.duration,
      appointmentId: appointmentRef.id,
      accion: "devolucion_cita",
    }],
  }, { merge: true });
  return appointmentPatch;
}

export function createAppointmentProposalHandlers(deps: AppointmentProposalDeps) {
  const { db, requireAdmin, getNowDate } = deps;

  async function proposeAppointmentSlotFromAdmin(request: CallableRequest): Promise<Record<string, unknown>> {
    if (!request.auth) fail("permission-denied", "Debes iniciar sesión como admin.", "unauthenticated");
    await requireAdmin(request.auth.uid);
    const adminUid = request.auth.uid;
    const data = isRecord(request.data) ? request.data : {};
    const appointmentId = appointmentIdFrom(data);
    if (!isSlot(data.slot)) fail("invalid-argument", "La franja propuesta no es válida.", "invalid_slot");
    const proposedSlot = { date: data.slot.date, time: data.slot.time };
    const requestedTrainer = typeof data.assignedTrainer === "string" && data.assignedTrainer.trim()
      ? data.assignedTrainer.trim()
      : null;

    const appointmentRef = db.collection("appointments").doc(appointmentId);
    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(appointmentRef);
      if (!snap.exists) fail("failed-precondition", "No se ha encontrado la cita indicada.", "appointment_not_found");
      const appointment = snap.data() as ProposalAppointment;
      if (appointment.status !== "pending") {
        fail("failed-precondition", "Solo se puede proponer otra hora para solicitudes pendientes.", "appointment_not_pending");
      }
      if (appointment.recurrenceSeriesId) {
        fail("failed-precondition", "Las solicitudes recurrentes se gestionan como serie.", "recurring_not_supported");
      }
      if (openCustomerConfirmation(appointment)?.kind === "renewal") {
        fail("failed-precondition", "Esta cita renovada ya está pendiente de confirmación del cliente.", "renewal_pending");
      }

      const appointmentType: AppointmentType = getAppointmentType(appointment);
      const durationMinutes = appointmentDurationOf(appointment);
      if (!durationMinutes) fail("failed-precondition", "La duración de la cita no es válida.", "invalid_duration");
      const trainerId = requestedTrainer ?? (typeof appointment.assignedTrainer === "string" ? appointment.assignedTrainer : null);
      if (appointmentType === "nutrition" && !trainerId) {
        fail("invalid-argument", "Selecciona el profesional de nutrición.", "trainer_required");
      }

      const [config, customerAppointments, trainer, trainerAppointments] = await Promise.all([
        loadSiteConfig(transaction, db),
        loadCustomerActiveAppointments(transaction, db, appointment.userId),
        trainerId ? loadTrainer(transaction, db, trainerId) : Promise.resolve(undefined),
        trainerId && appointmentType === "nutrition"
          ? loadTrainerActiveAppointments(transaction, db, trainerId)
          : Promise.resolve([]),
      ]);
      const day = await loadSlotDay(transaction, db, config, proposedSlot.date);
      const rejection = evaluateSlot(day, {
        slot: proposedSlot,
        durationMinutes,
        appointmentType,
        now: getNowDate(),
        customerAppointments,
        excludeAppointmentIds: [appointmentId],
        trainer,
        trainerAppointments,
      });
      if (rejection) fail("failed-precondition", SLOT_REJECTION_MESSAGES[rejection], rejection);

      const now = getNowDate().toISOString();
      const original = getAppointmentEffectiveSlot(appointment) ?? null;
      let history = Array.isArray(appointment.proposalHistory) ? appointment.proposalHistory : [];
      if (appointment.proposal?.status === "pending") {
        history = [...history, { event: "superseded", at: now, by: adminUid, slot: appointment.proposal.proposedSlot }];
      }
      const proposal: AppointmentProposal = {
        status: "pending",
        originalSlot: original,
        originalTrainer: typeof appointment.assignedTrainer === "string" ? appointment.assignedTrainer : null,
        proposedSlot,
        proposedTrainer: trainerId,
        proposedBy: adminUid,
        proposedAt: now,
        respondedAt: null,
      };
      const confirmation: CustomerConfirmation = {
        kind: "proposal",
        requestedAt: now,
        requestedBy: adminUid,
        response: null,
        respondedAt: null,
      };
      transaction.set(appointmentRef, {
        proposal,
        customerConfirmation: confirmation,
        proposalHistory: [...history, { event: "proposed", at: now, by: adminUid, slot: proposedSlot, trainer: trainerId }],
        updatedAt: now,
      }, { merge: true });
      transaction.create(db.collection("activity_logs").doc(), {
        action: "appointment_slot_proposed_by_admin",
        adminUid,
        appointmentId,
        targetUid: appointment.userId,
        originalSlot: original,
        proposedSlot,
        proposedTrainer: trainerId,
        createdAt: now,
        timestamp: now,
      });
      return { success: true, appointmentId, proposedAt: now };
    });
  }

  async function respondToAppointmentConfirmation(request: CallableRequest): Promise<Record<string, unknown>> {
    if (!request.auth) fail("permission-denied", "Debes iniciar sesión para responder.", "unauthenticated");
    if (request.auth.token?.email_verified !== true) {
      fail("permission-denied", "Debes verificar tu correo antes de gestionar tus citas.", "email_not_verified");
    }
    const uid = request.auth.uid;
    const data = isRecord(request.data) ? request.data : {};
    const appointmentId = appointmentIdFrom(data);
    const action = data.action;
    if (action !== "accept" && action !== "decline") {
      fail("invalid-argument", "La respuesta no es válida.", "invalid_action");
    }
    const response: CustomerConfirmationResponse = action === "accept" ? "accepted" : "declined";
    const appointmentRef = db.collection("appointments").doc(appointmentId);

    return db.runTransaction(async (transaction) => {
      const snap = await transaction.get(appointmentRef);
      if (!snap.exists) fail("failed-precondition", "No se ha encontrado la cita indicada.", "appointment_not_found");
      const appointment = snap.data() as ProposalAppointment;
      if (appointment.userId !== uid) {
        fail("permission-denied", "No puedes responder por la cita de otro usuario.", "not_owner");
      }

      const confirmation = appointment.customerConfirmation;
      if (!confirmation) {
        fail("failed-precondition", "Esta cita no está pendiente de tu confirmación.", "no_confirmation_pending");
      }
      // Idempotent: repeating the same answer is a no-op, a different one is refused.
      if (confirmation.response) {
        if (confirmation.response === response) {
          return { success: true, appointmentId, alreadyApplied: true, status: appointment.status };
        }
        fail("failed-precondition", "Ya has respondido a esta cita.", "already_responded");
      }
      if (appointment.status !== "pending") {
        fail("failed-precondition", "Esta cita ya no está pendiente de confirmación.", "appointment_not_pending");
      }
      if (confirmation.kind === "proposal" && appointment.proposal?.status !== "pending") {
        fail("failed-precondition", "Esta propuesta ya no está vigente.", "proposal_not_pending");
      }

      const now = getNowDate().toISOString();
      const respondedConfirmation = { ...confirmation, response, respondedAt: now };
      const isProposal = confirmation.kind === "proposal";

      if (response === "declined") {
        const isTraining = getAppointmentType(appointment) === "training";
        const bonoSnap = isTraining && appointment.bonoId
          ? await transaction.get(db.collection("bonos").doc(appointment.bonoId))
          : undefined;
        const refundPatch = refundReservedMinutes(transaction, appointmentRef, appointment, bonoSnap, now);
        transaction.set(appointmentRef, {
          ...refundPatch,
          status: isProposal ? "rejected" : "cancelled",
          cancelledBy: "customer",
          cancelledAt: now,
          cancellationReason: isProposal ? "customer_declined_proposal" : "customer_declined_renewal",
          customerConfirmation: respondedConfirmation,
          ...(isProposal && appointment.proposal
            ? {
              proposal: { ...appointment.proposal, status: "declined", respondedAt: now },
              proposalHistory: appendHistory(appointment, { event: "declined", at: now, by: uid }),
            }
            : {}),
          updatedAt: now,
        }, { merge: true });
        return { success: true, appointmentId, status: isProposal ? "rejected" : "cancelled" };
      }

      // Accept: re-validate the slot inside the transaction; nothing changes if it is gone.
      const slot = isProposal ? appointment.proposal?.proposedSlot : getAppointmentEffectiveSlot(appointment);
      if (!slot || !isSlot(slot)) {
        fail("failed-precondition", "La cita no tiene una franja válida.", "invalid_slot");
      }
      const trainerId = isProposal
        ? appointment.proposal?.proposedTrainer ?? null
        : (typeof appointment.assignedTrainer === "string" ? appointment.assignedTrainer : null);
      const appointmentType = getAppointmentType(appointment);
      const durationMinutes = appointmentDurationOf(appointment);
      if (!durationMinutes) fail("failed-precondition", "La duración de la cita no es válida.", "invalid_duration");

      const [config, customerAppointments, trainer, trainerAppointments] = await Promise.all([
        loadSiteConfig(transaction, db),
        loadCustomerActiveAppointments(transaction, db, uid),
        trainerId ? loadTrainer(transaction, db, trainerId) : Promise.resolve(undefined),
        trainerId && appointmentType === "nutrition"
          ? loadTrainerActiveAppointments(transaction, db, trainerId)
          : Promise.resolve([]),
      ]);
      const day = await loadSlotDay(transaction, db, config, slot.date);
      const rejection = evaluateSlot(day, {
        slot,
        durationMinutes,
        appointmentType,
        now: getNowDate(),
        customerAppointments,
        excludeAppointmentIds: [appointmentId],
        trainer,
        trainerAppointments,
      });
      if (rejection) fail("failed-precondition", CONFIRMATION_REJECTION_MESSAGES[rejection], rejection);

      occupyApprovedSlot(transaction, db, slot, durationMinutes, day.occupancyByTime);
      transaction.set(appointmentRef, {
        status: "approved",
        approvedSlot: slot,
        date: slot.date,
        time: slot.time,
        ...(trainerId ? { assignedTrainer: trainerId } : {}),
        approvedAt: now,
        approvedBy: "customer_confirmation",
        customerConfirmation: respondedConfirmation,
        ...(isProposal && appointment.proposal
          ? {
            proposal: { ...appointment.proposal, status: "accepted", respondedAt: now },
            proposalHistory: appendHistory(appointment, { event: "accepted", at: now, by: uid, slot, trainer: trainerId }),
          }
          : {}),
        updatedAt: now,
      }, { merge: true });
      return { success: true, appointmentId, status: "approved", slot };
    });
  }

  return { proposeAppointmentSlotFromAdmin, respondToAppointmentConfirmation };
}
