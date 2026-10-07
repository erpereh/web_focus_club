import { describe, expect, it } from 'vitest';
import {
    effectiveBookingNoticeHours,
    isInsideBookingNotice,
    madridCivilSlotToInstant,
    normalizeMinBookingNoticeHours,
} from './booking-notice';
import { normalizeSiteConfig, sanitizeSiteConfigUpdate } from './site-config';

// Monday 5 Oct 2026, 10:00 in Madrid (CEST, UTC+2).
const NOW = new Date('2026-10-05T08:00:00.000Z');
const slot = (date: string, time: string) => ({ date, time });

describe('booking notice config', () => {
    it('treats a missing field as 0 and keeps integer hours', () => {
        expect(normalizeSiteConfig({}).minBookingNoticeHours).toBe(0);
        expect(normalizeMinBookingNoticeHours(undefined)).toBe(0);
        expect(normalizeMinBookingNoticeHours(-3)).toBe(0);
        expect(normalizeMinBookingNoticeHours('x')).toBe(0);
        expect(normalizeMinBookingNoticeHours('24')).toBe(24);
        expect(normalizeMinBookingNoticeHours(5.7)).toBe(5);
        expect(sanitizeSiteConfigUpdate({ minBookingNoticeHours: -1 })).toEqual({ minBookingNoticeHours: 0 });
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 3 })).not.toHaveProperty('minBookingNoticeHours');
    });
});

describe('isInsideBookingNotice', () => {
    it('0h allows any future slot', () => {
        expect(isInsideBookingNotice(slot('2026-10-05', '10:30'), NOW, 0)).toBe(false);
    });

    it('24h blocks +23:59 and allows +24:00 or later', () => {
        expect(isInsideBookingNotice(slot('2026-10-06', '09:59'), NOW, 24)).toBe(true);
        expect(isInsideBookingNotice(slot('2026-10-06', '10:00'), NOW, 24)).toBe(false);
        expect(isInsideBookingNotice(slot('2026-10-06', '11:00'), NOW, 24)).toBe(false);
    });

    it('handles day and month changes', () => {
        const now = new Date('2026-10-31T21:00:00.000Z'); // 31 Oct 22:00 Madrid (CET)
        expect(isInsideBookingNotice(slot('2026-11-01', '21:59'), now, 24)).toBe(true);
        expect(isInsideBookingNotice(slot('2026-11-01', '22:00'), now, 24)).toBe(false);
    });

    it('uses real hours across the Madrid DST change', () => {
        // 24 Oct 12:00 Madrid (CEST) = 10:00Z; +24h = 25 Oct 10:00Z = 11:00 Madrid (CET).
        const now = new Date('2026-10-24T10:00:00.000Z');
        expect(madridCivilSlotToInstant(slot('2026-10-25', '11:00'))?.toISOString()).toBe('2026-10-25T10:00:00.000Z');
        expect(isInsideBookingNotice(slot('2026-10-25', '10:30'), now, 24)).toBe(true);
        expect(isInsideBookingNotice(slot('2026-10-25', '11:00'), now, 24)).toBe(false);
        expect(isInsideBookingNotice(slot('2026-10-25', '12:00'), now, 24)).toBe(false);
    });
});

describe('effectiveBookingNoticeHours', () => {
    it('applies the configured notice to bookings only, and max(24h, notice) to modifications', () => {
        expect(effectiveBookingNoticeHours(24, 'booking')).toBe(24);
        expect(effectiveBookingNoticeHours(12, 'modification')).toBe(0);
        expect(effectiveBookingNoticeHours(48, 'modification')).toBe(48);
        expect(effectiveBookingNoticeHours(48, undefined)).toBe(0);
    });
});
