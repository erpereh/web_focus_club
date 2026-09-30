import {
  getBonoRemainingMinutes,
  getMadridDateKey,
  type LifecycleBono,
  madridCivilSlotToInstant,
} from "../appointmentLifecycle.js";
import type { BonoNotificationEvent } from "./types.js";

export interface NotifiableBono {
  userId?: string;
  estado?: string;
  tamano?: number;
  minutosTotales?: number;
  minutosRestantes?: number;
  sesionesTotales?: number;
  sesionesRestantes?: number;
  modalidad?: string;
  fechaAsignacion?: string;
  fechaExpiracion?: string;
}

export interface BonoChange {
  event: Extract<BonoNotificationEvent, "bono_assigned" | "bono_renewed" | "bono_exhausted" | "bono_expired" | "bono_validity_changed">;
  bono: NotifiableBono;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Civil date (YYYY-MM-DD) in Europe/Madrid of a stored bono date. */
export function bonoCivilDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (DATE_ONLY_RE.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : getMadridDateKey(date);
}

/**
 * Instant after which a bono is expired. Full ISO timestamps are used as-is;
 * date-only values expire at the end of that day in Europe/Madrid.
 */
export function bonoExpiryInstant(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (DATE_ONLY_RE.test(value)) {
    const lastMinute = madridCivilSlotToInstant({ date: value, time: "23:59" });
    return lastMinute ? new Date(lastMinute.getTime() + 59_999) : undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function bonoRemainingMinutes(bono: NotifiableBono): number {
  return getBonoRemainingMinutes({ id: "", estado: "activo", ...bono } as LifecycleBono);
}

const USABLE_STATES = new Set(["activo", "agotado"]);

/**
 * Maps a bono write to the customer notice it deserves, or `null`.
 * "Exhausted" means no minutes left for new bookings (minutes are reserved at
 * booking time), so it fires only when remaining minutes drop to 0 — replacing
 * a bono on renewal (estado → agotado with minutes left) is not an exhaustion.
 */
export function classifyBonoChange(
  before: NotifiableBono | undefined,
  after: NotifiableBono | undefined,
  { hadPreviousBono }: { hadPreviousBono: boolean },
): BonoChange | null {
  if (!after) return null;

  if (!before) {
    if (after.estado !== "activo") return null;
    return { event: hadPreviousBono ? "bono_renewed" : "bono_assigned", bono: after };
  }

  if (after.estado === "eliminado" || before.estado === "eliminado") return null;

  if (after.estado === "expirado" && before.estado !== "expirado") {
    return { event: "bono_expired", bono: after };
  }
  if (after.estado === "expirado") return null;

  if (bonoRemainingMinutes(before) > 0 && bonoRemainingMinutes(after) === 0) {
    return { event: "bono_exhausted", bono: after };
  }

  const datesChanged = bonoCivilDate(before.fechaAsignacion) !== bonoCivilDate(after.fechaAsignacion)
    || bonoCivilDate(before.fechaExpiracion) !== bonoCivilDate(after.fechaExpiracion);
  if (datesChanged && USABLE_STATES.has(after.estado ?? "")) {
    return { event: "bono_validity_changed", bono: after };
  }
  return null;
}
