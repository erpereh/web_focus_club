import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types';
import { getCanonicalSlotBlocks, getSlotAvailability } from './appointment-slots';
import { buildRescheduleCalendarContext } from './recurring-reschedule';

describe('pending and approved capacity', () => {
    for (const duration of [30, 45, 60] as const) {
        for (const status of ['pending', 'approved'] as const) {
            it(`credits one existing ${status} seat across ${duration} minutes`, () => {
                const appointment: Appointment = {
                    id: 'a', userId: 'u', name: '', email: '', phone: '', serviceType: 'Training',
                    reason: '', createdAt: '2026-11-01', status, duration: String(duration) as Appointment['duration'],
                    preferredSlots: [{ date: '2026-12-01', time: '10:00' }],
                    ...(status === 'approved' ? { approvedSlot: { date: '2026-12-01', time: '10:00' } } : {}),
                };
                const context = buildRescheduleCalendarContext([appointment], 'u', new Set(['a']));
                const blocks = getCanonicalSlotBlocks('10:00', duration);
                expect([...context.occupancyCreditsByKey.values()]).toEqual(blocks.map(() => 1));
                const occupancy = Object.fromEntries(blocks.map(time => [`2026-12-01_${time}`, 3]));
                const availability = getSlotAvailability({
                    slot: { date: '2026-12-01', time: '10:00' }, durationMinutes: duration,
                    occupancy, occupancyCreditsByKey: context.occupancyCreditsByKey,
                    blockedSlotKeys: new Set(), maxCapacity: 1,
                });
                expect(availability.disabled).toBe(false);
            });
        }
    }

    it('refuses a newly covered full block even when the other blocks already belong to the appointment', () => {
        const result = getSlotAvailability({
            slot: { date: '2026-12-01', time: '10:00' }, durationMinutes: 45, maxCapacity: 1,
            blockedSlotKeys: new Set(), occupancy: { '2026-12-01_10:00': 1, '2026-12-01_10:15': 1, '2026-12-01_10:30': 1 },
            occupancyCreditsByKey: new Map([['2026-12-01_10:00', 1], ['2026-12-01_10:15', 1]]),
        });
        expect(result.reason).toBe('slot_full');
    });
});
