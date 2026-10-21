import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CancelAppointmentModal, type CancelAppointmentModalProps } from './CancelAppointmentModal';

const consumed: CancelAppointmentModalProps['appointment'] = {
    name: 'Lucía',
    status: 'approved',
    bonoId: 'bono-1',
    minutesDeducted: true,
    minutesDeductedAmount: 45,
    minutesDeductedAt: '2026-10-10T09:00:00.000Z',
    minutesRefundedAt: null,
};

function renderModal(overrides: Partial<CancelAppointmentModalProps> = {}) {
    const props: CancelAppointmentModalProps = {
        appointment: consumed,
        whenLabel: 'mié, 14 oct · 18:00 · 45 min',
        saving: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        ...overrides,
    };
    render(<CancelAppointmentModal {...props} />);
    return props;
}

describe('CancelAppointmentModal', () => {
    it('requires an explicit choice before cancelling (no default modality)', () => {
        const props = renderModal();
        const confirm = screen.getByRole('button', { name: 'Cancelar cita' });
        expect(confirm).toBeDisabled();
        expect(screen.getByRole('radio', { name: /Sin cargo/ })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('radio', { name: /Con cargo/ })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(confirm);
        expect(props.onConfirm).not.toHaveBeenCalled();
    });

    it('explains both outcomes with the minutes the appointment really consumed', () => {
        renderModal();
        expect(screen.getByRole('radio', { name: /Sin cargo/ })).toHaveTextContent('se devuelven 45 min al bono');
        const charged = screen.getByRole('radio', { name: /Con cargo/ });
        expect(charged).toHaveTextContent('se mantienen los 45 min consumidos');
        expect(charged).toHaveTextContent('No cuenta como sesión realizada ni como hora del entrenador');
    });

    it('sends the chosen modality', () => {
        const props = renderModal();
        fireEvent.click(screen.getByRole('radio', { name: /Con cargo/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));
        expect(props.onConfirm).toHaveBeenCalledWith('charged');
        fireEvent.click(screen.getByRole('radio', { name: /Sin cargo/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));
        expect(props.onConfirm).toHaveBeenLastCalledWith('not_charged');
    });

    it('never promises a charge when nothing was deducted (admin-created pending, no bono, nutrition)', () => {
        renderModal({
            appointment: { name: 'Pablo', status: 'pending', bonoId: 'bono-2', minutesDeducted: false },
        });
        expect(screen.getByRole('alertdialog')).toHaveTextContent('Pendiente de aprobación');
        expect(screen.getByRole('radio', { name: /Con cargo/ })).toHaveTextContent('La cita todavía no había descontado minutos del bono.');
        expect(screen.getByRole('radio', { name: /Con cargo/ })).toHaveTextContent('no se cobrará nada adicional');
    });

    it('describes nutrition and appointments without bono', () => {
        renderModal({ appointment: { name: 'Nora', status: 'approved', appointmentType: 'nutrition' } });
        expect(screen.getByRole('radio', { name: /Sin cargo/ })).toHaveTextContent('Las consultas de nutrición no consumen minutos.');
    });

    it('blocks every action while saving and shows the server error', () => {
        const props = renderModal({ saving: true, error: 'La cita ya estaba cancelada con cargo.' });
        expect(screen.getByRole('alert')).toHaveTextContent('La cita ya estaba cancelada con cargo.');
        expect(screen.getByRole('button', { name: 'Volver' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: /Con cargo/ })).toBeDisabled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(props.onCancel).not.toHaveBeenCalled();
    });

    it('closes with Volver or Escape', () => {
        const props = renderModal();
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
        expect(props.onCancel).toHaveBeenCalledTimes(2);
    });
});
