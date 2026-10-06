import { describe, expect, it } from 'vitest';
import {
    canProposeAlternative,
    customerConfirmationBadge,
    formatSlotLabel,
    hasProfessionalConflict,
    trainersForAppointmentType,
} from './appointment-types';
import { filterAppointments } from './admin-appointment-filters';
import { getAppointmentType, type Appointment, type Trainer } from '@/types';

function appointment(overrides: Partial<Appointment> = {}): Appointment {
    return {
        id: 'a1',
        userId: 'u1',
        name: 'Lucía',
        email: 'lucia@example.com',
        phone: '',
        serviceType: 'Bono',
        duration: '30',
        preferredSlots: [{ date: '2026-10-12', time: '10:00' }],
        reason: '',
        status: 'pending',
        createdAt: '2026-10-01T00:00:00Z',
        ...overrides,
    };
}

describe('appointment types', () => {
    it('treats appointments without a type as training', () => {
        expect(getAppointmentType(appointment())).toBe('training');
        expect(getAppointmentType(appointment({ appointmentType: 'nutrition' }))).toBe('nutrition');
    });

    it('filters by type, legacy appointments counting as training', () => {
        const list = [appointment({ id: 'legacy' }), appointment({ id: 'n', appointmentType: 'nutrition' })];
        const ids = (typeFilter: 'all' | 'training' | 'nutrition') => filterAppointments(list, {
            statusFilter: 'all', trainerFilter: 'all', typeFilter, search: '',
        }).map((item) => item.id);
        expect(ids('all')).toEqual(['legacy', 'n']);
        expect(ids('training')).toEqual(['legacy']);
        expect(ids('nutrition')).toEqual(['n']);
        expect(filterAppointments(list, { statusFilter: 'all', trainerFilter: 'all', search: '' })).toHaveLength(2);
    });

    it('offers only active, nutrition-enabled professionals for nutrition', () => {
        const trainers = [
            { id: 't1', name: 'Ana', active: true },
            { id: 't2', name: 'Nora', active: true, offersNutrition: true },
            { id: 't3', name: 'Off', active: false, offersNutrition: true },
        ] as Trainer[];
        expect(trainersForAppointmentType(trainers, 'training').map((t) => t.id)).toEqual(['t1', 't2']);
        expect(trainersForAppointmentType(trainers, 'nutrition').map((t) => t.id)).toEqual(['t2']);
    });

    it('detects overlapping appointments of the same professional', () => {
        const list = [
            appointment({ id: 'busy', status: 'approved', assignedTrainer: 'n1', approvedSlot: { date: '2026-10-12', time: '10:15' } }),
            appointment({ id: 'gone', status: 'cancelled', assignedTrainer: 'n1', preferredSlots: [{ date: '2026-10-12', time: '11:00' }] }),
        ];
        const check = (time: string, excludeAppointmentId?: string) => hasProfessionalConflict(list, {
            trainerId: 'n1', slot: { date: '2026-10-12', time }, durationMinutes: 30, excludeAppointmentId,
        });
        expect(check('10:00')).toBe(true);
        expect(check('10:00', 'busy')).toBe(false);
        expect(check('10:45')).toBe(false);
        expect(check('11:00')).toBe(false);
    });

    it('marks appointments waiting for the customer and when a proposal is possible', () => {
        const proposal = appointment({ customerConfirmation: { kind: 'proposal', requestedAt: 'x', requestedBy: 'admin', response: null } });
        const renewal = appointment({ customerConfirmation: { kind: 'renewal', requestedAt: 'x', requestedBy: 'admin', response: null } });
        const answered = appointment({ status: 'approved', customerConfirmation: { kind: 'renewal', requestedAt: 'x', requestedBy: 'admin', response: 'accepted' } });
        expect(customerConfirmationBadge(appointment())).toBeNull();
        expect(customerConfirmationBadge(proposal)).toBe('proposal_pending');
        expect(customerConfirmationBadge(renewal)).toBe('renewal_pending');
        expect(customerConfirmationBadge(answered)).toBeNull();
        expect(canProposeAlternative(appointment())).toBe(true);
        expect(canProposeAlternative(proposal)).toBe(true);
        expect(canProposeAlternative(renewal)).toBe(false);
        expect(canProposeAlternative(appointment({ recurrenceSeriesId: 's' }))).toBe(false);
        expect(canProposeAlternative(appointment({ status: 'approved' }))).toBe(false);
    });

    it('formats civil slots without timezone drift', () => {
        expect(formatSlotLabel({ date: '2026-10-12', time: '10:00' })).toMatch(/12 oct.* · 10:00/);
    });
});
