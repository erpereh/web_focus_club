import type { Firestore } from "firebase-admin/firestore";
import {
  type AppointmentSlotLike,
  getAppointmentEffectiveSlot,
  getCanonicalSlotBlocks,
  isRescheduleCapacityAvailable,
  madridCivilSlotToInstant,
} from "./appointmentLifecycle.js";
import { doesSessionFitWithinSchedule, generateTimeSlots, normalizeSiteConfig, type SiteConfig } from "./siteConfig.js";

/**
 * Appointment kinds. Documents written before nutrition existed have no
 * `appointmentType` and are always training.
 */
export type AppointmentType = "training" | "nutrition";

/** Every nutrition consultation lasts exactly 30 minutes. */
export const NUTRITION_DURATION_MINUTES = 30;

export function getAppointmentType(appointment: { appointmentType?: unknown } | undefined | null): AppointmentType {
  return appointment?.appointmentType === "nutrition" ? "nutrition" : "training";
}

/** Request payload value → type. Missing means training; anything else unknown is rejected. */
export function parseAppointmentTypeInput(value: unknown): AppointmentType | undefined {
  if (value === undefined || value === null || value === "" || value === "training") return "training";
  if (value === "nutrition") return "nutrition";
  return undefined;
}

export interface SlotTimeSlot {
  date: string;
  time: string;
}

/**
 * Reasons a slot can be refused. The first five values are the codes the
 * customer app already maps to Spanish copy; never rename them.
 */
export type SlotRejectionReason =
  | "slot_not_future"
  | "outside_schedule"
  | "slot_blocked"
  | "slot_full"
  | "appointment_conflict"
  | "trainer_unavailable"
  | "trainer_not_nutrition"
  | "professional_conflict";

export const SLOT_REJECTION_MESSAGES: Record<SlotRejectionReason, string> = {
  slot_not_future: "La franja seleccionada ya no está disponible.",
  outside_schedule: "La franja seleccionada no es válida para el horario configurado.",
  slot_blocked: "La franja seleccionada está bloqueada.",
  slot_full: "La franja seleccionada está llena.",
  appointment_conflict: "El cliente ya tiene una cita en esta franja.",
  trainer_unavailable: "El profesional seleccionado no existe o no está activo.",
  trainer_not_nutrition: "El profesional seleccionado no atiende consultas de nutrición.",
  professional_conflict: "El profesional ya tiene otra cita en esta franja.",
};

export interface SlotAppointmentLike {
  status?: string;
  duration?: string | number;
  approvedSlot?: AppointmentSlotLike | null;
  preferredSlots?: AppointmentSlotLike[];
  date?: string;
  time?: string;
  assignedTrainer?: string | null;
  appointmentType?: unknown;
}

export interface IdentifiedAppointment {
  id: string;
  data: SlotAppointmentLike;
}

export interface TrainerSnapshot {
  id: string;
  exists: boolean;
  active?: boolean;
  offersNutrition?: boolean;
}

/** Everything a slot decision depends on for one civil day. */
export interface SlotDayContext {
  config: SiteConfig;
  blockedTimes: Set<string>;
  occupancyByTime: Map<string, number>;
}

export interface SlotCheckInput {
  slot: SlotTimeSlot;
  durationMinutes: number;
  appointmentType: AppointmentType;
  now: Date;
  /** Customer pending/approved appointments (any day). */
  customerAppointments: IdentifiedAppointment[];
  /** Appointments ignored for conflicts (the one being moved/confirmed). */
  excludeAppointmentIds?: Iterable<string>;
  /**
   * Occupancy keys (`date_time`) already counted for the appointment being
   * moved, so it does not compete with itself for capacity.
   */
  ownApprovedOccupancyKeys?: Set<string>;
  /** Slots the same operation is about to give the customer (renewal batch). */
  plannedCustomerSlots?: Array<{ slot: SlotTimeSlot; durationMinutes: number }>;
  /** Optional professional. Existence/activeness is always checked when given. */
  trainer?: TrainerSnapshot;
  /** Pending/approved appointments of `trainer`; required for nutrition overlap checks. */
  trainerAppointments?: IdentifiedAppointment[];
}

export function appointmentDurationOf(appointment: SlotAppointmentLike): number {
  const minutes = Number.parseInt(String(appointment.duration ?? ""), 10);
  return [30, 45, 60].includes(minutes) ? minutes : 0;
}

export function slotRangeKeys(slot: SlotTimeSlot, durationMinutes: number): Set<string> {
  return new Set(getCanonicalSlotBlocks(slot.time, durationMinutes).map((time) => `${slot.date}_${time}`));
}

/** Occupancy-block keys an appointment covers, from its effective slot. */
export function appointmentRangeKeys(appointment: SlotAppointmentLike): Set<string> {
  const slot = getAppointmentEffectiveSlot(appointment);
  const duration = appointmentDurationOf(appointment);
  return slot && duration ? slotRangeKeys(slot, duration) : new Set<string>();
}

export function rangesOverlap(target: Set<string>, other: Set<string>): boolean {
  for (const key of other) {
    if (target.has(key)) return true;
  }
  return false;
}

const ACTIVE_STATUSES = new Set(["pending", "approved"]);

/**
 * Pure availability decision shared by every booking path. Order matters:
 * it mirrors the historical checks so callers keep their messages.
 */
export function evaluateSlot(day: SlotDayContext, input: SlotCheckInput): SlotRejectionReason | undefined {
  const start = madridCivilSlotToInstant(input.slot);
  if (!start || start.getTime() <= input.now.getTime()) return "slot_not_future";

  const { config } = day;
  if (!new Set(generateTimeSlots(config)).has(input.slot.time)
    || !doesSessionFitWithinSchedule(config, input.slot.time, input.durationMinutes)) {
    return "outside_schedule";
  }

  const blocks = getCanonicalSlotBlocks(input.slot.time, input.durationMinutes);
  if (blocks.some((time) => day.blockedTimes.has(time))) return "slot_blocked";

  const ownKeys = input.ownApprovedOccupancyKeys ?? new Set<string>();
  if (blocks.some((time) => !isRescheduleCapacityAvailable(
    day.occupancyByTime.get(time) ?? 0,
    ownKeys.has(`${input.slot.date}_${time}`),
    config.maxCapacity,
  ))) {
    return "slot_full";
  }

  const target = slotRangeKeys(input.slot, input.durationMinutes);
  const excluded = new Set(input.excludeAppointmentIds ?? []);
  const customerConflict = input.customerAppointments.some(({ id, data }) => !excluded.has(id)
    && ACTIVE_STATUSES.has(data.status ?? "")
    && rangesOverlap(target, appointmentRangeKeys(data)));
  const plannedConflict = (input.plannedCustomerSlots ?? [])
    .some((planned) => rangesOverlap(target, slotRangeKeys(planned.slot, planned.durationMinutes)));
  if (customerConflict || plannedConflict) return "appointment_conflict";

  if (input.trainer) {
    if (!input.trainer.exists || input.trainer.active === false) return "trainer_unavailable";
    if (input.appointmentType === "nutrition") {
      if (input.trainer.offersNutrition !== true) return "trainer_not_nutrition";
      const busy = (input.trainerAppointments ?? []).some(({ id, data }) => !excluded.has(id)
        && ACTIVE_STATUSES.has(data.status ?? "")
        && data.assignedTrainer === input.trainer?.id
        && rangesOverlap(target, appointmentRangeKeys(data)));
      if (busy) return "professional_conflict";
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ loading

/** Anything that can read a ref/query: a Firestore transaction or a plain reader. */
export interface SnapshotReader {
  get(target: unknown): Promise<unknown>;
}

interface DocSnap {
  id: string;
  exists: boolean;
  data(): unknown;
}

interface QuerySnap {
  docs: DocSnap[];
}

/** Reads outside a transaction (previews). */
export const directReader: SnapshotReader = {
  get: (target) => (target as { get(): Promise<unknown> }).get(),
};

export async function loadSiteConfig(reader: SnapshotReader, db: Firestore): Promise<SiteConfig> {
  const snap = await reader.get(db.collection("site_config").doc("main")) as DocSnap;
  return snap.exists ? normalizeSiteConfig(snap.data() as Partial<SiteConfig>) : normalizeSiteConfig();
}

export async function loadSlotDay(
  reader: SnapshotReader,
  db: Firestore,
  config: SiteConfig,
  date: string,
): Promise<SlotDayContext> {
  const [blockedSnap, occupancySnap] = await Promise.all([
    reader.get(db.collection("blocked_slots").where("date", "==", date)) as Promise<QuerySnap>,
    reader.get(db.collection("slot_occupancy").where("date", "==", date)) as Promise<QuerySnap>,
  ]);
  const blockedTimes = new Set<string>();
  blockedSnap.docs.forEach((docSnap) => {
    const time = (docSnap.data() as { time?: unknown }).time;
    if (typeof time === "string") blockedTimes.add(time);
  });
  const occupancyByTime = new Map<string, number>();
  occupancySnap.docs.forEach((docSnap) => {
    const occupancy = docSnap.data() as { time?: unknown; count?: unknown };
    if (typeof occupancy.time === "string") {
      occupancyByTime.set(occupancy.time, typeof occupancy.count === "number" ? occupancy.count : 0);
    }
  });
  return { config, blockedTimes, occupancyByTime };
}

export async function loadCustomerActiveAppointments(
  reader: SnapshotReader,
  db: Firestore,
  userId: string,
): Promise<IdentifiedAppointment[]> {
  const snap = await reader.get(db.collection("appointments")
    .where("userId", "==", userId)
    .where("status", "in", ["pending", "approved"])) as QuerySnap;
  return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as SlotAppointmentLike }));
}

export async function loadTrainer(
  reader: SnapshotReader,
  db: Firestore,
  trainerId: string,
): Promise<TrainerSnapshot> {
  const snap = await reader.get(db.collection("trainers").doc(trainerId)) as DocSnap;
  const data = snap.exists ? snap.data() as { active?: unknown; offersNutrition?: unknown } : {};
  return {
    id: trainerId,
    exists: snap.exists,
    active: data.active === false ? false : true,
    offersNutrition: data.offersNutrition === true,
  };
}

export async function loadTrainerActiveAppointments(
  reader: SnapshotReader,
  db: Firestore,
  trainerId: string,
): Promise<IdentifiedAppointment[]> {
  const snap = await reader.get(db.collection("appointments")
    .where("assignedTrainer", "==", trainerId)
    .where("status", "in", ["pending", "approved"])) as QuerySnap;
  return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as SlotAppointmentLike }));
}
