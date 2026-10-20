import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminOverrideConfirmModal } from './AdminOverrideConfirmModal';
import type { AdminOverridePrompt } from '@/lib/admin-booking-overrides';

const seriesPrompt: AdminOverridePrompt = {
    fingerprint: 'fp-1',
    requiresPastConfirmation: false,
    changed: false,
    restrictions: [
        { date: '2026-11-03', time: '10:00', reason: 'slot_blocked' },
        { date: '2026-10-20', time: '10:00', reason: 'slot_full', occupancy: 4, maxCapacity: 4 },
        { date: '2026-10-20', time: '10:00', reason: 'booking_notice_too_short' },
    ],
};

describe('AdminOverrideConfirmModal', () => {
    it('lists every affected date in order with its reasons and capacity', () => {
        render(
            <AdminOverrideConfirmModal prompt={seriesPrompt} isSeries totalSessions={4} saving={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );
        expect(screen.getByRole('alertdialog')).toHaveTextContent('La serie tiene restricciones');
        expect(screen.getByText(/2 de 4 sesiones/)).toBeInTheDocument();
        const dates = within(screen.getByRole('list', { name: 'Fechas afectadas' })).getAllByRole('listitem')
            .filter((item) => item.parentElement?.getAttribute('aria-label') === 'Fechas afectadas');
        expect(dates).toHaveLength(2);
        expect(dates[0]).toHaveTextContent(/20 de octubre de 2026 · 10:00/);
        expect(dates[0]).toHaveTextContent('Aforo completo: 4/4 personas (quedaría en 5/4)');
        expect(dates[0]).toHaveTextContent('Antelación mínima insuficiente');
        expect(dates[1]).toHaveTextContent(/3 de noviembre de 2026/);
        expect(dates[1]).toHaveTextContent('Franja bloqueada');
    });

    it('sends the fingerprint on confirm and lets the admin cancel', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<AdminOverrideConfirmModal prompt={seriesPrompt} isSeries={false} saving={false} onConfirm={onConfirm} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
        expect(onConfirm).toHaveBeenCalledWith({ fingerprint: 'fp-1', confirmPastDate: false });
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(onCancel).toHaveBeenCalled();
    });

    it('requires the explicit past-date checkbox before confirming', () => {
        const onConfirm = vi.fn();
        const prompt: AdminOverridePrompt = {
            fingerprint: 'fp-past',
            requiresPastConfirmation: true,
            changed: false,
            restrictions: [{ date: '2026-10-13', time: '18:00', reason: 'slot_not_future' }],
        };
        render(<AdminOverrideConfirmModal prompt={prompt} isSeries={false} saving={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
        const confirm = screen.getByRole('button', { name: 'Confirmar' });
        expect(confirm).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox'));
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledWith({ fingerprint: 'fp-past', confirmPastDate: true });
    });

    it('disables both buttons while saving to prevent double submissions', () => {
        render(<AdminOverrideConfirmModal prompt={seriesPrompt} isSeries={false} saving onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Guardando/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    });

    it('warns when conditions changed and asks for a fresh confirmation', () => {
        const prompt: AdminOverridePrompt = {
            ...seriesPrompt,
            fingerprint: 'fp-2',
            changed: true,
            requiresPastConfirmation: true,
            restrictions: [{ date: '2026-10-13', time: '18:00', reason: 'slot_not_future' }],
        };
        const { rerender } = render(
            <AdminOverrideConfirmModal prompt={{ ...prompt, fingerprint: 'fp-1', changed: false }} isSeries={false} saving={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
        );
        fireEvent.click(screen.getByRole('checkbox'));
        rerender(<AdminOverrideConfirmModal prompt={prompt} isSeries={false} saving={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText(/Las condiciones han cambiado/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    });
});
