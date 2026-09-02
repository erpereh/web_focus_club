import { describe, expect, it } from 'vitest';
import {
    getAppointmentEffectiveSlot,
    getMadridDateKey,
    isSameDayAppointment,
    isSameDayInMadrid,
    pendingSeriesHasSameDayOccurrence,
} from './madrid-date';

describe('getMadridDateKey', () => {
    it('uses Madrid when UTC is still the previous day', () => {
        expect(getMadridDateKey(new Date('2026-07-15T22:30:00.000Z'))).toBe('2026-07-16');
        expect(getMadridDateKey(new Date('2026-01-15T23:30:00.000Z'))).toBe('2026-01-16');
    });

    it('uses CEST in summer', () => {
        expect(getMadridDateKey(new Date('2026-07-15T21:30:00.000Z'))).toBe('2026-07-15');
        expect(getMadridDateKey(new Date('2026-07-15T22:00:00.000Z'))).toBe('2026-07-16');
    });

    it('uses CET in winter', () => {
        expect(getMadridDateKey(new Date('2026-01-15T22:30:00.000Z'))).toBe('2026-01-15');
        expect(getMadridDateKey(new Date('2026-01-15T23:00:00.000Z'))).toBe('2026-01-16');
    });
});

describe('isSameDayInMadrid', () => {
    const noonMadrid = new Date('2026-09-02T10:00:00.000Z');

    it('matches gym dateKeys without converting them to Date', () => {
        expect(isSameDayInMadrid('2026-09-02', noonMadrid)).toBe(true);
        expect(isSameDayInMadrid('2026-09-03', noonMadrid)).toBe(false);
        expect(isSameDayInMadrid('2026-09-01', noonMadrid)).toBe(false);
    });
});

describe('getAppointmentEffectiveSlot', () => {
    it('prefers approvedSlot, then preferredSlots, then legacy date/time', () => {
        expect(getAppointmentEffectiveSlot({
            approvedSlot: { date: '2026-09-02', time: '20:00' },
            preferredSlots: [{ date: '2026-09-03', time: '07:00' }],
            date: '2026-08-01',
            time: '10:00',
        })).toEqual({ date: '2026-09-02', time: '20:00' });

        expect(getAppointmentEffectiveSlot({
            preferredSlots: [{ date: '2026-09-03', time: '07:00' }],
            date: '2026-08-01',
            time: '10:00',
        })).toEqual({ date: '2026-09-03', time: '07:00' });

        expect(getAppointmentEffectiveSlot({
            date: '2026-08-01',
            time: '10:00',
        })).toEqual({ date: '2026-08-01', time: '10:00' });
    });
});

describe('same-day appointment and pending series', () => {
    const now = new Date('2026-09-02T10:00:00.000Z');

    it('treats today future and today past as same-day', () => {
        expect(isSameDayAppointment({ date: '2026-09-02', time: '20:00' }, now)).toBe(true);
        expect(isSameDayAppointment({ date: '2026-09-02', time: '09:00' }, now)).toBe(true);
        expect(isSameDayAppointment({ date: '2026-09-03', time: '07:00' }, now)).toBe(false);
        expect(isSameDayAppointment({ date: '2026-09-01', time: '20:00' }, now)).toBe(false);
    });

    it('flags a pending series when any occurrence is today', () => {
        expect(pendingSeriesHasSameDayOccurrence([
            { recurrenceSeriesId: 's1', status: 'pending', date: '2026-09-03', time: '07:00' },
            { recurrenceSeriesId: 's1', status: 'pending', date: '2026-09-02', time: '20:00' },
        ], 's1', now)).toBe(true);

        expect(pendingSeriesHasSameDayOccurrence([
            { recurrenceSeriesId: 's1', status: 'pending', date: '2026-09-03', time: '07:00' },
            { recurrenceSeriesId: 's1', status: 'pending', date: '2026-09-04', time: '07:00' },
        ], 's1', now)).toBe(false);
    });
});
