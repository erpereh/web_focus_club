import type { SiteConfig } from '@/types';
import { normalizeSiteConfig } from '@/lib/site-config';

export const INTERNAL_SLOT_MINUTES = 15;

/** Canonical occupancy blocks. Never rounds a session to an earlier start. */
export function getCanonicalSlotBlocks(startTime: string, durationMinutes: number): string[] {
    const [h, m] = startTime.split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return [];
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
    const startTotal = h * 60 + m;
    const numBlocks = Math.ceil(durationMinutes / INTERNAL_SLOT_MINUTES);
    const blocks: string[] = [];

    for (let i = 0; i < numBlocks; i += 1) {
        const total = startTotal + i * INTERNAL_SLOT_MINUTES;
        blocks.push(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
    }

    return blocks;
}

export function slotOccupancyKey(date: string, time: string): string {
    return `${date}_${time}`;
}

export type SlotAvailabilityReason = 'slot_blocked' | 'slot_full' | 'appointment_conflict';

export interface SlotAvailabilityResult {
    disabled: boolean;
    reason: SlotAvailabilityReason | null;
    occupancy: number;
}

/**
 * Evaluates the complete set of occupancy blocks covered by a session.
 * Credits are visual only: persistence remains authoritative when saving.
 */
export function getSlotAvailability(input: {
    slot: { date: string; time: string };
    durationMinutes: 30 | 45 | 60;
    occupancy: Record<string, number>;
    blockedSlotKeys: Set<string>;
    userBookedSlotKeys?: Set<string>;
    occupancyCreditsByKey?: Map<string, number>;
    maxCapacity: number;
}): SlotAvailabilityResult {
    const coveredKeys = getCanonicalSlotBlocks(input.slot.time, input.durationMinutes)
        .map((time) => slotOccupancyKey(input.slot.date, time));

    if (coveredKeys.some((key) => input.blockedSlotKeys.has(key))) {
        return { disabled: true, reason: 'slot_blocked', occupancy: 0 };
    }

    if (coveredKeys.some((key) => input.userBookedSlotKeys?.has(key))) {
        return { disabled: true, reason: 'appointment_conflict', occupancy: 0 };
    }

    const effectiveCounts = coveredKeys.map((key) => Math.max(
        0,
        (input.occupancy[key] ?? 0) - (input.occupancyCreditsByKey?.get(key) ?? 0),
    ));
    const occupancy = Math.max(0, ...effectiveCounts);

    if (effectiveCounts.some((count) => count >= input.maxCapacity)) {
        return { disabled: true, reason: 'slot_full', occupancy };
    }

    return { disabled: false, reason: null, occupancy };
}

export function doesSessionFitWithinSchedule(config: SiteConfig, startTime: string, durationMinutes: number): boolean {
    const normalizedConfig = normalizeSiteConfig(config);
    const [h, min] = startTime.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(durationMinutes)) return false;

    const startMinutes = h * 60 + min;
    const scheduleStart = normalizedConfig.startHour * 60;
    const scheduleEnd = normalizedConfig.endHour * 60;

    return startMinutes >= scheduleStart && startMinutes + durationMinutes <= scheduleEnd;
}

export function generateTimeSlots(config: SiteConfig, durationMinutes?: number): string[] {
    const normalizedConfig = normalizeSiteConfig(config);
    const interval = normalizedConfig.slotInterval;
    const slots: string[] = [];
    const startMinutes = normalizedConfig.startHour * 60;
    const endMinutes = normalizedConfig.endHour * 60;
    for (let m = startMinutes; m < endMinutes; m += interval) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        if (durationMinutes == null || doesSessionFitWithinSchedule(normalizedConfig, time, durationMinutes)) {
            slots.push(time);
        }
    }
    return slots;
}
