import { describe, expect, it } from 'vitest';
import {
    generateTimeSlots,
    getCanonicalSlotBlocks,
    getSlotAvailability,
} from './appointment-slots';
import type { SiteConfig } from '@/types';

const config = (slotInterval: 15 | 30 | 45 | 60): SiteConfig => ({
    startHour: 7,
    endHour: 20,
    slotInterval,
    bonoExpirationMonths: 1,
    maintenanceMode: false,
    maxCapacity: 4,
});

describe('generateTimeSlots', () => {
    it.each([
        [15, ['07:00', '07:15', '07:30', '07:45', '08:00']],
        [30, ['07:00', '07:30', '08:00', '08:30', '09:00']],
        [45, ['07:00', '07:45', '08:30', '09:15', '10:00']],
        [60, ['07:00', '08:00', '09:00', '10:00', '11:00']],
    ] as const)('generates a dynamic %i minute grid', (interval, expectedStart) => {
        expect(generateTimeSlots(config(interval)).slice(0, 5)).toEqual(expectedStart);
    });
});

describe('getCanonicalSlotBlocks', () => {
    it.each([
        ['10:00', 30, ['10:00', '10:15']],
        ['10:15', 30, ['10:15', '10:30']],
        ['10:30', 45, ['10:30', '10:45', '11:00']],
        ['10:45', 60, ['10:45', '11:00', '11:15', '11:30']],
    ] as const)('covers %s + %i without legacy floors', (start, duration, expected) => {
        expect(getCanonicalSlotBlocks(start, duration)).toEqual(expected);
    });

    it('never creates a block before the real start time', () => {
        expect(getCanonicalSlotBlocks('16:15', 45)).toEqual(['16:15', '16:30', '16:45']);
    });
});

const base = {
    slot: { date: '2026-09-20', time: '18:00' },
    durationMinutes: 60 as const,
    blockedSlotKeys: new Set<string>(),
    maxCapacity: 4,
};

describe('getSlotAvailability', () => {
    it('keeps adjacent 45 minute sessions independent at a 15 minute start', () => {
        const firstKeys = new Set(getCanonicalSlotBlocks('15:30', 45));
        expect(getCanonicalSlotBlocks('16:15', 45).some((time) => firstKeys.has(time))).toBe(false);
        expect(getCanonicalSlotBlocks('16:00', 45).some((time) => firstKeys.has(time))).toBe(true);
    });

    it('keeps partial capacity selectable and reports the most occupied covered block', () => {
        expect(getSlotAvailability({
            ...base,
            occupancy: {
                '2026-09-20_18:00': 1,
                '2026-09-20_18:15': 2,
                '2026-09-20_18:30': 3,
                '2026-09-20_18:45': 1,
            },
        })).toEqual({ disabled: false, reason: null, occupancy: 3 });
    });

    it.each([45, 60] as const)('disables a %i minute slot when any covered block is full', (durationMinutes) => {
        expect(getSlotAvailability({
            ...base,
            durationMinutes,
            occupancy: {
                '2026-09-20_18:00': 1,
                '2026-09-20_18:15': 1,
                '2026-09-20_18:30': 4,
                '2026-09-20_18:45': 1,
            },
        })).toEqual({ disabled: true, reason: 'slot_full', occupancy: 4 });
    });

    it('disables the whole session when a covered block is blocked', () => {
        expect(getSlotAvailability({
            ...base,
            occupancy: {},
            blockedSlotKeys: new Set(['2026-09-20_18:30']),
        })).toEqual({ disabled: true, reason: 'slot_blocked', occupancy: 0 });
    });

    it('disables the whole session when it overlaps a customer appointment', () => {
        expect(getSlotAvailability({
            ...base,
            occupancy: {},
            userBookedSlotKeys: new Set(['2026-09-20_18:45']),
        })).toEqual({ disabled: true, reason: 'appointment_conflict', occupancy: 0 });
    });

    it('applies visual credits to every covered block without changing the source counts', () => {
        const occupancy = {
            '2026-09-20_18:00': 4,
            '2026-09-20_18:15': 4,
            '2026-09-20_18:30': 4,
            '2026-09-20_18:45': 4,
        };
        const credits = new Map(Object.keys(occupancy).map((key) => [key, 1]));

        expect(getSlotAvailability({
            ...base,
            occupancy,
            occupancyCreditsByKey: credits,
        })).toEqual({ disabled: false, reason: null, occupancy: 3 });
        expect(occupancy['2026-09-20_18:00']).toBe(4);
    });
});
