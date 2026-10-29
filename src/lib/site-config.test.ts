import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SITE_CONFIG,
    normalizeMaxCapacity,
    normalizeSiteConfig,
    normalizeSlotInterval,
    sanitizeSiteConfigUpdate,
} from './site-config';

describe('normalizeSlotInterval', () => {
    it.each([15, 30, 45, 60])('accepts the supported %i minute interval', (interval) => {
        expect(normalizeSlotInterval(interval)).toBe(interval);
    });

    it('falls back to 30 for unsupported intervals', () => {
        expect(normalizeSlotInterval(20)).toBe(30);
        expect(normalizeSlotInterval(undefined)).toBe(30);
    });
});

describe('normalizeMaxCapacity', () => {
    it('falls back to 2 when maxCapacity is missing', () => {
        expect(normalizeMaxCapacity(undefined)).toBe(2);
    });

    it('clamps 0 up to 1', () => {
        expect(normalizeMaxCapacity(0)).toBe(1);
    });

    it('keeps 1, 5 and 10', () => {
        expect(normalizeMaxCapacity(1)).toBe(1);
        expect(normalizeMaxCapacity(5)).toBe(5);
        expect(normalizeMaxCapacity(10)).toBe(10);
    });

    it('clamps 99 down to 10', () => {
        expect(normalizeMaxCapacity(99)).toBe(10);
    });

    it('falls back to 2 for invalid values', () => {
        expect(normalizeMaxCapacity(null)).toBe(2);
        expect(normalizeMaxCapacity(NaN)).toBe(2);
        expect(normalizeMaxCapacity('abc')).toBe(2);
        expect(normalizeMaxCapacity('')).toBe(2);
        expect(normalizeMaxCapacity({})).toBe(2);
    });

    it('accepts numeric strings from Firestore-compatible payloads', () => {
        expect(normalizeMaxCapacity('5')).toBe(5);
        expect(normalizeMaxCapacity('5.9')).toBe(5);
    });
});

describe('normalizeSiteConfig maxCapacity', () => {
    it('produces maxCapacity 2 for a legacy document without the field', () => {
        const config = normalizeSiteConfig({
            startHour: 8,
            endHour: 20,
            slotInterval: 30,
            bonoExpirationMonths: 1,
        });

        expect(config.maxCapacity).toBe(2);
        expect(config.startHour).toBe(8);
        expect(config.endHour).toBe(20);
        expect(config.slotInterval).toBe(30);
        expect(config.bonoExpirationMonths).toBe(1);
    });

    it('keeps the default config at capacity 2', () => {
        expect(DEFAULT_SITE_CONFIG.maxCapacity).toBe(2);
        expect(normalizeSiteConfig().maxCapacity).toBe(2);
    });
});

describe('sanitizeSiteConfigUpdate', () => {
    it('never writes the capacity fields: they change only through Cloud Functions', () => {
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).toEqual({});
        expect(sanitizeSiteConfigUpdate({ capacityExceptionsEnabled: true, endHour: 21 })).toEqual({ endHour: 21 });
    });

    it('treats a missing per-date capacity switch as off', () => {
        expect(normalizeSiteConfig({}).capacityExceptionsEnabled).toBe(false);
        expect(normalizeSiteConfig({ capacityExceptionsEnabled: 'true' as unknown as boolean }).capacityExceptionsEnabled).toBe(false);
        expect(normalizeSiteConfig({ capacityExceptionsEnabled: true }).capacityExceptionsEnabled).toBe(true);
    });

    it('does not fill default schedule or bono fields into a capacity update', () => {
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).not.toHaveProperty('startHour');
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).not.toHaveProperty('endHour');
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).not.toHaveProperty('slotInterval');
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).not.toHaveProperty('bonoExpirationMonths');
        expect(sanitizeSiteConfigUpdate({ maxCapacity: 5 })).not.toHaveProperty('maintenanceMode');
    });
});
