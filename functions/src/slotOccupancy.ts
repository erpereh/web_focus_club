import {
  type AppointmentEffectiveDateSource,
  getAppointmentEffectiveSlot,
  getCanonicalSlotBlocks,
  slotOccupancyDocId,
} from "./appointmentLifecycle.js";

/**
 * Single source of truth for `slot_occupancy` bookkeeping. Every server path
 * that adds or releases capacity resolves keys and writes counts through
 * these helpers so documents always keep the `{date, time, count:int}` shape
 * the web and the published mobile apps read.
 */

export const SUPPORTED_SESSION_MINUTES = [30, 45, 60] as const;

export interface OccupancyAppointmentLike extends AppointmentEffectiveDateSource {
  duration?: string | number;
}

export interface OccupancyWrite {
  key: string;
  date: string;
  time: string;
  count: number;
}

export function sessionMinutesOf(appointment: { duration?: string | number }): number {
  const minutes = Number.parseInt(String(appointment.duration ?? ""), 10);
  return (SUPPORTED_SESSION_MINUTES as readonly number[]).includes(minutes) ? minutes : 0;
}

export function occupancyKeysForSlot(slot: { date: string; time: string }, durationMinutes: number): string[] {
  return getCanonicalSlotBlocks(slot.time, durationMinutes).map((time) => slotOccupancyDocId(slot.date, time));
}

/**
 * Occupancy keys an appointment covers, from its effective slot
 * (approvedSlot → preferredSlots[0] → legacy date/time) and a supported duration.
 */
export function appointmentOccupancyKeys(appointment: OccupancyAppointmentLike): string[] {
  const slot = getAppointmentEffectiveSlot(appointment);
  const duration = sessionMinutesOf(appointment);
  return slot && duration ? occupancyKeysForSlot(slot, duration) : [];
}

/** A stored count is valid only when it is a non-negative integer. */
export function parseOccupancyCount(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

export function splitOccupancyKey(key: string): { date: string; time: string } {
  const separator = key.lastIndexOf("_");
  return { date: key.slice(0, separator), time: key.slice(separator + 1) };
}

export class InvalidOccupancyError extends Error {
  constructor(readonly key: string, readonly raw: unknown) {
    super(`Ocupación inválida en ${key}`);
  }
}

/**
 * Absolute writes for `deltaByKey` given the counts read in the same
 * transaction. Missing documents count as 0. Adding capacity on top of a
 * corrupt counter is refused (it must be detected, never read as free);
 * releases never block a cancellation: they clamp at 0 and report it.
 */
export function planOccupancyWrites(
  deltaByKey: Map<string, number>,
  rawByKey: Map<string, unknown>,
): { writes: OccupancyWrite[]; clamped: string[] } {
  const writes: OccupancyWrite[] = [];
  const clamped: string[] = [];
  for (const key of [...deltaByKey.keys()].sort()) {
    const delta = deltaByKey.get(key) ?? 0;
    if (delta === 0) continue;
    const raw = rawByKey.get(key);
    const current = raw === undefined ? 0 : parseOccupancyCount(raw);
    if (current === undefined && delta > 0) throw new InvalidOccupancyError(key, raw);
    const base = current ?? 0;
    const next = base + delta;
    if (next < 0 || current === undefined) clamped.push(key);
    const { date, time } = splitOccupancyKey(key);
    writes.push({ key, date, time, count: Math.max(0, next) });
  }
  return { writes, clamped };
}

/** Adds `delta` (+1 / -1) for every key into an accumulating map. */
export function addOccupancyDelta(target: Map<string, number>, keys: Iterable<string>, delta: number): void {
  for (const key of keys) target.set(key, (target.get(key) ?? 0) + delta);
}
