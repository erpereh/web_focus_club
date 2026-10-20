import { describe, expect, it } from 'vitest';
import {
    groupAdminRestrictions,
    isValidAdminSlotTime,
    newAdminBookingRequestId,
    parseAdminOverridePrompt,
} from './admin-booking-overrides';

describe('admin booking overrides (client)', () => {
    it('reads the confirmation request from callable error details', () => {
        expect(parseAdminOverridePrompt({
            reason: 'admin_override_required',
            fingerprint: 'fp',
            requiresPastConfirmation: true,
            changed: false,
            restrictions: [{ date: '2026-10-20', time: '10:00', reason: 'slot_full', occupancy: 2, maxCapacity: 2 }, { reason: 'unknown' }],
        })).toEqual({
            fingerprint: 'fp',
            requiresPastConfirmation: true,
            changed: false,
            restrictions: [{ date: '2026-10-20', time: '10:00', reason: 'slot_full', occupancy: 2, maxCapacity: 2 }],
        });
        expect(parseAdminOverridePrompt({ reason: 'slot_full' })).toBeUndefined();
        expect(parseAdminOverridePrompt(undefined)).toBeUndefined();
    });

    it('groups restrictions per session in chronological order', () => {
        const groups = groupAdminRestrictions([
            { date: '2026-10-27', time: '10:00', reason: 'slot_blocked' },
            { date: '2026-10-20', time: '10:00', reason: 'slot_full' },
            { date: '2026-10-20', time: '10:00', reason: 'outside_schedule' },
        ]);
        expect(groups.map((group) => [group.date, group.restrictions.length])).toEqual([['2026-10-20', 2], ['2026-10-27', 1]]);
    });

    it('accepts only quarter-hour times that end by midnight', () => {
        expect(isValidAdminSlotTime('06:00', 60)).toBe(true);
        expect(isValidAdminSlotTime('23:00', 60)).toBe(true);
        expect(isValidAdminSlotTime('23:30', 60)).toBe(false);
        expect(isValidAdminSlotTime('10:07', 30)).toBe(false);
        expect(isValidAdminSlotTime('25:00', 30)).toBe(false);
    });

    it('creates request ids the server accepts', () => {
        const id = newAdminBookingRequestId();
        expect(id).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
        expect(newAdminBookingRequestId()).not.toBe(id);
    });
});
