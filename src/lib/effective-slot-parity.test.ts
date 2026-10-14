import { describe, expect, it } from 'vitest';
import fixture from '../../functions/test/fixtures/effective-slot.json';
import { getAppointmentEffectiveSlot } from './madrid-date';
import { appointmentEffectiveSlot } from './admin-slot-status';
import { overlapsBlockedSelection, getBlockedSelectionKeys } from './blocked-slots';
import { resolveAppointmentSchedule } from '@/components/admin/appointments/appointment-calendar-utils';
import type { Appointment } from '@/types';

// Web half of the effective-slot parity check (server half:
// functions/test/effectiveSlot.test.cjs). Every web resolver must agree.
describe('effective slot parity (web = server = app)', () => {
    for (const testCase of fixture.cases) {
        it(testCase.name, () => {
            const appointment = testCase.appointment as unknown as Appointment;
            expect(getAppointmentEffectiveSlot(appointment) ?? null).toEqual(testCase.expected);
            expect(appointmentEffectiveSlot(appointment) ?? null).toEqual(testCase.expected);
            const schedule = resolveAppointmentSchedule(appointment);
            expect(schedule ? { date: schedule.date, time: schedule.time } : null).toEqual(testCase.expected);
        });
    }
});

describe('legacy pending with a leftover approvedSlot', () => {
    const stale = {
        id: 'a',
        userId: 'u',
        name: '',
        email: '',
        phone: '',
        serviceType: '',
        reason: '',
        createdAt: '',
        status: 'pending',
        approvedSlot: { date: '2030-01-15', time: '12:00' },
        preferredSlots: [{ date: '2030-01-15', time: '10:00' }],
        duration: '60',
    } as Appointment;

    it('is detected by delete-on-block at its requested slot, not the old one', () => {
        expect(overlapsBlockedSelection(stale, getBlockedSelectionKeys('2030-01-15', ['10:30'], 15))).toBe(true);
        expect(overlapsBlockedSelection(stale, getBlockedSelectionKeys('2030-01-15', ['12:00'], 15))).toBe(false);
    });

    it('approved appointments still use approvedSlot', () => {
        const approved = { ...stale, status: 'approved' as const };
        expect(overlapsBlockedSelection(approved, getBlockedSelectionKeys('2030-01-15', ['12:00'], 15))).toBe(true);
    });
});
