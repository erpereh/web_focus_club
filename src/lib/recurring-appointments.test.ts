import { describe, expect, it } from 'vitest';
import {
    formatRecurringSeriesPreview,
    generateRecurringOccurrenceDates,
    getRecurringEndDateOptions,
    MAX_RECURRING_OCCURRENCES,
} from './recurring-appointments';

describe('generateRecurringOccurrenceDates', () => {
    it('creates every-3-days dates from 10/09', () => {
        expect(generateRecurringOccurrenceDates('2026-09-10', 3, '2026-09-22')).toEqual([
            '2026-09-10',
            '2026-09-13',
            '2026-09-16',
            '2026-09-19',
            '2026-09-22',
        ]);
    });

    it('creates consecutive daily dates', () => {
        expect(generateRecurringOccurrenceDates('2026-09-10', 1, '2026-09-12')).toEqual([
            '2026-09-10',
            '2026-09-11',
            '2026-09-12',
        ]);
    });

    it('creates weekly dates with intervalDays 7', () => {
        expect(generateRecurringOccurrenceDates('2026-09-07', 7, '2026-09-28')).toEqual([
            '2026-09-07',
            '2026-09-14',
            '2026-09-21',
            '2026-09-28',
        ]);
    });

    it('returns no dates when endDate is before startDate', () => {
        expect(generateRecurringOccurrenceDates('2026-09-28', 3, '2026-09-10')).toEqual([]);
    });

    it('returns no dates when intervalDays is 0', () => {
        expect(generateRecurringOccurrenceDates('2026-09-10', 0, '2026-09-22')).toEqual([]);
    });

    it('caps product preview against the V1 maximum', () => {
        expect(MAX_RECURRING_OCCURRENCES).toBe(20);
        expect(generateRecurringOccurrenceDates('2026-09-07', 7, '2027-02-01').length).toBeGreaterThan(20);
    });
});

describe('getRecurringEndDateOptions', () => {
    it('offers Hasta 13/16/19 for 240 min every 3 days from 10/09', () => {
        expect(getRecurringEndDateOptions({
            startDate: '2026-09-10',
            intervalDays: 3,
            durationMinutes: 60,
            remainingMinutes: 240,
        })).toEqual([
            { endDate: '2026-09-13', occurrenceCount: 2, totalMinutes: 120 },
            { endDate: '2026-09-16', occurrenceCount: 3, totalMinutes: 180 },
            { endDate: '2026-09-19', occurrenceCount: 4, totalMinutes: 240 },
        ]);
    });

    it('returns no recurring options when remaining minutes only cover one session', () => {
        expect(getRecurringEndDateOptions({
            startDate: '2026-09-10',
            intervalDays: 3,
            durationMinutes: 60,
            remainingMinutes: 60,
        })).toEqual([]);
    });

    it('caps Hasta at bono expiration including the same day', () => {
        expect(getRecurringEndDateOptions({
            startDate: '2026-09-10',
            intervalDays: 3,
            durationMinutes: 60,
            remainingMinutes: 240,
            bonoExpirationDate: '2026-09-16',
        })).toEqual([
            { endDate: '2026-09-13', occurrenceCount: 2, totalMinutes: 120 },
            { endDate: '2026-09-16', occurrenceCount: 3, totalMinutes: 180 },
        ]);
    });
});

describe('formatRecurringSeriesPreview', () => {
    it('matches the admin summary copy', () => {
        expect(formatRecurringSeriesPreview(13, 45)).toBe('13 sesiones \u00b7 45 min \u00b7 585 min en total');
        expect(formatRecurringSeriesPreview(4, 60)).toBe('4 sesiones \u00b7 60 min \u00b7 240 min en total');
    });
});
