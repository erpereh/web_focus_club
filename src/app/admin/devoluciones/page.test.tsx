import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { userProfile: { role: 'admin' } as { role: string } | null, loading: false }, list: vi.fn(), retry: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/minute-refunds', async (original) => ({
    ...await original<typeof import('@/lib/minute-refunds')>(), getMinuteRefunds: mocks.list, retryMinuteRefund: mocks.retry,
}));
import RefundsPage from './page';

describe('refund administration', () => {
    beforeEach(() => { mocks.auth.userProfile = { role: 'admin' }; mocks.list.mockReset(); });
    it('never queries accounting for non-administrators', () => {
        mocks.auth.userProfile = { role: 'user' };
        render(<RefundsPage />);
        expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeInTheDocument();
        expect(mocks.list).not.toHaveBeenCalled();
    });
    it('shows requested, actually credited and pending amounts, retaining deleted cases while disabled', async () => {
        mocks.list.mockResolvedValue({ summary: { count: 1, minutes: 30, blocked: 0, waiting: 0, enabled: false }, nextCursor: null,
            items: [{ id: 'a'.repeat(64), appointmentId: 'deleted-appointment', userId: 'u', requestedMinutes: 60, creditedMinutes: 30,
                pendingMinutes: 30, state: 'ready', reason: null, reviewApproved: true, sourceDeleted: true }] });
        render(<RefundsPage />);
        await waitFor(() => expect(screen.getByText('deleted-appointment')).toBeInTheDocument());
        expect(screen.getByText('Cita eliminada')).toBeInTheDocument();
        expect(screen.getByText('Desactivada')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
        expect(screen.getByRole('columnheader', { name: 'Abonados' })).toBeInTheDocument();
    });
    it('historical cases offer an audit, with no settlement authorization control', async () => {
        mocks.list.mockResolvedValue({ summary: { count: 1, minutes: 60, blocked: 1, waiting: 0, enabled: true }, nextCursor: null, items: [],
            legacyItems: [{ id: 'legacy:historical', appointmentId: 'historical', userId: 'u', requestedMinutes: 60, creditedMinutes: 0,
                pendingMinutes: 60, state: 'awaiting_review', reason: 'historical_review_required', reviewApproved: false }] });
        render(<RefundsPage />);
        expect(await screen.findByRole('button', { name: 'Descargar auditoría' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    });
});
