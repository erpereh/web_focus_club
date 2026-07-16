import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerSuggestion } from '@/types';

const mocks = vi.hoisted(() => ({
    useCustomerSuggestions: vi.fn(),
    adminMarkSuggestionReviewed: vi.fn(),
    adminMarkSuggestionNew: vi.fn(),
    adminDeleteSuggestion: vi.fn(),
}));

vi.mock('@/hooks/useCustomerSuggestions', () => ({ useCustomerSuggestions: mocks.useCustomerSuggestions }));
vi.mock('@/lib/customer-suggestions', () => ({
    adminMarkSuggestionReviewed: mocks.adminMarkSuggestionReviewed,
    adminMarkSuggestionNew: mocks.adminMarkSuggestionNew,
    adminDeleteSuggestion: mocks.adminDeleteSuggestion,
}));

import CustomerSuggestionsPanel from './CustomerSuggestionsPanel';

const suggestion: CustomerSuggestion = {
    id: 'suggestion-1',
    userId: 'user-1',
    userName: 'Lucía Ramos',
    userEmail: 'lucia@example.com',
    subject: 'Material',
    message: 'Me gustaría disponer de más bandas elásticas.',
    status: 'new',
    createdAt: null,
    updatedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByEmail: null,
};

describe('CustomerSuggestionsPanel', () => {
    beforeEach(() => {
        mocks.useCustomerSuggestions.mockReturnValue({
            suggestions: [suggestion],
            newCount: 1,
            loading: false,
            error: '',
        });
        mocks.adminMarkSuggestionReviewed.mockResolvedValue(undefined);
        mocks.adminMarkSuggestionNew.mockResolvedValue(undefined);
        mocks.adminDeleteSuggestion.mockResolvedValue(undefined);
    });

    it('shows only active filters and read-only actions for a new suggestion', () => {
        render(<CustomerSuggestionsPanel />);

        expect(screen.getByText('1 nueva')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Todas' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Nuevas' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Revisadas' })).toBeInTheDocument();
        expect(screen.queryByText('Archivadas')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(screen.getByRole('button', { name: 'Marcar como revisada' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
        expect(screen.queryByText('Archivar')).not.toBeInTheDocument();
        expect(screen.queryByText('Restaurar')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /respuesta/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /enviar/i })).not.toBeInTheDocument();
    });

    it('does not mark a new suggestion as reviewed until the explicit action is pressed', async () => {
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(mocks.adminMarkSuggestionReviewed).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Marcar como revisada' }));
        await waitFor(() => expect(mocks.adminMarkSuggestionReviewed).toHaveBeenCalledWith('suggestion-1'));
    });

    it('passes active filters and search to the local-search hook', () => {
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('tab', { name: 'Nuevas' }));
        expect(mocks.useCustomerSuggestions).toHaveBeenLastCalledWith({ search: '', statusFilter: 'new' });

        fireEvent.change(screen.getByPlaceholderText('Buscar cliente, email, asunto o texto'), {
            target: { value: 'bandas' },
        });
        expect(mocks.useCustomerSuggestions).toHaveBeenLastCalledWith({ search: 'bandas', statusFilter: 'new' });
    });

    it('marks a reviewed suggestion as new and reflects listener updates', async () => {
        let currentSuggestion: CustomerSuggestion = { ...suggestion, status: 'reviewed' };
        let currentNewCount = 0;
        mocks.useCustomerSuggestions.mockImplementation(() => ({
            suggestions: [currentSuggestion],
            newCount: currentNewCount,
            loading: false,
            error: '',
        }));
        mocks.adminMarkSuggestionNew.mockImplementation(async () => {
            currentSuggestion = { ...suggestion, status: 'new' };
            currentNewCount = 1;
        });

        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(screen.getByRole('button', { name: 'Marcar como nueva' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Marcar como nueva' }));
        await waitFor(() => expect(mocks.adminMarkSuggestionNew).toHaveBeenCalledWith('suggestion-1'));
        await waitFor(() => expect(screen.getByText('1 nueva')).toBeInTheDocument());
        expect(screen.getAllByText('Nueva').length).toBeGreaterThan(0);
    });

    it('requires confirmation, supports cancel and clears detail after deletion', async () => {
        mocks.useCustomerSuggestions.mockReturnValue({
            suggestions: [{ ...suggestion, status: 'reviewed' }],
            newCount: 0,
            loading: false,
            error: '',
        });
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

        let dialog = screen.getByRole('dialog', { name: 'Eliminar sugerencia' });
        expect(within(dialog).getByText('Esta acción eliminará definitivamente la sugerencia y no se podrá deshacer.')).toBeInTheDocument();
        expect(mocks.adminDeleteSuggestion).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByRole('dialog', { name: 'Eliminar sugerencia' })).not.toBeInTheDocument();
        expect(mocks.adminDeleteSuggestion).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
        dialog = screen.getByRole('dialog', { name: 'Eliminar sugerencia' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
        await waitFor(() => expect(mocks.adminDeleteSuggestion).toHaveBeenCalledWith('suggestion-1'));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Eliminar sugerencia' })).not.toBeInTheDocument());
        expect(screen.getByText('Selecciona una sugerencia')).toBeInTheDocument();
    });

    it('shows the empty state', () => {
        mocks.useCustomerSuggestions.mockReturnValue({ suggestions: [], newCount: 0, loading: false, error: '' });
        render(<CustomerSuggestionsPanel />);
        expect(screen.getByText('No hay sugerencias')).toBeInTheDocument();
    });
});
