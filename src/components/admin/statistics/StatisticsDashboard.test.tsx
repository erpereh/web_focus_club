import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '@/types';
import type { StatisticsData, StatisticsDataRequest } from '@/lib/firestore';

const getStatisticsData = vi.fn<(request: StatisticsDataRequest) => Promise<StatisticsData>>();

vi.mock('@/lib/firestore', () => ({ getStatisticsData: (request: StatisticsDataRequest) => getStatisticsData(request) }));
// Charts are client-only Recharts components; their maths is covered by admin-statistics tests.
vi.mock('next/dynamic', () => ({ default: () => function ChartStub() { return <div data-testid="chart" />; } }));

import { StatisticsDashboard } from './StatisticsDashboard';

const loaded = () => screen.findByRole('heading', { name: /Resumen general/ });

function appointment(overrides: Partial<Appointment>): Appointment {
    const slot = { date: '2026-10-05', time: '10:00' };
    return {
        id: 'a', userId: 'u1', name: 'Lucía', email: '', phone: '', serviceType: 'Bono', duration: '60',
        preferredSlots: [slot], approvedSlot: slot, date: slot.date, time: slot.time, reason: '',
        status: 'approved', assignedTrainer: 't1', createdAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    } as Appointment;
}

function data(): StatisticsData {
    return {
        appointments: [
            appointment({ id: 'a1' }),
            appointment({
                id: 'a2', status: 'cancelled', cancellationCharge: 'charged', cancellationChargedMinutes: 60,
                approvedSlot: { date: '2026-10-14', time: '18:00' }, date: '2026-10-14', time: '18:00',
            }),
        ],
        trainers: [{ id: 't1', uid: 'c1', name: 'Ana', active: true, createdAt: '' }],
        clients: [{ uid: 'u1', name: 'Lucía', email: 'l@example.com', role: 'user', createdAt: '2026-10-01T00:00:00.000Z' }],
        activeBonos: [],
        bonoHistory: [],
        siteConfig: {
            startHour: 8, endHour: 20, slotInterval: 15, bonoExpirationMonths: 1, maxCapacity: 2,
            bonoSizesMinutes: [240], minBookingNoticeHours: 0, blockSameDayBooking: true,
        },
        blockedSlots: [],
        upcomingOccupancy: [],
        pendingApprovalCount: 2,
    };
}

describe('StatisticsDashboard', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));
        getStatisticsData.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads the current month and its previous period with bounded requests', async () => {
        getStatisticsData.mockResolvedValue(data());
        render(<StatisticsDashboard />);
        expect(await loaded()).toBeInTheDocument();
        expect(getStatisticsData).toHaveBeenCalledWith(expect.objectContaining({
            period: expect.objectContaining({ startKey: '2026-10-01', endKey: '2026-10-31' }),
            previous: expect.objectContaining({ startKey: '2026-09-01', endKey: '2026-09-30' }),
            todayKey: '2026-10-21',
        }));
        expect(screen.getByText(/^Octubre de 2026 · comparado con 1 sept?\.? 2026 – 21 sept?\.? 2026 \(mismo tramo transcurrido\)$/)).toBeInTheDocument();
    });

    it('shows charged cancellations apart from trainer hours', async () => {
        getStatisticsData.mockResolvedValue(data());
        render(<StatisticsDashboard />);
        const kpi = (await screen.findByText('Cancelaciones con cargo', { selector: 'div' })).closest('div.p-5') as HTMLElement;
        expect(within(kpi).getByText('1')).toBeInTheDocument();
        expect(within(kpi).getByText('1 h cobrados sin entrenamiento')).toBeInTheDocument();
        const hours = screen.getByText('Horas contabilizadas de entrenadores').closest('div.p-5') as HTMLElement;
        expect(within(hours).getByText('1 h')).toBeInTheDocument();
        const table = screen.getAllByRole('table').find((element) => element.querySelector('caption')?.textContent?.includes('entrenadores'))!;
        const anaRow = within(table).getByText('Ana').closest('tr') as HTMLElement;
        const cells = within(anaRow).getAllByRole('cell').map((cell) => cell.textContent);
        expect(cells[1]).toContain('1 h');
        expect(cells[2]).toBe('1');
        expect(cells[5]).toBe('11 h');
        expect(within(anaRow).getByRole('link', { name: /Ver citas/ })).toHaveAttribute('href', '/admin?tab=appointments&trainer=t1');
    });

    it('links the review items to the right admin section', async () => {
        getStatisticsData.mockResolvedValue(data());
        render(<StatisticsDashboard />);
        const item = (await screen.findByText('Citas pendientes de aprobación')).closest('li') as HTMLElement;
        expect(within(item).getByRole('link', { name: /Revisar/ })).toHaveAttribute('href', '/admin?tab=appointments&status=pending');
    });

    it('moves between periods and validates custom ranges', async () => {
        getStatisticsData.mockResolvedValue(data());
        render(<StatisticsDashboard />);
        await loaded();
        fireEvent.click(screen.getByRole('button', { name: 'Período anterior' }));
        await waitFor(() => expect(getStatisticsData).toHaveBeenLastCalledWith(expect.objectContaining({
            period: expect.objectContaining({ startKey: '2026-09-01' }),
        })));
        fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2020-01-01' } });
        expect(screen.getByRole('alert')).toHaveTextContent('731 días como máximo');
        fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-15' } });
        await waitFor(() => expect(getStatisticsData).toHaveBeenLastCalledWith(expect.objectContaining({
            period: expect.objectContaining({ kind: 'custom', startKey: '2026-09-15', endKey: '2026-09-30' }),
        })));
    });

    it('reports a load error with a retry', async () => {
        getStatisticsData.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValue(data());
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<StatisticsDashboard />);
        expect(await screen.findByRole('alert')).toHaveTextContent('No se han podido cargar las estadísticas');
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await loaded()).toBeInTheDocument();
    });
});
