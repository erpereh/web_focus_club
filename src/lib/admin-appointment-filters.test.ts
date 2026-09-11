import { describe, expect, it } from 'vitest';
import {
    filterAppointments,
    toTrainerFilter,
    type FilterableAppointment,
} from './admin-appointment-filters';

const sandraId = 'trainer-sandra';
const unknownId = 'trainerIdAntiguo';

function appointment(overrides: Partial<FilterableAppointment> & { id: string }): FilterableAppointment & { id: string } {
    return {
        name: 'Cliente',
        email: 'cliente@example.com',
        status: 'pending',
        ...overrides,
    };
}

const appointments = [
    appointment({ id: 'pending-unassigned', name: 'Isa', email: 'isa@example.com', status: 'pending' }),
    appointment({ id: 'pending-empty', name: 'Ana', email: 'ana@example.com', status: 'pending', assignedTrainer: '' }),
    appointment({
        id: 'pending-sandra',
        name: 'Isa',
        email: 'isa.sandra@example.com',
        status: 'pending',
        assignedTrainer: sandraId,
    }),
    appointment({
        id: 'approved-sandra',
        name: 'Marta',
        email: 'marta@example.com',
        status: 'approved',
        assignedTrainer: sandraId,
    }),
    appointment({
        id: 'approved-unassigned',
        name: 'Luis',
        email: 'luis@example.com',
        status: 'approved',
    }),
    appointment({
        id: 'approved-unknown',
        name: 'Pablo',
        email: 'pablo@example.com',
        status: 'approved',
        assignedTrainer: unknownId,
    }),
];

function ids(result: Array<{ id: string }>) {
    return result.map((item) => item.id);
}

describe('filterAppointments', () => {
    it('returns every appointment when status and trainer are all and search is empty', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: 'all',
            search: '',
        }))).toEqual(ids(appointments));
    });

    it('keeps only appointments with the exact assignedTrainer id', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: toTrainerFilter(sandraId),
            search: '',
        }))).toEqual(['pending-sandra', 'approved-sandra']);
    });

    it('keeps only appointments without assignedTrainer', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: 'unassigned',
            search: '',
        }))).toEqual(['pending-unassigned', 'pending-empty', 'approved-unassigned']);
    });

    it('combines status and trainer filters', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'pending',
            trainerFilter: toTrainerFilter(sandraId),
            search: '',
        }))).toEqual(['pending-sandra']);

        expect(ids(filterAppointments(appointments, {
            statusFilter: 'approved',
            trainerFilter: 'unassigned',
            search: '',
        }))).toEqual(['approved-unassigned']);
    });

    it('combines search and trainer filters', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: toTrainerFilter(sandraId),
            search: 'Isa',
        }))).toEqual(['pending-sandra']);
    });

    it('keeps appointments assigned to an unknown trainer in all', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: 'all',
            search: '',
        }))).toContain('approved-unknown');
    });

    it('does not treat an unknown trainer as unassigned', () => {
        expect(ids(filterAppointments(appointments, {
            statusFilter: 'all',
            trainerFilter: 'unassigned',
            search: '',
        }))).not.toContain('approved-unknown');
    });
});
