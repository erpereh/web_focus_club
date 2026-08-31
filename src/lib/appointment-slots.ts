import type { SiteConfig } from '@/types';
import { normalizeSiteConfig } from '@/lib/site-config';

/**
 * 15-minute blocks plus legacy 30-minute floors.
 * Same algorithm as functions/src/appointmentLifecycle.ts getSlotBlocks.
 */
export function getSlotBlocks(startTime: string, durationMinutes: number): string[] {
    const [h, m] = startTime.split(':').map(Number);
    const startTotal = h * 60 + m;
    const numBlocks = Math.ceil(durationMinutes / 15);
    const blocks = new Set<string>();

    for (let i = 0; i < numBlocks; i += 1) {
        const total = startTotal + i * 15;
        const legacyTotal = Math.floor(total / 30) * 30;
        [total, legacyTotal].forEach((blockTotal) => {
            blocks.add(`${String(Math.floor(blockTotal / 60)).padStart(2, '0')}:${String(blockTotal % 60).padStart(2, '0')}`);
        });
    }

    return Array.from(blocks);
}

export function slotOccupancyKey(date: string, time: string): string {
    return `${date}_${time}`;
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
