import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarAvailabilityState, InteractiveCalendarProps } from '@/components/ui/interactive-calendar';
import type { Appointment, Trainer } from '@/types';

const calendarProps = vi.hoisted(() => ({ last: undefined as InteractiveCalendarProps | undefined }));

vi.mock('@/components/ui/interactive-calendar', () => ({
    InteractiveCalendar: (props: InteractiveCalendarProps) => {
        calendarProps.last = props;
        useEffect(() => {
            props.onAvailabilityStateChange?.({ status: 'ready', message: null } as CalendarAvailabilityState);
        }, [props.onAvailabilityStateChange]);
        return (
            <button type="button" onClick={() => props.onSelectSlot({ date: '2026-10-13', time: '11:00' })}>
                Elegir franja
            </button>
        );
    },
}));

import { AdminSlotPickerModal } from './AdminSlotPickerModal';

const trainers: Trainer[] = [
    { id: 't1', uid: 't1', name: 'Ana', active: true, createdAt: '' },
    { id: 'n1', uid: 'n1', name: 'Nora', active: true, offersNutrition: true, createdAt: '' },
];

const appointments: Appointment[] = [{
    id: 'other', userId: 'user-2', name: 'Pedro', email: '', phone: '', serviceType: 'Bono', duration: '60',
    preferredSlots: [{ date: '2026-10-13', time: '09:00' }], approvedSlot: { date: '2026-10-13', time: '09:00' },
    reason: '', status: 'approved', assignedTrainer: 't1', createdAt: '',
}, {
    id: 'own', userId: 'user-1', name: 'Lucía', email: '', phone: '', serviceType: 'Bono', duration: '30',
    preferredSlots: [{ date: '2026-10-20', time: '10:00' }], reason: '', status: 'pending', createdAt: '',
}];

describe('AdminSlotPickerModal', () => {
    it('requires a nutrition professional and only offers eligible ones', async () => {
        const onConfirm = vi.fn(async () => undefined);
        render(
            <AdminSlotPickerModal
                title="Proponer otra hora"
                confirmLabel="Enviar propuesta"
                appointmentType="nutrition"
                durationMinutes={30}
                customerUserId="user-1"
                trainers={trainers}
                appointments={appointments}
                onConfirm={onConfirm}
                onClose={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Elegir franja' }));
        expect(screen.getByRole('button', { name: /Enviar propuesta/ })).toBeDisabled();
        // The day panel lists the existing appointments with trainer and status.
        expect(screen.getByText('Pedro')).toBeInTheDocument();
        expect(screen.getByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('Aprobada')).toBeInTheDocument();
        expect(calendarProps.last?.selectedDuration).toBe(30);
        expect(calendarProps.last?.userBookedSlotKeys?.has('2026-10-20_10:00')).toBe(true);
    });

    it('shows the server rejection and keeps the modal open', async () => {
        const onConfirm = vi.fn(async () => { throw new Error('La franja seleccionada está llena.'); });
        render(
            <AdminSlotPickerModal
                title="Proponer otra hora"
                confirmLabel="Enviar propuesta"
                appointmentType="training"
                durationMinutes={60}
                customerUserId="user-1"
                initialTrainerId="t1"
                trainers={trainers}
                appointments={appointments}
                onConfirm={onConfirm}
                onClose={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Elegir franja' }));
        fireEvent.click(screen.getByRole('button', { name: /Enviar propuesta/ }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
            slot: { date: '2026-10-13', time: '11:00' }, trainerId: 't1', trainerName: 'Ana',
        }));
        expect(await screen.findByText('La franja seleccionada está llena.')).toBeInTheDocument();
    });
});
