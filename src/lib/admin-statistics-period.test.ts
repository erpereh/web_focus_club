import { describe, expect, it } from 'vitest';
import {
    bucketsFor,
    currentPeriod,
    customPeriod,
    granularityFor,
    mergeDateRanges,
    periodInstantRange,
    periodLabel,
    previousPeriod,
    resolvePeriod,
    shiftPeriod,
} from './admin-statistics-period';

describe('statistics periods (Europe/Madrid civil dates)', () => {
    it('resolves the week (Monday–Sunday), month and year containing a day', () => {
        expect(resolvePeriod('week', '2026-10-21')).toEqual({ kind: 'week', startKey: '2026-10-19', endKey: '2026-10-25' });
        expect(resolvePeriod('week', '2026-10-25')).toEqual({ kind: 'week', startKey: '2026-10-19', endKey: '2026-10-25' });
        expect(resolvePeriod('month', '2028-02-10')).toEqual({ kind: 'month', startKey: '2028-02-01', endKey: '2028-02-29' });
        expect(resolvePeriod('year', '2026-10-21')).toEqual({ kind: 'year', startKey: '2026-01-01', endKey: '2026-12-31' });
    });

    it('uses the Madrid calendar day for "now", not UTC', () => {
        // 31 Dec 2026 23:30 UTC is already 1 Jan 2027 in Madrid.
        expect(currentPeriod('year', new Date('2026-12-31T23:30:00.000Z')).startKey).toBe('2027-01-01');
        expect(currentPeriod('month', new Date('2026-10-31T23:30:00.000Z')).startKey).toBe('2026-11-01');
    });

    it('compares with the equivalent previous period', () => {
        expect(previousPeriod(resolvePeriod('month', '2026-03-15'))).toEqual({ kind: 'month', startKey: '2026-02-01', endKey: '2026-02-28' });
        expect(previousPeriod(resolvePeriod('month', '2026-01-15'))).toEqual({ kind: 'month', startKey: '2025-12-01', endKey: '2025-12-31' });
        expect(previousPeriod(resolvePeriod('week', '2026-01-01'))).toEqual({ kind: 'week', startKey: '2025-12-22', endKey: '2025-12-28' });
        expect(previousPeriod(resolvePeriod('year', '2026-05-05')).startKey).toBe('2025-01-01');
        const custom = customPeriod('2026-10-01', '2026-10-10')!;
        expect(previousPeriod(custom)).toEqual({ kind: 'custom', startKey: '2026-09-21', endKey: '2026-09-30' });
        expect(shiftPeriod(custom, 1)).toEqual({ kind: 'custom', startKey: '2026-10-11', endKey: '2026-10-20' });
    });

    it('validates custom ranges', () => {
        expect(customPeriod('2026-10-10', '2026-10-01')).toEqual({ kind: 'custom', startKey: '2026-10-01', endKey: '2026-10-10' });
        expect(customPeriod('2026-02-30', '2026-03-01')).toBeNull();
        expect(customPeriod('2020-01-01', '2026-01-01')).toBeNull();
    });

    it('covers whole Madrid days across daylight-saving changes', () => {
        // October 2026: CEST (+2) at the start, CET (+1) after 25 Oct.
        const october = periodInstantRange(resolvePeriod('month', '2026-10-01'));
        expect(new Date(october.start).toISOString()).toBe('2026-09-30T22:00:00.000Z');
        expect(new Date(october.end).toISOString()).toBe('2026-10-31T23:00:00.000Z');
        // March 2026: CET at the start, CEST after 29 Mar.
        const march = periodInstantRange(resolvePeriod('month', '2026-03-01'));
        expect(new Date(march.start).toISOString()).toBe('2026-02-28T23:00:00.000Z');
        expect(new Date(march.end).toISOString()).toBe('2026-03-31T22:00:00.000Z');
    });

    it('builds every bucket, clipped to the period', () => {
        const month = resolvePeriod('month', '2026-10-01');
        expect(granularityFor(month)).toBe('day');
        expect(bucketsFor(month, 'day')).toHaveLength(31);
        const year = resolvePeriod('year', '2026-01-01');
        expect(granularityFor(year)).toBe('month');
        expect(bucketsFor(year, 'month').map((bucket) => bucket.key)).toHaveLength(12);
        const custom = customPeriod('2026-10-08', '2026-12-20')!;
        expect(granularityFor(custom)).toBe('week');
        const weeks = bucketsFor(custom, 'week');
        expect(weeks[0]).toMatchObject({ key: '2026-10-05', startKey: '2026-10-08', endKey: '2026-10-11' });
        expect(weeks.at(-1)).toMatchObject({ key: '2026-12-14', startKey: '2026-12-14', endKey: '2026-12-20' });
        expect(granularityFor(customPeriod('2026-01-01', '2026-12-31')!)).toBe('month');
    });

    it('labels periods in Spanish', () => {
        expect(periodLabel(resolvePeriod('month', '2026-10-01'))).toBe('Octubre de 2026');
        expect(periodLabel(resolvePeriod('year', '2026-10-01'))).toBe('2026');
        expect(periodLabel(resolvePeriod('week', '2026-10-21'))).toMatch(/^Semana del 19 oct – 25 oct 2026$/);
    });
});

describe('mergeDateRanges', () => {
    it('reads each date once: overlapping and adjacent ranges are merged, open ends kept', () => {
        expect(mergeDateRanges([
            { from: '2026-04-24', to: '9999-12-31' },
            { from: '2026-09-01', to: '2026-10-31' },
        ])).toEqual([{ from: '2026-04-24', to: '9999-12-31' }]);
        expect(mergeDateRanges([
            { from: '2026-05-01', to: '9999-12-31' },
            { from: '2024-12-01', to: '2025-01-31' },
        ])).toEqual([{ from: '2024-12-01', to: '2025-01-31' }, { from: '2026-05-01', to: '9999-12-31' }]);
        expect(mergeDateRanges([
            { from: '2026-01-01', to: '2026-01-31' },
            { from: '2026-02-01', to: '2026-02-10' },
        ])).toEqual([{ from: '2026-01-01', to: '2026-02-10' }]);
    });
});
