import { describe, expect, it } from 'vitest';
import {
    formatRecurringSeriesPreview,
    generateWeeklyOccurrenceDates,
    MAX_RECURRING_OCCURRENCES,
} from './recurring-appointments';

describe('generateWeeklyOccurrenceDates', () => {
    it('creates 4 weekly dates from 07/09 to 28/09', () => {
        expect(generateWeeklyOccurrenceDates('2026-09-07', 1, '2026-09-28')).toEqual([
            '2026-09-07',
            '2026-09-14',
            '2026-09-21',
            '2026-09-28',
        ]);
    });

    it('creates biweekly dates', () => {
        expect(generateWeeklyOccurrenceDates('2026-09-07', 2, '2026-09-28')).toEqual([
            '2026-09-07',
            '2026-09-21',
        ]);
    });

    it('returns no dates when endDate is before startDate', () => {
        expect(generateWeeklyOccurrenceDates('2026-09-28', 1, '2026-09-07')).toEqual([]);
    });

    it('caps product preview against the V1 maximum', () => {
        expect(MAX_RECURRING_OCCURRENCES).toBe(20);
        expect(generateWeeklyOccurrenceDates('2026-09-07', 1, '2027-02-01').length).toBeGreaterThan(20);
    });
});

describe('formatRecurringSeriesPreview', () => {
    it('matches the admin summary copy', () => {
        expect(formatRecurringSeriesPreview(13, 45)).toBe('13 sesiones · 45 min · 585 min en total');
        expect(formatRecurringSeriesPreview(4, 60)).toBe('4 sesiones · 60 min · 240 min en total');
    });
});
