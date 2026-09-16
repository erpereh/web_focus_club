import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/types';
import {
    buildRescheduleCalendarContext,
    buildRecurringRescheduleRequest,
    canCustomerRescheduleRecurringAppointment,
    getRecurringRescheduleSlotAvailability,
    getRecurringRescheduleErrorMessage,
    getRecurringRescheduleExcludedAppointmentIds,
    RECURRING_RESCHEDULE_SCOPE_OPTIONS,
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

    it('excludes every future approved occurrence for series, including lower indexes', () => {
        const laterSelected = appointments.find((appointment) => appointment.id === 'a3')!;
        expect([...getRecurringRescheduleExcludedAppointmentIds(appointments, laterSelected, 'series', now)])
            .toEqual(['a0', 'a1', 'a3']);
    });

    it('builds only the new UI scopes without changing the slot', () => {
        const slot = { date: '2026-09-20', time: '19:00' };
        expect(buildRecurringRescheduleRequest('a1', slot, 'single')).toEqual({
            appointmentId: 'a1', preferredSlot: slot, scope: 'single',
        });
        expect(buildRecurringRescheduleRequest('a1', slot, 'series')).toEqual({
            appointmentId: 'a1', preferredSlot: slot, scope: 'series',
        });
    });

    it('exposes the new shared scope copy without the legacy following label', () => {
        expect(RECURRING_RESCHEDULE_SCOPE_OPTIONS).toEqual([
            { scope: 'single', title: 'Solo esta cita', description: 'Únicamente esta sesión.' },
            {
                scope: 'series',
                title: 'Toda la serie',
                description: 'Se modificarán todas las sesiones futuras de esta serie. Las sesiones anteriores o canceladas no cambiarán.',
            },
        ]);
        expect(JSON.stringify(RECURRING_RESCHEDULE_SCOPE_OPTIONS)).not.toContain('Esta y las siguientes');
        expect(JSON.stringify(RECURRING_RESCHEDULE_SCOPE_OPTIONS)).not.toContain('following');
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
                scope: 'series',
                problematicSlot: { date: '2026-10-04', time: '19:00' },
            },
        }, 'fallback')).toMatch(/04\/10\/2026.*19:00.*completa/i);
        expect(getRecurringRescheduleErrorMessage({
            details: { reason: 'slot_blocked', problematicSlot: { date: '2026-09-20', time: '19:00' } },
        }, 'fallback')).toMatch(/bloqueada/i);
    });

    it('excludes a pending appointment from its own conflict without granting occupancy credit', () => {
        const pending = {
            ...appointment('pending-self', 0, '2026-09-20', 'pending'),
            recurrenceSeriesId: undefined,
            approvedSlot: undefined,
            preferredSlots: [{ date: '2026-09-20', time: '18:00' }],
        };
        const context = buildRescheduleCalendarContext([pending], pending.userId, new Set([pending.id]));

        expect(context.userBookedSlotKeys.size).toBe(0);
        expect(context.occupancyCreditsByKey.size).toBe(0);
    });

    it('keeps other pending and approved appointments from the same customer as conflicts', () => {
        const selectedPending = {
            ...appointment('pending-self', 0, '2026-09-20', 'pending'),
            recurrenceSeriesId: undefined,
            approvedSlot: undefined,
        };
        const otherPending = {
            ...appointment('pending-other', 1, '2026-09-21', 'pending'),
            recurrenceSeriesId: undefined,
            approvedSlot: undefined,
        };
        const otherApproved = {
            ...appointment('approved-other', 2, '2026-09-22'),
            recurrenceSeriesId: undefined,
        };
        const context = buildRescheduleCalendarContext(
            [selectedPending, otherPending, otherApproved],
            selectedPending.userId,
            new Set([selectedPending.id]),
        );

        expect(context.userBookedSlotKeys).toContain('2026-09-21_10:00');
        expect(context.userBookedSlotKeys).toContain('2026-09-22_10:00');
        expect(context.userBookedSlotKeys).not.toContain('2026-09-20_10:00');
    });

    it('credits an excluded approved appointment across every covered block', () => {
        const selectedApproved = {
            ...selected,
            recurrenceSeriesId: undefined,
            approvedSlot: { date: '2026-09-14', time: '10:00' },
        };
        const context = buildRescheduleCalendarContext(
            [selectedApproved],
            selectedApproved.userId,
            new Set([selectedApproved.id]),
        );

        expect(context.userBookedSlotKeys.size).toBe(0);
        expect([...context.occupancyCreditsByKey.entries()]).toEqual([
            ['2026-09-14_10:00', 1],
            ['2026-09-14_10:15', 1],
            ['2026-09-14_10:30', 1],
            ['2026-09-14_10:45', 1],
        ]);
    });

    it('keeps a partially occupied recurring slot selectable across all duration blocks', () => {
        const result = getRecurringRescheduleSlotAvailability({
            appointments,
            selected,
            excludedAppointmentIds: new Set([selected.id]),
            slot: { date: '2026-09-20', time: '18:00' },
            durationMinutes: 60,
            occupancy: {
                '2026-09-20_18:00': 1,
                '2026-09-20_18:15': 1,
                '2026-09-20_18:30': 1,
                '2026-09-20_18:45': 1,
            },
            blockedSlotKeys: new Set(),
            maxCapacity: 3,
        });

        expect(result).toEqual({ disabled: false, reason: null, occupancy: 1 });
    });

    it('disables a recurring slot when any covered duration block is full', () => {
        const result = getRecurringRescheduleSlotAvailability({
            appointments,
            selected,
            excludedAppointmentIds: new Set([selected.id]),
            slot: { date: '2026-09-20', time: '18:00' },
            durationMinutes: 45,
            occupancy: {
                '2026-09-20_18:00': 1,
                '2026-09-20_18:15': 1,
                '2026-09-20_18:30': 3,
            },
            blockedSlotKeys: new Set(),
            maxCapacity: 3,
        });

        expect(result).toEqual({ disabled: true, reason: 'slot_full', occupancy: 3 });
    });

    it('ignores another customer pending appointment for recurring capacity and conflicts', () => {
        const otherPending = {
            ...appointment('other-pending', 9, '2026-09-20', 'pending'),
            userId: 'user-2',
            recurrenceSeriesId: 'series-2',
            approvedSlot: undefined,
            preferredSlots: [{ date: '2026-09-20', time: '18:00' }],
        };
        const result = getRecurringRescheduleSlotAvailability({
            appointments: [...appointments, otherPending],
            selected,
            excludedAppointmentIds: new Set([selected.id]),
            slot: { date: '2026-09-20', time: '18:00' },
            durationMinutes: 30,
            occupancy: {},
            blockedSlotKeys: new Set(),
            maxCapacity: 3,
        });

        expect(result.disabled).toBe(false);
    });

    it.each(['pending', 'approved'] as const)(
        'blocks a recurring slot that overlaps the same customer %s appointment',
        (status) => {
            const ownAppointment = {
                ...appointment(`own-${status}`, 9, '2026-09-20', status),
                recurrenceSeriesId: 'series-2',
                approvedSlot: status === 'approved' ? { date: '2026-09-20', time: '18:00' } : undefined,
                preferredSlots: [{ date: '2026-09-20', time: '18:00' }],
            };
            const result = getRecurringRescheduleSlotAvailability({
                appointments: [...appointments, ownAppointment],
                selected,
                excludedAppointmentIds: new Set([selected.id]),
                slot: { date: '2026-09-20', time: '18:00' },
                durationMinutes: 30,
                occupancy: status === 'approved' ? { '2026-09-20_18:00': 1 } : {},
                blockedSlotKeys: new Set(),
                maxCapacity: 3,
            });

            expect(result.reason).toBe('appointment_conflict');
        },
    );

    it('credits exactly the approved occurrences excluded by single and series', () => {
        const singleExcluded = getRecurringRescheduleExcludedAppointmentIds(appointments, selected, 'single', now);
        const seriesExcluded = getRecurringRescheduleExcludedAppointmentIds(appointments, selected, 'series', now);
        const laterSelected = appointments.find((appointment) => appointment.id === 'a3')!;
        const laterSeriesExcluded = getRecurringRescheduleExcludedAppointmentIds(appointments, laterSelected, 'series', now);
        const base = {
            appointments,
            selected,
            durationMinutes: 60 as const,
            blockedSlotKeys: new Set<string>(),
            maxCapacity: 1,
        };

        expect(getRecurringRescheduleSlotAvailability({
            ...base,
            excludedAppointmentIds: singleExcluded,
            slot: { date: '2026-09-14', time: '10:00' },
            occupancy: { '2026-09-14_10:00': 1, '2026-09-14_10:15': 1, '2026-09-14_10:30': 1, '2026-09-14_10:45': 1 },
        }).disabled).toBe(false);

        expect(getRecurringRescheduleSlotAvailability({
            ...base,
            excludedAppointmentIds: seriesExcluded,
            slot: { date: '2026-09-28', time: '10:00' },
            occupancy: { '2026-09-28_10:00': 1, '2026-09-28_10:15': 1, '2026-09-28_10:30': 1, '2026-09-28_10:45': 1 },
        }).disabled).toBe(false);

        expect(getRecurringRescheduleSlotAvailability({
            ...base,
            selected: laterSelected,
            excludedAppointmentIds: laterSeriesExcluded,
            slot: { date: '2026-09-14', time: '10:00' },
            occupancy: { '2026-09-14_10:00': 1, '2026-09-14_10:15': 1, '2026-09-14_10:30': 1, '2026-09-14_10:45': 1 },
        }).disabled).toBe(false);

        expect(getRecurringRescheduleSlotAvailability({
            ...base,
            excludedAppointmentIds: singleExcluded,
            slot: { date: '2026-09-28', time: '10:00' },
            occupancy: { '2026-09-28_10:00': 1, '2026-09-28_10:15': 1, '2026-09-28_10:30': 1, '2026-09-28_10:45': 1 },
        }).reason).toBe('appointment_conflict');
    });
});
