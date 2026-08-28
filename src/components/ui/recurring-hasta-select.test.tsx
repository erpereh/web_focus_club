import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecurringHastaSelect } from './recurring-hasta-select';
import type { RecurringEndDateOption } from '@/lib/recurring-appointments';

const OPTIONS: RecurringEndDateOption[] = [
    { endDate: '2026-09-15', occurrenceCount: 2, totalMinutes: 60 },
    { endDate: '2026-09-22', occurrenceCount: 3, totalMinutes: 90 },
    { endDate: '2026-09-29', occurrenceCount: 4, totalMinutes: 120 },
];

describe('RecurringHastaSelect', () => {
    it('shows the placeholder when nothing is selected', () => {
        render(
            <RecurringHastaSelect
                options={OPTIONS}
                value=""
                onChange={vi.fn()}
                emptyReason={null}
            />,
        );
        expect(screen.getByRole('button', { name: /Selecciona la última sesión/ })).toBeInTheDocument();
    });

    it('shows the selected option label', () => {
        render(
            <RecurringHastaSelect
                options={OPTIONS}
                value="2026-09-22"
                onChange={vi.fn()}
                emptyReason={null}
            />,
        );
        expect(screen.getByRole('button', { name: /22\/09\/2026 · 3 sesiones · 90 min/ })).toBeInTheDocument();
    });

    it('calls onChange with the chosen endDate and closes', () => {
        const onChange = vi.fn();
        render(
            <RecurringHastaSelect
                options={OPTIONS}
                value=""
                onChange={onChange}
                emptyReason={null}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/ }));
        fireEvent.click(screen.getByRole('option', { name: '15/09/2026 · 2 sesiones · 60 min' }));
        expect(onChange).toHaveBeenCalledWith('2026-09-15');
    });

    it('explains that a start date is required', () => {
        render(
            <RecurringHastaSelect
                options={[]}
                value=""
                onChange={vi.fn()}
                emptyReason="no-start-date"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Selecciona la última sesión/ }));
        expect(screen.getByRole('status')).toHaveTextContent(
            'Elige primero una fecha inicial en el calendario.',
        );
    });

    it('shows the no-valid-end message and does not open options', () => {
        render(
            <RecurringHastaSelect
                options={[]}
                value=""
                onChange={vi.fn()}
                emptyReason="no-valid-end"
            />,
        );
        const trigger = screen.getByRole('button', { name: /Selecciona la última sesión/ });
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(screen.getByText(/No hay suficientes minutos o vigencia de bono/)).toBeInTheDocument();
    });

    it('falls back to the placeholder when the current value is no longer in options', () => {
        render(
            <RecurringHastaSelect
                options={OPTIONS.slice(0, 1)}
                value="2026-09-29"
                onChange={vi.fn()}
                emptyReason={null}
            />,
        );
        expect(screen.getByRole('button', { name: /Selecciona la última sesión/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /29\/09\/2026/ })).not.toBeInTheDocument();
    });
});
