import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerSuggestion } from '@/types';

const mocks = vi.hoisted(() => ({
    useCustomerSuggestions: vi.fn(),
    adminMarkSuggestionReviewed: vi.fn(),
    adminArchiveSuggestion: vi.fn(),
    adminRestoreSuggestion: vi.fn(),
}));

vi.mock('@/hooks/useCustomerSuggestions', () => ({ useCustomerSuggestions: mocks.useCustomerSuggestions }));
vi.mock('@/lib/customer-suggestions', () => ({
    adminMarkSuggestionReviewed: mocks.adminMarkSuggestionReviewed,
    adminArchiveSuggestion: mocks.adminArchiveSuggestion,
    adminRestoreSuggestion: mocks.adminRestoreSuggestion,
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
    archivedAt: null,
    archivedBy: null,
    archivedByEmail: null,
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
        mocks.adminArchiveSuggestion.mockResolvedValue(undefined);
        mocks.adminRestoreSuggestion.mockResolvedValue(undefined);
    });

    it('shows the new-only counter and a read-only detail', () => {
        render(<CustomerSuggestionsPanel />);

        expect(screen.getByText('1 nueva')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(screen.getAllByText('Me gustaría disponer de más bandas elásticas.')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Marcar como revisada' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /respuesta/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /enviar/i })).not.toBeInTheDocument();
    });

    it('does not mark a new suggestion until the explicit action is pressed', async () => {
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(mocks.adminMarkSuggestionReviewed).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Marcar como revisada' }));
        await waitFor(() => expect(mocks.adminMarkSuggestionReviewed).toHaveBeenCalledWith('suggestion-1'));
    });

    it('passes filters and search to the local-search hook without touching conversations', () => {
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('tab', { name: 'Nuevas' }));
        expect(mocks.useCustomerSuggestions).toHaveBeenLastCalledWith({
            search: '',
            statusFilter: 'new',
        });

        fireEvent.change(screen.getByPlaceholderText('Buscar cliente, email, asunto o texto'), {
            target: { value: 'bandas' },
        });
        expect(mocks.useCustomerSuggestions).toHaveBeenLastCalledWith({
            search: 'bandas',
            statusFilter: 'new',
        });
    });

    it('archives reviewed suggestions and restores archived suggestions', async () => {
        mocks.useCustomerSuggestions.mockReturnValue({
            suggestions: [{ ...suggestion, status: 'reviewed' }],
            newCount: 0,
            loading: false,
            error: '',
        });
        const { unmount } = render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Archivar' }));
        await waitFor(() => expect(mocks.adminArchiveSuggestion).toHaveBeenCalledWith('suggestion-1'));
        unmount();

        mocks.useCustomerSuggestions.mockReturnValue({
            suggestions: [{ ...suggestion, status: 'archived' }],
            newCount: 0,
            loading: false,
            error: '',
        });
        render(<CustomerSuggestionsPanel />);
        fireEvent.click(screen.getByRole('button', { name: /lucía ramos/i }));
        expect(screen.getByRole('button', { name: 'Volver a la lista de sugerencias' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
        await waitFor(() => expect(mocks.adminRestoreSuggestion).toHaveBeenCalledWith('suggestion-1'));
    });

    it('shows the empty state', () => {
        mocks.useCustomerSuggestions.mockReturnValue({
            suggestions: [],
            newCount: 0,
            loading: false,
            error: '',
        });
        render(<CustomerSuggestionsPanel />);
        expect(screen.getByText('No hay sugerencias')).toBeInTheDocument();
    });
});
