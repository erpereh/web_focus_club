import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarAvailabilityState, InteractiveCalendarProps } from '@/components/ui/interactive-calendar';
import type { RenewalItem } from '@/lib/firestore';
import type { Bono, UserProfile } from '@/types';

const fs = vi.hoisted(() => ({
    bonos: [] as Bono[],
    seriesCount: 0,
    previewResponses: [] as Array<{ items: RenewalItem[] }>,
    commitResponses: [] as unknown[],
    calls: [] as Array<[string, unknown]>,
}));

vi.mock('@/lib/firestore', () => ({
    getBonosByUser: vi.fn(async () => fs.bonos),
    countApprovedSeriesForBono: vi.fn(async () => fs.seriesCount),
    deactivateBono: vi.fn(async (id: string) => { fs.calls.push(['deactivateBono', id]); }),
    assignBono: vi.fn(async (data: unknown) => { fs.calls.push(['assignBono', data]); return 'bono-new'; }),
    addActivityLog: vi.fn(async () => undefined),
    previewBonoAppointmentRenewalFromAdmin: vi.fn(async (input: unknown) => {
        fs.calls.push(['preview', input]);
        return fs.previewResponses.shift() ?? { items: [] };
    }),
    commitBonoAppointmentRenewalFromAdmin: vi.fn(async (input: unknown) => {
        fs.calls.push(['commit', input]);
        return fs.commitResponses.shift();
    }),
}));

vi.mock('@/components/ui/interactive-calendar', () => ({
    InteractiveCalendar: (props: InteractiveCalendarProps) => {
        useEffect(() => {
            props.onAvailabilityStateChange?.({ status: 'ready', message: null } as CalendarAvailabilityState);
        }, [props.onAvailabilityStateChange]);
        return (
            <button type="button" onClick={() => props.onSelectSlot({ date: '2026-10-23', time: '18:00' })}>
                Elegir 23 octubre 18:00
            </button>
        );
    },
}));

import { AssignBonoModal } from './AssignBonoModal';

const client = { uid: 'user-1', name: 'Lucía', email: 'lucia@example.com', role: 'user', createdAt: '' } as UserProfile;
const previousBono = {
    id: 'bono-old', userId: 'user-1', tamano: 480, minutosTotales: 480, minutosRestantes: 60,
    fechaAsignacion: '2026-09-09', fechaExpiracion: '2026-10-08', estado: 'activo', historial: [],
    asignadoPor: 'admin', createdAt: '2026-09-09T00:00:00Z',
} as Bono;

function item(key: string, date: string, overrides: Partial<RenewalItem> = {}): RenewalItem {
    const slot = { date, time: '18:00' };
    return {
        key, sourceSeriesId: 's1', originalSlot: slot, slot, durationMinutes: 60,
        trainerId: 't1', trainerName: 'Ana', serviceType: 'Bono', sessionType: '', status: 'ready', ...overrides,
    };
}

function renderModal(overrides: Partial<Parameters<typeof AssignBonoModal>[0]> = {}) {
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(
        <AssignBonoModal
            client={client}
            activeBono={previousBono}
            sizes={[240, 360, 480, 600, 720]}
            defaultStartDate="2026-10-09"
            defaultEndDate="2026-11-08"
            buildDates={(start, end) => ({ fechaAsignacion: `${start}T00:00`, fechaExpiracion: `${end}T23:59` })}
            trainers={[{ id: 't1', uid: 't1', name: 'Ana', active: true, createdAt: '' }]}
            appointments={[]}
            adminEmail="admin@example.com"
            onClose={onClose}
            onAssigned={onAssigned}
            {...overrides}
        />,
    );
    return { onAssigned, onClose };
}

describe('AssignBonoModal', () => {
    beforeEach(() => {
        fs.bonos = [previousBono];
        fs.seriesCount = 1;
        fs.previewResponses = [];
        fs.commitResponses = [];
        fs.calls = [];
    });

    it('offers the configured sizes instead of a hardcoded 4h/6h/8h', async () => {
        renderModal();
        for (const label of ['4h / mes', '6h / mes', '8h / mes', '10h / mes', '12h / mes']) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
        fireEvent.click(screen.getByRole('button', { name: '10h / mes' }));
        expect(screen.getByText('10h (600 min)')).toBeInTheDocument();
    });

    it('assigns the bono without renewal when the option is not used', async () => {
        const { onAssigned, onClose } = renderModal();
        await screen.findByText('Repetir citas del bono anterior');
        fireEvent.click(screen.getByRole('button', { name: '12h / mes' }));
        fireEvent.click(screen.getByRole('button', { name: /Asignar Bono/ }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(fs.calls.map(([name]) => name)).toEqual(['deactivateBono', 'assignBono']);
        expect(fs.calls[1][1]).toMatchObject({ tamano: 720, minutosTotales: 720, minutosRestantes: 720, estado: 'activo' });
        expect(onAssigned).toHaveBeenCalled();
    });

    it('hides the renewal option when there is no previous recurring pattern', async () => {
        fs.seriesCount = 0;
        renderModal();
        await waitFor(() => expect(fs.calls).toEqual([]));
        expect(screen.queryByText('Repetir citas del bono anterior')).not.toBeInTheDocument();
    });

    it('previews, resolves conflicts (skip + reschedule) and creates the renewal as pending', async () => {
        fs.previewResponses = [
            { items: [
                item('a', '2026-10-15'),
                item('b', '2026-10-22', { status: 'conflict', reason: 'slot_full' }),
                item('c', '2026-10-29', { status: 'conflict', reason: 'slot_blocked' }),
            ] },
            // after skipping "c"
            { items: [
                item('a', '2026-10-15'),
                item('b', '2026-10-22', { status: 'conflict', reason: 'slot_full' }),
            ] },
            // after moving "b" to 23 Oct
            { items: [
                item('a', '2026-10-15'),
                { ...item('b', '2026-10-22'), slot: { date: '2026-10-23', time: '18:00' }, modified: true, status: 'ready' },
            ] },
        ];
        const { onAssigned } = renderModal();
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /Previsualizar citas/ }));

        expect(await screen.findByText('Franja completa (aforo máximo)')).toBeInTheDocument();
        expect(screen.getByText('Franja bloqueada')).toBeInTheDocument();
        const confirm = screen.getByRole('button', { name: /Confirmar renovación/ });
        expect(confirm).toBeDisabled();

        fireEvent.click(within(screen.getByTestId('renewal-row-c')).getByRole('button', { name: /Omitir esta cita/ }));
        await waitFor(() => expect(within(screen.getByTestId('renewal-row-c')).getByText('Omitida')).toBeInTheDocument());

        fireEvent.click(within(screen.getByTestId('renewal-row-b')).getByRole('button', { name: /Cambiar fecha\/hora/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Elegir 23 octubre 18:00' }));
        fireEvent.click(screen.getByRole('button', { name: /Validar y usar esta franja/ }));
        await waitFor(() => expect(within(screen.getByTestId('renewal-row-b')).getByText('Lista (modificada)')).toBeInTheDocument());

        fs.commitResponses = [{
            success: true,
            renewalId: 'x',
            created: [
                { ...item('a', '2026-10-15'), status: 'created', appointmentId: 'ap1' },
                { ...item('b', '2026-10-22'), slot: { date: '2026-10-23', time: '18:00' }, modified: true, status: 'created', appointmentId: 'ap2' },
            ],
            alreadyCreated: [],
            conflicts: [],
        }];
        fireEvent.click(screen.getByRole('button', { name: /Confirmar renovación/ }));
        const summary = await screen.findByTestId('renewal-summary');
        expect(within(summary).getByText(/Citas creadas como pendientes \(2\)/)).toBeInTheDocument();
        expect(within(summary).getByText(/Modificadas respecto al patrón original \(1\)/)).toBeInTheDocument();
        expect(within(summary).getByText(/Omitidas \(1\)/)).toBeInTheDocument();
        expect(within(summary).getByText(/Franja bloqueada/)).toBeInTheDocument();
        expect(onAssigned).toHaveBeenCalled();

        const commit = fs.calls.find(([name]) => name === 'commit')?.[1] as { items: RenewalItem[]; skipped: unknown[]; bonoId: string };
        expect(commit.bonoId).toBe('bono-new');
        expect(commit.items.map((entry) => entry.key)).toEqual(['a', 'b']);
        expect(commit.skipped).toEqual([{ key: 'c', originalSlot: { date: '2026-10-29', time: '18:00' }, reason: 'slot_blocked' }]);
        // The revalidation after the manual change sent the new slot.
        const lastPreview = fs.calls.filter(([name]) => name === 'preview').at(-1)?.[1] as { items: RenewalItem[] };
        expect(lastPreview.items.find((entry) => entry.key === 'b')?.slot).toEqual({ date: '2026-10-23', time: '18:00' });
    });

    it('keeps the picker open when the new slot is still not valid', async () => {
        fs.previewResponses = [
            { items: [item('b', '2026-10-22', { status: 'conflict', reason: 'slot_full' })] },
            { items: [{ ...item('b', '2026-10-22'), slot: { date: '2026-10-23', time: '18:00' }, status: 'conflict', reason: 'slot_blocked' }] },
        ];
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /Previsualizar citas/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Cambiar fecha\/hora/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Elegir 23 octubre 18:00' }));
        fireEvent.click(screen.getByRole('button', { name: /Validar y usar esta franja/ }));
        expect(await screen.findByText(/No se puede usar esta franja: franja bloqueada/)).toBeInTheDocument();
    });

    it('a race at commit time keeps the modal open to resolve and retry without reassigning the bono', async () => {
        fs.previewResponses = [{ items: [item('a', '2026-10-15'), item('b', '2026-10-22')] }];
        fs.commitResponses = [{
            success: true, renewalId: 'x',
            created: [{ ...item('a', '2026-10-15'), status: 'created', appointmentId: 'ap1' }],
            alreadyCreated: [],
            conflicts: [{ ...item('b', '2026-10-22'), status: 'conflict', reason: 'slot_full' }],
        }];
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /Previsualizar citas/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Confirmar renovación/ }));
        expect(await screen.findByText(/algunas citas ya no estaban disponibles/)).toBeInTheDocument();
        expect(within(screen.getByTestId('renewal-row-a')).getByText(/Creada/)).toBeInTheDocument();

        fs.previewResponses = [{ items: [] }];
        fireEvent.click(within(screen.getByTestId('renewal-row-b')).getByRole('button', { name: /Omitir esta cita/ }));
        fs.commitResponses = [{ success: true, renewalId: 'x', created: [], alreadyCreated: [], conflicts: [] }];
        await waitFor(() => expect(screen.getByRole('button', { name: /Reintentar las citas pendientes/ })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: /Reintentar las citas pendientes/ }));
        await screen.findByTestId('renewal-summary');
        expect(fs.calls.filter(([name]) => name === 'assignBono')).toHaveLength(1);
        const commits = fs.calls.filter(([name]) => name === 'commit').map(([, input]) => input as { renewalId: string });
        expect(commits).toHaveLength(2);
        expect(commits[0].renewalId).toBe(commits[1].renewalId);
    });
});
