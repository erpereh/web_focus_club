import { describe, expect, it } from 'vitest';
import { getSlotAvailability } from './appointment-slots';

const base = {
    slot: { date: '2026-09-20', time: '18:00' },
    durationMinutes: 60 as const,
    blockedSlotKeys: new Set<string>(),
    maxCapacity: 4,
};

describe('getSlotAvailability', () => {
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
