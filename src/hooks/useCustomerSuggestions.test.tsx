import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerSuggestion } from '@/types';

const mocks = vi.hoisted(() => ({
    subscribeCustomerSuggestions: vi.fn(),
    subscribeNewCustomerSuggestionsCount: vi.fn(),
}));

vi.mock('@/lib/customer-suggestions', () => mocks);

import { useCustomerSuggestions } from './useCustomerSuggestions';

const suggestions: CustomerSuggestion[] = [
    {
        id: 'suggestion-2',
        userId: 'user-2',
        userName: 'Beatriz López',
        userEmail: 'bea@example.com',
        subject: 'Clases',
        message: 'Más clases por la tarde',
        status: 'new',
        createdAt: null,
        updatedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        reviewedByEmail: null,
    },
    {
        id: 'suggestion-1',
        userId: 'user-1',
        userName: 'Álvaro Pérez',
        userEmail: 'alvaro@example.com',
        subject: null,
        message: 'Añadir una fuente de agua',
        status: 'reviewed',
        createdAt: null,
        updatedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        reviewedByEmail: null,
    },
];

describe('useCustomerSuggestions', () => {
    beforeEach(() => {
        mocks.subscribeCustomerSuggestions.mockImplementation((_options, callback) => {
            callback(suggestions);
            return vi.fn();
        });
        mocks.subscribeNewCustomerSuggestionsCount.mockImplementation((callback) => {
            callback(1);
            return vi.fn();
        });
    });

    it('filters locally by name, email, subject and message without restarting listeners', async () => {
        const { result, rerender } = renderHook(
            ({ search }) => useCustomerSuggestions({ search, enabled: true }),
            { initialProps: { search: '' } },
        );

        await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
        expect(result.current.newCount).toBe(1);
        expect(mocks.subscribeCustomerSuggestions).toHaveBeenCalledTimes(1);
        expect(mocks.subscribeNewCustomerSuggestionsCount).toHaveBeenCalledTimes(1);

        for (const search of ['beatriz', 'bea@example.com', 'clases', 'tarde']) {
            rerender({ search });
            expect(result.current.suggestions.map((suggestion) => suggestion.id)).toEqual(['suggestion-2']);
        }
        rerender({ search: 'fuente' });
        expect(result.current.suggestions.map((suggestion) => suggestion.id)).toEqual(['suggestion-1']);

        expect(mocks.subscribeCustomerSuggestions).toHaveBeenCalledTimes(1);
        expect(mocks.subscribeNewCustomerSuggestionsCount).toHaveBeenCalledTimes(1);
    });

    it('restarts only the suggestions listener when the status filter changes', async () => {
        const { rerender } = renderHook(
            ({ statusFilter }) => useCustomerSuggestions({ search: '', statusFilter, enabled: true }),
            { initialProps: { statusFilter: undefined as 'new' | undefined } },
        );
        await waitFor(() => expect(mocks.subscribeCustomerSuggestions).toHaveBeenCalledTimes(1));

        rerender({ statusFilter: 'new' });
        expect(mocks.subscribeCustomerSuggestions).toHaveBeenCalledTimes(2);
        expect(mocks.subscribeNewCustomerSuggestionsCount).toHaveBeenCalledTimes(1);
    });
});
