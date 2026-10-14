import type { Appointment, SiteConfig } from '@/types';
import { doesSessionFitWithinSchedule, getCanonicalSlotBlocks, slotOccupancyKey } from '@/lib/appointment-slots';

/**
 * Availability shown in the admin "Nueva cita" grid. It reads the same
 * `slot_occupancy` counters, in the same order, as `evaluateSlot` in
 * `createAppointmentFromAdmin`, so the grid can never show free seats the
 * server will refuse with `slot_full`. In-memory approved appointments are
 * only used to flag counters that drifted, never to decide availability.
 */

export type AdminSlotTone = 'muted' | 'blocked' | 'full' | 'partial' | 'free' | 'duplicate' | 'invalid';

export interface AdminSlotStatus {
    disabled: boolean;
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
    /** `slot_occupancy` counts keyed `date_time`; null while loading or on error. */
    occupancy: Record<string, unknown> | null;
    blockedSlotKeys: Set<string>;
    appointments: Appointment[];
    userId?: string;
}

function parseCount(raw: unknown): number | undefined {
    if (raw === undefined) return 0;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/** approvedSlot → preferredSlots[0] → legacy date/time, as the server resolves it. */
export function appointmentEffectiveSlot(appointment: Appointment): { date: string; time: string } | undefined {
    const legacy = appointment.date && appointment.time ? { date: appointment.date, time: appointment.time } : undefined;
    const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0] ?? legacy;
    return slot?.date && slot.time ? { date: slot.date, time: slot.time } : undefined;
}

function appointmentKeys(appointment: Appointment): string[] {
    const slot = appointmentEffectiveSlot(appointment);
    const duration = Number.parseInt(String(appointment.duration), 10);
    if (!slot || ![30, 45, 60].includes(duration)) return [];
    return getCanonicalSlotBlocks(slot.time, duration).map((time) => slotOccupancyKey(slot.date, time));
}

export function getAdminCreateSlotStatus(input: AdminSlotStatusInput): AdminSlotStatus {
    if (!input.date) return { disabled: true, label: 'Elige fecha', tone: 'muted', occupancy: 0 };
    if (!doesSessionFitWithinSchedule(input.siteConfig, input.time, input.durationMinutes)) {
        return { disabled: true, label: 'Fuera de horario', tone: 'muted', occupancy: 0 };
    }
    if (!input.occupancy) return { disabled: true, label: 'Cargando…', tone: 'muted', occupancy: 0 };

    const keys = getCanonicalSlotBlocks(input.time, input.durationMinutes).map((time) => slotOccupancyKey(input.date, time));
    if (keys.some((key) => input.blockedSlotKeys.has(key))) {
        return { disabled: true, label: 'Bloqueado', tone: 'blocked', occupancy: 0 };
    }

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

    const maxCapacity = input.siteConfig.maxCapacity;
    if (occupancy >= maxCapacity) return withMismatch({ disabled: true, label: 'Lleno', tone: 'full', occupancy });

    if (input.userId) {
        const target = new Set(keys);
        const duplicated = input.appointments
            .filter((appointment) => appointment.userId === input.userId && ['pending', 'approved'].includes(appointment.status))
            .some((appointment) => appointmentKeys(appointment).some((key) => target.has(key)));
        if (duplicated) return withMismatch({ disabled: true, label: 'Duplicado', tone: 'duplicate', occupancy });
    }

    if (occupancy > 0) {
        return withMismatch({ disabled: false, label: `${occupancy}/${maxCapacity}`, tone: 'partial', occupancy });
    }
    return withMismatch({ disabled: false, label: 'Libre', tone: 'free', occupancy });
}
