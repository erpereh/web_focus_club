import { describe, expect, it } from 'vitest';
import { getSlotBlocks } from './appointment-slots';
import { getRecurringEndDateOptions } from './recurring-appointments';
import {
    evaluateRecurringHastaOptions,
    sanitizeRecurringEndDateByAvailability,
} from './recurring-hasta-availability';
import { DEFAULT_SITE_CONFIG } from './site-config';
import type { SiteConfig } from '@/types';

const siteConfig: SiteConfig = {
    ...DEFAULT_SITE_CONFIG,
    startHour: 8,
    endHour: 20,
    slotInterval: 30,
    maxCapacity: 5,
};

const now = new Date('2026-09-20T08:00:00');

const baseOptions = getRecurringEndDateOptions({
    startDate: '2026-09-23',
    intervalDays: 2,
    durationMinutes: 60,
    remainingMinutes: 240,
});

function evaluate(overrides: Partial<Parameters<typeof evaluateRecurringHastaOptions>[0]> = {}) {
    return evaluateRecurringHastaOptions({
        startDate: '2026-09-23',
        startTime: '11:00',
        intervalDays: 2,
        durationMinutes: 60,
        options: baseOptions,
        occupancy: {},
        blockedKeys: new Set(),
        userBookedSlotKeys: new Set(),
        siteConfig,
        now,
        ...overrides,
    });
}

describe('evaluateRecurringHastaOptions', () => {
    it('marks later options blocked when an intermediate occurrence is blocked', () => {
        const statuses = evaluate({
            blockedKeys: new Set(['2026-09-27_11:00']),
        });

        expect(baseOptions.map((option) => option.endDate)).toEqual([
            '2026-09-25',
            '2026-09-27',
            '2026-09-29',
        ]);
        expect(statuses[0]).toMatchObject({ availability: 'available' });
        expect(statuses[1]).toMatchObject({
            availability: 'blocked',
            problemDate: '2026-09-27',
            problemTime: '11:00',
        });
        expect(statuses[2]).toMatchObject({
            availability: 'blocked',
            problemDate: '2026-09-27',
        });
        expect(statuses[1].message).toContain('27/09');
    });

    it('propagates an intermediate full slot to later options', () => {
        const statuses = evaluate({
            occupancy: { '2026-09-27_11:00': 5 },
        });

        expect(statuses[0].availability).toBe('available');
        expect(statuses[1]).toMatchObject({ availability: 'full', problemDate: '2026-09-27' });
        expect(statuses[2]).toMatchObject({ availability: 'full', problemDate: '2026-09-27' });
    });

    it('propagates an intermediate client conflict to later options', () => {
        const statuses = evaluate({
            userBookedSlotKeys: new Set(['2026-09-27_11:00']),
        });

        expect(statuses[0].availability).toBe('available');
        expect(statuses[1]).toMatchObject({ availability: 'conflict', problemDate: '2026-09-27' });
        expect(statuses[2]).toMatchObject({ availability: 'conflict', problemDate: '2026-09-27' });
        expect(statuses[1].message).toBe('Ya tienes una sesión que se solapa el 27/09/2026.');
    });

    it('invalidates a 60 min session when a later duration block is blocked or full', () => {
        expect(getSlotBlocks('11:00', 60)).toEqual(['11:00', '11:15', '11:30', '11:45']);

        const blockedLaterBlock = evaluate({
            blockedKeys: new Set(['2026-09-27_11:30']),
        });
        expect(blockedLaterBlock[0].availability).toBe('available');
        expect(blockedLaterBlock[1]).toMatchObject({ availability: 'blocked', problemDate: '2026-09-27' });

        const fullLaterBlock = evaluate({
            occupancy: { '2026-09-27_11:45': 5 },
        });
        expect(fullLaterBlock[0].availability).toBe('available');
        expect(fullLaterBlock[1]).toMatchObject({ availability: 'full', problemDate: '2026-09-27' });
    });

    it('uses siteConfig.maxCapacity instead of a hardcoded limit', () => {
        const underCapacity = evaluate({
            occupancy: { '2026-09-25_11:00': 4 },
        });
        expect(underCapacity[0].availability).toBe('available');

        const atCapacity = evaluate({
            occupancy: { '2026-09-25_11:00': 5 },
        });
        expect(atCapacity[0].availability).toBe('full');
        expect(atCapacity[1].availability).toBe('full');
        expect(atCapacity[1].problemDate).toBe('2026-09-25');
    });

    it('marks a prefix invalid for outside_schedule and past', () => {
        const outside = evaluate({ startTime: '19:45' });
        expect(outside[0].availability).toBe('outside_schedule');
        expect(outside[2].availability).toBe('outside_schedule');
        expect(outside[2].problemDate).toBe('2026-09-23');

        const past = evaluate({ now: new Date('2026-09-27T12:00:00') });
        expect(past[0].availability).toBe('past');
        expect(past[0].problemDate).toBe('2026-09-23');
        expect(past[2].availability).toBe('past');
        expect(past[2].problemDate).toBe('2026-09-23');
    });
});

describe('sanitizeRecurringEndDateByAvailability', () => {
    const statuses = evaluate({
        blockedKeys: new Set(['2026-09-27_11:00']),
    });

    it('clears an endDate that became blocked after a ready preview', () => {
        expect(sanitizeRecurringEndDateByAvailability('2026-09-29', statuses, 'ready')).toBe('');
        expect(sanitizeRecurringEndDateByAvailability('2026-09-25', statuses, 'ready')).toBe('2026-09-25');
    });

    it('does not clear during loading or error', () => {
        expect(sanitizeRecurringEndDateByAvailability('2026-09-29', statuses, 'loading')).toBe('2026-09-29');
        expect(sanitizeRecurringEndDateByAvailability('2026-09-29', statuses, 'error')).toBe('2026-09-29');
    });
});
