import { describe, expect, it } from 'vitest';
import {
    capacityByDateFrom,
    parseCapacityException,
    parseCapacityExceptionCapacity,
    resolveMaxCapacity,
} from './capacity-exceptions';
import { describeAdminRestriction, parseAdminOverridePrompt } from './admin-booking-overrides';
import { getAdminCreateSlotStatus } from './admin-slot-status';
import { evaluateRecurringHastaOptions } from './recurring-hasta-availability';
import { getRecurringEndDateOptions } from './recurring-appointments';
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig } from './site-config';

const config = normalizeSiteConfig({ startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 4 });

describe('capacity exceptions (aforo por fecha)', () => {
    it('resolves the capacity of a date: its exception, or the global value', () => {
        const byDate = { '2026-10-20': 2, '2026-10-21': 6 };
        expect(resolveMaxCapacity(config, byDate, '2026-10-20')).toBe(2);
        expect(resolveMaxCapacity(config, byDate, '2026-10-21')).toBe(6);
        expect(resolveMaxCapacity(config, byDate, '2026-10-22')).toBe(4);
        expect(resolveMaxCapacity(config, undefined, '2026-10-20')).toBe(4);
    });

    it('parses stored documents like the server: clamped, unusable ones ignored', () => {
        expect(parseCapacityExceptionCapacity({ maxCapacity: 2 })).toBe(2);
        expect(parseCapacityExceptionCapacity({ maxCapacity: 40 })).toBe(10);
        expect(parseCapacityExceptionCapacity({ maxCapacity: 'x' })).toBeUndefined();
        expect(parseCapacityExceptionCapacity({})).toBeUndefined();
        expect(parseCapacityException('2026-10-20', { maxCapacity: 3, updatedByEmail: 'a@b.c' }))
            .toEqual({ date: '2026-10-20', maxCapacity: 3, updatedByEmail: 'a@b.c' });
        expect(parseCapacityException('main', { maxCapacity: 3 })).toBeUndefined();
        expect(capacityByDateFrom([{ date: '2026-10-20', maxCapacity: 2 }])).toEqual({ '2026-10-20': 2 });
    });

    it('the admin "Nueva cita" grid uses the capacity of the selected day', () => {
        const occupancy = Object.fromEntries(['10:00', '10:15', '10:30', '10:45'].map((time) => [`2026-10-20_${time}`, 2]));
        const status = (capacityByDate?: Record<string, number>) => getAdminCreateSlotStatus({
            date: '2026-10-20',
            time: '10:00',
            durationMinutes: 60,
            siteConfig: config,
            capacityByDate,
            occupancy,
            blockedSlotKeys: new Set(),
            appointments: [],
        });
        expect(status().label).toBe('2/4');
        expect(status({ '2026-10-20': 2 })).toMatchObject({ label: 'Lleno 2/2', tone: 'full', restricted: true });
    });

    it('recurring end-date options stop at the occurrence of a reduced day', () => {
        const options = getRecurringEndDateOptions({ startDate: '2026-09-23', intervalDays: 7, durationMinutes: 60, remainingMinutes: 240 });
        const occupancy = Object.fromEntries(['11:00', '11:15', '11:30', '11:45'].map((time) => [`2026-10-07_${time}`, 2]));
        const evaluate = (capacityByDate?: Record<string, number>) => evaluateRecurringHastaOptions({
            startDate: '2026-09-23',
            startTime: '11:00',
            intervalDays: 7,
            durationMinutes: 60,
            options,
            occupancy,
            blockedKeys: new Set(),
            userBookedSlotKeys: new Set(),
            siteConfig: { ...DEFAULT_SITE_CONFIG, ...config },
            capacityByDate,
            now: new Date('2026-09-20T08:00:00.000Z'),
        });
        expect(evaluate().every((item) => item.availability === 'available')).toBe(true);
        const reduced = evaluate({ '2026-10-07': 2 });
        expect(reduced[0].availability).toBe('available');
        expect(reduced[1]).toMatchObject({ availability: 'full', problemDate: '2026-10-07' });
    });

    it('a capacity reduction warning opens the same confirmation as booking overrides', () => {
        const prompt = parseAdminOverridePrompt({
            reason: 'capacity_reduction_confirmation_required',
            fingerprint: 'fp',
            changed: false,
            restrictions: [{ date: '2026-10-20', time: '10:00', reason: 'capacity_below_occupancy', occupancy: 3, maxCapacity: 2 }],
        });
        expect(prompt?.fingerprint).toBe('fp');
        expect(describeAdminRestriction(prompt!.restrictions[0]))
            .toBe('Más citas aprobadas que el nuevo aforo: 3 aprobadas con aforo 2. Las citas se mantienen.');
        expect(parseAdminOverridePrompt({ reason: 'slot_full', fingerprint: 'fp', restrictions: [] })).toBeUndefined();
    });
});
