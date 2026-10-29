import type { Appointment, SiteConfig } from '@/types';
import { resolveMaxCapacity, type CapacityByDate } from '@/lib/capacity-exceptions';
import { doesSessionFitWithinSchedule, getCanonicalSlotBlocks, slotOccupancyKey } from '@/lib/appointment-slots';
import { classifyMadridCivilSlot, getAppointmentEffectiveSlot } from '@/lib/madrid-date';

/**
 * Availability shown in the admin "Nueva cita" grid. It reads the same
 * `slot_occupancy` counters, in the same order, as `evaluateSlot` in
 * `createAppointmentFromAdmin`, so the grid can never show free seats the
 * server will refuse with `slot_full`. In-memory approved appointments are
 * only used to flag counters that drifted, never to decide availability.
 *
 * Restrictions an admin may knowingly override (past, outside schedule,
 * blocked, full) stay selectable but are flagged `restricted`; the server
 * then asks for an explicit confirmation. Duplicates and corrupt counters
 * remain disabled.
 */

export type AdminSlotTone = 'muted' | 'blocked' | 'full' | 'partial' | 'free' | 'duplicate' | 'invalid';

export interface AdminSlotStatus {
    disabled: boolean;
    /** Selectable only through an explicit admin confirmation. */
    restricted?: boolean;
    label: string;
    tone: AdminSlotTone;
    occupancy: number;
    /** Registered counter vs approved appointments, when they disagree. */
    mismatch?: { registered: number; approved: number };
}

export interface AdminSlotStatusInput {
    date: string;
    time: string;
    durationMinutes: number;
    siteConfig: SiteConfig;
    /** Capacity exceptions (aforo por fecha); dates without one use siteConfig.maxCapacity. */
    capacityByDate?: CapacityByDate;
    /** `slot_occupancy` counts keyed `date_time`; null while loading or on error. */
    occupancy: Record<string, unknown> | null;
    blockedSlotKeys: Set<string>;
    appointments: Appointment[];
    userId?: string;
    /** Flags slots that already started. */
    now?: Date;
    /** Past slots are selectable (restricted) only after the admin enabled past dates. */
    pastAllowed?: boolean;
}

function parseCount(raw: unknown): number | undefined {
    if (raw === undefined) return 0;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/** Effective slot with the server/app rule (status-aware, see getAppointmentEffectiveSlot). */
export function appointmentEffectiveSlot(appointment: Appointment): { date: string; time: string } | undefined {
    return getAppointmentEffectiveSlot(appointment);
}

function appointmentKeys(appointment: Appointment): string[] {
    const slot = appointmentEffectiveSlot(appointment);
    const duration = Number.parseInt(String(appointment.duration), 10);
    if (!slot || ![30, 45, 60].includes(duration)) return [];
    return getCanonicalSlotBlocks(slot.time, duration).map((time) => slotOccupancyKey(slot.date, time));
}

export function getAdminCreateSlotStatus(input: AdminSlotStatusInput): AdminSlotStatus {
    if (!input.date) return { disabled: true, label: 'Elige fecha', tone: 'muted', occupancy: 0 };
    const status = getBaseStatus(input);
    if (!status.disabled && input.now && classifyMadridCivilSlot({ date: input.date, time: input.time }, input.now).isPast) {
        return input.pastAllowed
            ? { ...status, restricted: true, label: `Pasada · ${status.label}` }
            : { ...status, disabled: true, restricted: false, label: 'Pasada' };
    }
    return status;
}

function getBaseStatus(input: AdminSlotStatusInput): AdminSlotStatus {
    if (!input.occupancy) return { disabled: true, label: 'Cargando…', tone: 'muted', occupancy: 0 };

    const keys = getCanonicalSlotBlocks(input.time, input.durationMinutes).map((time) => slotOccupancyKey(input.date, time));
    const outsideSchedule = !doesSessionFitWithinSchedule(input.siteConfig, input.time, input.durationMinutes);

    const counts = keys.map((key) => parseCount(input.occupancy?.[key]));
    if (counts.some((count) => count === undefined)) {
        // A corrupt counter is reported, never read as free capacity.
        return { disabled: true, label: 'Contador inválido', tone: 'invalid', occupancy: 0 };
    }
    const occupancy = Math.max(0, ...(counts as number[]));

    const approvedByKey = new Map<string, number>();
    input.appointments
        .filter((appointment) => appointment.status === 'approved')
        .forEach((appointment) => appointmentKeys(appointment).forEach((key) => {
            approvedByKey.set(key, (approvedByKey.get(key) ?? 0) + 1);
        }));
    const mismatchIndex = keys.findIndex((key, index) => (approvedByKey.get(key) ?? 0) !== counts[index]);
    const mismatch = mismatchIndex >= 0
        ? { registered: counts[mismatchIndex] as number, approved: approvedByKey.get(keys[mismatchIndex]) ?? 0 }
        : undefined;
    const withMismatch = (status: AdminSlotStatus): AdminSlotStatus => (mismatch ? { ...status, mismatch } : status);

    const maxCapacity = resolveMaxCapacity(input.siteConfig, input.capacityByDate, input.date);
    if (input.userId) {
        const target = new Set(keys);
        const duplicated = input.appointments
            .filter((appointment) => appointment.userId === input.userId && ['pending', 'approved'].includes(appointment.status))
            .some((appointment) => appointmentKeys(appointment).some((key) => target.has(key)));
        if (duplicated) return withMismatch({ disabled: true, label: 'Duplicado', tone: 'duplicate', occupancy });
    }

    if (keys.some((key) => input.blockedSlotKeys.has(key))) {
        return withMismatch({ disabled: false, restricted: true, label: 'Bloqueado', tone: 'blocked', occupancy });
    }
    if (outsideSchedule) {
        return withMismatch({ disabled: false, restricted: true, label: 'Fuera de horario', tone: 'muted', occupancy });
    }
    if (occupancy >= maxCapacity) {
        return withMismatch({ disabled: false, restricted: true, label: `Lleno ${occupancy}/${maxCapacity}`, tone: 'full', occupancy });
    }

    if (occupancy > 0) {
        return withMismatch({ disabled: false, label: `${occupancy}/${maxCapacity}`, tone: 'partial', occupancy });
    }
    return withMismatch({ disabled: false, label: 'Libre', tone: 'free', occupancy });
}
