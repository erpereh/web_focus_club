import {
  type EffectiveAppointmentSlot,
  getAppointmentEffectiveSlot,
  getMadridDateKey,
  madridCivilSlotToInstant,
} from "../appointmentLifecycle.js";
import type { NotifiableAppointment } from "./appointmentEvents.js";
import { bonoCivilDate, bonoExpiryInstant, bonoRemainingMinutes, type NotifiableBono } from "./bonoEvents.js";

export const REMINDER_MIN_LEAD_MS = 2 * 60 * 60 * 1000;
export const REMINDER_MAX_LEAD_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdentifiedDoc<T> {
  id: string;
  data: T;
}

export interface BonoExpiryWarning {
  bonoId: string;
  event: "bono_expiring_7d" | "bono_expiring_2d";
  expiryDate: string;
  dedupeKey: string;
}

export interface AppointmentReminder {
  appointmentId: string;
  uid: string;
  slot: EffectiveAppointmentSlot;
}

function civilDayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Whole civil days between today and `dateKey`, both in Europe/Madrid. */
export function madridDaysUntil(dateKey: string, now: Date): number {
  return civilDayNumber(dateKey) - civilDayNumber(getMadridDateKey(now));
}

export function addMadridDays(now: Date, days: number): string {
  const today = civilDayNumber(getMadridDateKey(now));
  return new Date((today + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Active bonos with minutes left whose expiry civil date (Europe/Madrid) is
 * exactly 7 or 2 days away. The dedupe key includes the expiry date, so
 * changing a bono's validity re-arms the warnings.
 */
export function planBonoExpiryWarnings(bonos: IdentifiedDoc<NotifiableBono>[], now: Date): BonoExpiryWarning[] {
  const warnings: BonoExpiryWarning[] = [];
  for (const { id, data } of bonos) {
    if (data.estado !== "activo" || bonoRemainingMinutes(data) <= 0) continue;
    const expiryDate = bonoCivilDate(data.fechaExpiracion);
    const expiresAt = bonoExpiryInstant(data.fechaExpiracion);
    if (!expiryDate || !expiresAt || expiresAt.getTime() <= now.getTime()) continue;
    const days = madridDaysUntil(expiryDate, now);
    const event = days === 7 ? "bono_expiring_7d" : days === 2 ? "bono_expiring_2d" : undefined;
    if (!event) continue;
    warnings.push({ bonoId: id, event, expiryDate, dedupeKey: `bono:${id}:${event}:${expiryDate}` });
  }
  return warnings;
}

/** Bonos still usable whose expiry instant has passed. */
export function planOverdueBonos(bonos: IdentifiedDoc<NotifiableBono>[], now: Date): string[] {
  return bonos
    .filter(({ data }) => {
      if (data.estado !== "activo" && data.estado !== "agotado") return false;
      const expiresAt = bonoExpiryInstant(data.fechaExpiracion);
      return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
    })
    .map(({ id }) => id);
}

/**
 * Approved appointments starting within (now + 2 h, now + 24 h]. The window
 * lets a late scheduler run still remind; the dedupe key (appointment + slot)
 * makes each reminder fire once and re-arms it if the session is moved.
 */
export function planAppointmentReminders(
  appointments: IdentifiedDoc<NotifiableAppointment>[],
  now: Date,
): AppointmentReminder[] {
  const reminders: AppointmentReminder[] = [];
  const seen = new Set<string>();
  for (const { id, data } of appointments) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (data.status !== "approved" || !data.userId) continue;
    const slot = getAppointmentEffectiveSlot(data);
    const start = slot ? madridCivilSlotToInstant(slot) : undefined;
    if (!slot || !start) continue;
    const lead = start.getTime() - now.getTime();
    if (lead <= REMINDER_MIN_LEAD_MS || lead > REMINDER_MAX_LEAD_MS) continue;
    reminders.push({ appointmentId: id, uid: data.userId, slot });
  }
  return reminders;
}
