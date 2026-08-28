import { describe, expect, it } from 'vitest';
import {
    formatRecurringSeriesPreview,
    generateRecurringOccurrenceDates,
    getRecurringEndDateOptions,
    formatRecurringHastaOptionLabel,
    getRecurringHastaViewModel,
    sanitizeRecurringEndDate,
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

describe('getRecurringEndDateOptions weekly 30 min from 08/09', () => {
    const options = getRecurringEndDateOptions({
        startDate: '2026-09-08',
        intervalDays: 7,
        durationMinutes: 30,
        remainingMinutes: 360,
        bonoExpirationDate: '2026-10-31',
    });

    it('includes 15/09, 22/09 and 29/09 as the first weekly ends', () => {
        expect(options.slice(0, 3)).toEqual([
            { endDate: '2026-09-15', occurrenceCount: 2, totalMinutes: 60 },
            { endDate: '2026-09-22', occurrenceCount: 3, totalMinutes: 90 },
            { endDate: '2026-09-29', occurrenceCount: 4, totalMinutes: 120 },
        ]);
    });

    it('only includes exact 7-day multiples from 08/09', () => {
        expect(options.map((option) => option.endDate)).toEqual(
            generateRecurringOccurrenceDates('2026-09-08', 7, options[options.length - 1].endDate).slice(1),
        );
    });
});

describe('getRecurringHastaViewModel', () => {
    it('feeds Hasta from a selected date without a time slot', () => {
        const view = getRecurringHastaViewModel({
            startDate: '2026-09-08',
            intervalDays: 7,
            durationMinutes: 30,
            remainingMinutes: 360,
            bonoExpirationDate: '2026-10-31',
        });
        expect(view.emptyReason).toBeNull();
        expect(view.startDate).toBe('2026-09-08');
        expect(view.options[0]).toEqual({ endDate: '2026-09-15', occurrenceCount: 2, totalMinutes: 60 });
    });

    it('stays empty until a YYYY-MM-DD start date exists', () => {
        expect(getRecurringHastaViewModel({
            startDate: null,
            intervalDays: 7,
            durationMinutes: 30,
            remainingMinutes: 360,
        }).emptyReason).toBe('no-start-date');
    });
    it('explains when minutes cannot cover two sessions', () => {
        expect(getRecurringHastaViewModel({
            startDate: '2026-09-08',
            intervalDays: 7,
            durationMinutes: 30,
            remainingMinutes: 30,
            bonoExpirationDate: '2026-10-31',
        }).emptyReason).toBe('no-valid-end');
    });
});

describe('formatRecurringHastaOptionLabel', () => {
    it('formats the Hasta option as DD/MM/YYYY with sessions and minutes', () => {
        expect(formatRecurringHastaOptionLabel({
            endDate: '2026-09-15',
            occurrenceCount: 2,
            totalMinutes: 60,
        })).toBe('15/09/2026 · 2 sesiones · 60 min');
    });
});

describe('formatRecurringSeriesPreview', () => {
    it('matches the admin summary copy', () => {
        expect(formatRecurringSeriesPreview(13, 45)).toBe('13 sesiones \u00b7 45 min \u00b7 585 min en total');
        expect(formatRecurringSeriesPreview(4, 60)).toBe('4 sesiones \u00b7 60 min \u00b7 240 min en total');
    });
});

describe('sanitizeRecurringEndDate', () => {
    const weeklyOptions = getRecurringEndDateOptions({
        startDate: '2026-09-08',
        intervalDays: 7,
        durationMinutes: 30,
        remainingMinutes: 360,
        bonoExpirationDate: '2026-10-31',
    });

    it('keeps an endDate that is still a valid option', () => {
        expect(sanitizeRecurringEndDate('2026-09-29', weeklyOptions)).toBe('2026-09-29');
    });

    it('clears an obsolete endDate when intervalDays changes', () => {
        const everyTenDays = getRecurringEndDateOptions({
            startDate: '2026-09-08',
            intervalDays: 10,
            durationMinutes: 30,
            remainingMinutes: 360,
            bonoExpirationDate: '2026-10-31',
        });
        expect(everyTenDays.some((option) => option.endDate === '2026-09-29')).toBe(false);
        expect(sanitizeRecurringEndDate('2026-09-29', everyTenDays)).toBe('');
    });

    it('clears an obsolete endDate when remaining minutes no longer cover it', () => {
        const fewerMinutes = getRecurringEndDateOptions({
            startDate: '2026-09-08',
            intervalDays: 7,
            durationMinutes: 30,
            remainingMinutes: 60,
            bonoExpirationDate: '2026-10-31',
        });
        expect(sanitizeRecurringEndDate('2026-09-29', fewerMinutes)).toBe('');
    });
});
