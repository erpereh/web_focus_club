import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityException } from '@/lib/capacity-exceptions';

const upsert = vi.fn();
const remove = vi.fn();
let emitExceptions: (items: CapacityException[]) => void = () => undefined;

vi.mock('@/lib/firestore', () => ({
    subscribeCapacityExceptionsInRange: (_start: string, _end: string | undefined, callback: (items: CapacityException[]) => void) => {
        emitExceptions = callback;
        callback([{ date: '2026-10-20', maxCapacity: 2 }]);
        return vi.fn();
    },
    upsertCapacityExceptionsFromAdmin: (...args: unknown[]) => upsert(...args),
    deleteCapacityExceptionsFromAdmin: (...args: unknown[]) => remove(...args),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: () => ({ dismiss: vi.fn() }) }));

import { CapacityExceptionsCard } from './CapacityExceptionsCard';

const renderCard = (enabled = true) => render(
    <CapacityExceptionsCard globalCapacity={4} enabled={enabled} todayKey="2026-10-14" />,
);
const day = (name: RegExp) => screen.getByRole('button', { name });

describe('CapacityExceptionsCard', () => {
    beforeEach(() => {
        upsert.mockReset().mockResolvedValue({ success: true });
        remove.mockReset().mockResolvedValue({ success: true });
    });

    it('shows the days with their own capacity and disables past days', () => {
        renderCard();
        expect(day(/^20 de octubre de 2026, aforo 2$/)).toHaveTextContent('Aforo 2');
        expect(day(/^13 de octubre de 2026$/)).toBeDisabled();
        expect(day(/^14 de octubre de 2026$/)).toBeEnabled();
        expect(screen.getByRole('list', { name: 'Próximas excepciones' })).toHaveTextContent('Aforo 2');
    });

    it('applies one capacity to several selected days in a single request', async () => {
        renderCard();
        fireEvent.click(day(/^22 de octubre de 2026$/));
        fireEvent.click(day(/^21 de octubre de 2026$/));
        expect(day(/^21 de octubre de 2026$/)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('2 días seleccionados.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Aforo para los días seleccionados'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar aforo/ }));

        await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
        expect(upsert.mock.calls[0][0]).toMatchObject({ dates: ['2026-10-21', '2026-10-22'], maxCapacity: 2 });
        expect(typeof upsert.mock.calls[0][0].requestId).toBe('string');
        await waitFor(() => expect(screen.getByText('Ningún día seleccionado.')).toBeInTheDocument());
    });

    it('asks to confirm a reduction below approved seats and resends with the fingerprint', async () => {
        upsert.mockRejectedValueOnce(Object.assign(new Error('confirm'), {
            details: {
                reason: 'capacity_reduction_confirmation_required',
                fingerprint: 'fp-1',
                changed: false,
                restrictions: [{ date: '2026-10-21', time: '10:00', reason: 'capacity_below_occupancy', occupancy: 3, maxCapacity: 1 }],
            },
        }));
        renderCard();
        fireEvent.click(day(/^21 de octubre de 2026$/));
        fireEvent.change(screen.getByLabelText('Aforo para los días seleccionados'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar aforo/ }));

        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent('El nuevo aforo es menor que las citas aprobadas');
        expect(dialog).toHaveTextContent('no se cancelan ni se modifican');
        expect(dialog).toHaveTextContent('3 aprobadas con aforo 1');
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

        await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
        const [first, second] = upsert.mock.calls.map((call) => call[0]);
        expect(second).toMatchObject({ dates: ['2026-10-21'], maxCapacity: 1, acknowledgedRestrictions: 'fp-1' });
        expect(second.requestId).toBe(first.requestId);
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('edits an exception from the list and deletes another', async () => {
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: 'Editar el aforo del 20 de octubre de 2026' }));
        expect(day(/^20 de octubre de 2026, aforo 2$/)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Aforo para los días seleccionados')).toHaveValue(2);
        fireEvent.change(screen.getByLabelText('Aforo para los días seleccionados'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /Guardar aforo/ }));
        await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ dates: ['2026-10-20'], maxCapacity: 3 })));

        fireEvent.click(screen.getByRole('button', { name: 'Eliminar el aforo del 20 de octubre de 2026' }));
        await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ dates: ['2026-10-20'] })));
    });

    it('removes the exception of the selected days that have one', async () => {
        renderCard();
        act(() => emitExceptions([{ date: '2026-10-20', maxCapacity: 2 }, { date: '2026-10-23', maxCapacity: 5 }]));
        fireEvent.click(day(/^20 de octubre de 2026, aforo 2$/));
        fireEvent.click(day(/^21 de octubre de 2026$/));
        fireEvent.click(day(/^23 de octubre de 2026, aforo 5$/));
        fireEvent.click(screen.getByRole('button', { name: /Quitar excepción/ }));
        await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ dates: ['2026-10-20', '2026-10-23'] })));
    });

    it('cannot create exceptions until the feature is enabled, but can still delete them', async () => {
        renderCard(false);
        expect(screen.getByRole('status')).toHaveTextContent('todavía no está activado');
        fireEvent.click(day(/^21 de octubre de 2026$/));
        expect(screen.getByRole('button', { name: /Guardar aforo/ })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar el aforo del 20 de octubre de 2026' }));
        await waitFor(() => expect(remove).toHaveBeenCalled());
        expect(upsert).not.toHaveBeenCalled();
    });
});
