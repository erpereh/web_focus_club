import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrainerStatsModal } from './TrainerStatsModal';

const stats = {
    completedMinutes: 1245,
    completedSessions: 26,
    uniqueClients: 14,
    upcomingSessions: 4,
    durationDistribution: { 30: 5, 45: 8, 60: 13 },
};

describe('TrainerStatsModal', () => {
    it('shows the selected trainer metrics and duration distribution', () => {
        render(
            <TrainerStatsModal
                trainerName="Gonzalo Millán Fuertes"
                periodLabel="Este mes"
                stats={stats}
                onClose={() => undefined}
            />,
        );

        expect(screen.getByRole('dialog', { name: 'Estadísticas de Gonzalo Millán Fuertes' })).toBeInTheDocument();
        expect(screen.getByText('20 h 45 min')).toBeInTheDocument();
        expect(screen.getByText('26')).toBeInTheDocument();
        expect(screen.getByText('14')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('5 sesiones')).toBeInTheDocument();
        expect(screen.getByText('8 sesiones')).toBeInTheDocument();
        expect(screen.getByText('13 sesiones')).toBeInTheDocument();
        expect(screen.queryByText(/siguientes 7 días/i)).not.toBeInTheDocument();
    });

    it('closes from the close button and the Escape key', () => {
        const onClose = vi.fn();
        render(
            <TrainerStatsModal
                trainerName="Sandra"
                periodLabel="Todo"
                stats={stats}
                onClose={onClose}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cerrar estadísticas' }));
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
