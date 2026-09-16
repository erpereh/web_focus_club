import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types';
import {
    buildRecurringRescheduleRequest,
    canCustomerRescheduleRecurringAppointment,
    getRecurringRescheduleErrorMessage,
    getRecurringRescheduleExcludedAppointmentIds,
} from './recurring-reschedule';

function appointment(
    id: string,
    recurrenceIndex: number,
    date: string,
    status: Appointment['status'] = 'approved',
): Appointment {
    return {
        id,
        userId: 'user-1',
        name: 'Cliente',
        email: 'client@example.com',
        phone: '',
        serviceType: 'Entrenamiento',
        duration: '60',
        preferredSlots: [{ date, time: '10:00' }],
        approvedSlot: { date, time: '10:00' },
        reason: '',
        status,
        recurrenceSeriesId: 'series-1',
        recurrenceIndex,
        createdAt: '2026-08-01T10:00:00.000Z',
    };
}

describe('recurring reschedule UI helpers', () => {
    const now = new Date('2026-09-01T08:00:00.000Z');
    const selected = appointment('a1', 1, '2026-09-14');
    const appointments = [
        appointment('a0', 0, '2026-09-07'),
        selected,
        appointment('a2', 2, '2026-09-21', 'cancelled'),
        appointment('a3', 3, '2026-09-28'),
        appointment('a4', 4, '2026-10-05', 'pending'),
        appointment('past', 5, '2026-08-01'),
    ];

    it('excludes only the selected occurrence for single', () => {
        expect([...getRecurringRescheduleExcludedAppointmentIds(appointments, selected, 'single', now)])
            .toEqual(['a1']);
    });

    it('excludes exactly future approved occurrences at or above the selected index for following', () => {
        expect([...getRecurringRescheduleExcludedAppointmentIds(appointments, selected, 'following', now)])
            .toEqual(['a1', 'a3']);
    });

    it('builds both callable scopes without changing the slot', () => {
        const slot = { date: '2026-09-20', time: '19:00' };
        expect(buildRecurringRescheduleRequest('a1', slot, 'single')).toEqual({
            appointmentId: 'a1', preferredSlot: slot, scope: 'single',
        });
        expect(buildRecurringRescheduleRequest('a1', slot, 'following')).toEqual({
            appointmentId: 'a1', preferredSlot: slot, scope: 'following',
        });
    });

    it('allows a customer to modify only their future non-today approved recurrence', () => {
        expect(canCustomerRescheduleRecurringAppointment(selected, 'user-1', now)).toBe(true);
        expect(canCustomerRescheduleRecurringAppointment(appointment('today', 1, '2026-09-01'), 'user-1', now)).toBe(false);
        expect(canCustomerRescheduleRecurringAppointment({ ...selected, userId: 'other' }, 'user-1', now)).toBe(false);
        expect(canCustomerRescheduleRecurringAppointment({ ...selected, status: 'pending' }, 'user-1', now)).toBe(false);
    });

    it('maps stable callable reasons to customer-facing messages', () => {
        expect(getRecurringRescheduleErrorMessage({
            details: { reason: 'same_day_change_not_allowed' },
        }, 'fallback')).toMatch(/mismo día/i);
        expect(getRecurringRescheduleErrorMessage({
            details: {
                reason: 'slot_full',
                scope: 'following',
                problematicSlot: { date: '2026-10-04', time: '19:00' },
            },
        }, 'fallback')).toMatch(/04\/10\/2026.*19:00.*completa/i);
        expect(getRecurringRescheduleErrorMessage({
            details: { reason: 'slot_blocked', problematicSlot: { date: '2026-09-20', time: '19:00' } },
        }, 'fallback')).toMatch(/bloqueada/i);
    });
});
