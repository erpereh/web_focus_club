import { describe, expect, it } from 'vitest';
import {
    BOOKING_NOTICE_TOO_SHORT,
    customerBookingRestriction,
    customerBookingRestrictionMessage,
    isSameDayBookingBlocked,
    SAME_DAY_BOOKING_DISABLED,
    SAME_DAY_BOOKING_MESSAGE,
} from './booking-notice';
import { getRecurringEndDateOptions } from './recurring-appointments';
import { evaluateRecurringHastaOptions } from './recurring-hasta-availability';
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig, sanitizeSiteConfigUpdate } from './site-config';
import type { SiteConfig } from '@/types';

// Monday 5 Oct 2026, 10:00 in Madrid (CEST, UTC+2).
const NOW = new Date('2026-10-05T08:00:00.000Z');
const slot = (date: string, time: string) => ({ date, time });

describe('blockSameDayBooking config', () => {
    it('defaults to false and keeps legacy configs bookable today', () => {
        expect(DEFAULT_SITE_CONFIG.blockSameDayBooking).toBe(false);
        expect(normalizeSiteConfig({}).blockSameDayBooking).toBe(false);
        expect(normalizeSiteConfig({ blockSameDayBooking: 'true' as unknown as boolean }).blockSameDayBooking).toBe(false);
        expect(normalizeSiteConfig({ blockSameDayBooking: true }).blockSameDayBooking).toBe(true);
    });

    it('sanitizes updates to a strict boolean and leaves it out when not sent', () => {
        expect(sanitizeSiteConfigUpdate({ blockSameDayBooking: true })).toEqual({ blockSameDayBooking: true });
        expect(sanitizeSiteConfigUpdate({ blockSameDayBooking: 1 as unknown as boolean })).toEqual({ blockSameDayBooking: false });
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 3 })).not.toHaveProperty('blockSameDayBooking');
    });
});

describe('isSameDayBookingBlocked', () => {
    it('blocks any time today only when enabled', () => {
        expect(isSameDayBookingBlocked(slot('2026-10-05', '10:30'), NOW, true)).toBe(true);
        expect(isSameDayBookingBlocked(slot('2026-10-05', '23:30'), NOW, true)).toBe(true);
        expect(isSameDayBookingBlocked(slot('2026-10-06', '08:00'), NOW, true)).toBe(false);
        expect(isSameDayBookingBlocked(slot('2026-10-05', '10:30'), NOW, false)).toBe(false);
        expect(isSameDayBookingBlocked(slot('2026-10-05', '10:30'), NOW, undefined)).toBe(false);
    });

    it('uses the Madrid calendar day at midnight, not UTC or the browser zone', () => {
        const beforeMidnight = new Date('2026-10-05T21:59:00.000Z'); // 23:59 Madrid
        expect(isSameDayBookingBlocked(slot('2026-10-05', '23:59'), beforeMidnight, true)).toBe(true);
        expect(isSameDayBookingBlocked(slot('2026-10-06', '00:00'), beforeMidnight, true)).toBe(false);
        const atMidnight = new Date('2026-10-05T22:00:00.000Z'); // 00:00 Madrid on the 6th, UTC still the 5th
        expect(isSameDayBookingBlocked(slot('2026-10-06', '09:00'), atMidnight, true)).toBe(true);
        expect(isSameDayBookingBlocked(slot('2026-10-07', '09:00'), atMidnight, true)).toBe(false);
        const winter = new Date('2026-11-01T23:30:00.000Z'); // 00:30 Madrid (CET) on 2 Nov
        expect(isSameDayBookingBlocked(slot('2026-11-02', '10:00'), winter, true)).toBe(true);
    });
});

describe('customerBookingRestriction', () => {
    it('applies same-day and notice independently with specific reasons', () => {
        expect(customerBookingRestriction(slot('2026-10-05', '19:00'), NOW, { blockSameDayBooking: true, minBookingNoticeHours: 1 }))
            .toBe(SAME_DAY_BOOKING_DISABLED);
        expect(customerBookingRestriction(slot('2026-10-06', '09:30'), NOW, { blockSameDayBooking: true, minBookingNoticeHours: 24 }))
            .toBe(BOOKING_NOTICE_TOO_SHORT);
        expect(customerBookingRestriction(slot('2026-10-06', '10:00'), NOW, { blockSameDayBooking: true, minBookingNoticeHours: 24 }))
            .toBeUndefined();
        expect(customerBookingRestriction(slot('2026-10-05', '19:00'), NOW, {})).toBeUndefined();
        expect(customerBookingRestrictionMessage(SAME_DAY_BOOKING_DISABLED, 0)).toBe(SAME_DAY_BOOKING_MESSAGE);
    });
});

describe('recurring preview with same-day block', () => {
    const siteConfig: SiteConfig = { ...DEFAULT_SITE_CONFIG, startHour: 8, endHour: 20, slotInterval: 30, maxCapacity: 5 };
    const options = getRecurringEndDateOptions({
        startDate: '2026-10-05',
        intervalDays: 7,
        durationMinutes: 60,
        remainingMinutes: 240,
    });
    const evaluate = (overrides: Partial<Parameters<typeof evaluateRecurringHastaOptions>[0]> = {}) => evaluateRecurringHastaOptions({
        startDate: '2026-10-05',
        startTime: '18:00',
        intervalDays: 7,
        durationMinutes: 60,
        options,
        occupancy: {},
        blockedKeys: new Set(),
        userBookedSlotKeys: new Set(),
        siteConfig,
        now: NOW,
        ...overrides,
    });

    it('rejects every option when the series starts today, naming the date, without calling it past', () => {
        const statuses = evaluate({ blockSameDayBooking: true });
        expect(statuses.length).toBeGreaterThan(0);
        statuses.forEach((status) => {
            expect(status).toMatchObject({ availability: SAME_DAY_BOOKING_DISABLED, problemDate: '2026-10-05', problemTime: '18:00' });
            expect(status.message).toContain('05/10');
        });
    });

    it('keeps the series bookable when the flag is off (legacy)', () => {
        expect(evaluate().every((status) => status.availability === 'available')).toBe(true);
    });

    it('reports the booking notice with its own reason instead of past', () => {
        const statuses = evaluate({ minBookingNoticeHours: 24 });
        expect(statuses[0]).toMatchObject({ availability: BOOKING_NOTICE_TOO_SHORT, problemDate: '2026-10-05' });
    });
});
