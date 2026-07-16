import { useEffect, useMemo, useState } from 'react';
import {
    subscribeCustomerSuggestions,
    subscribeNewCustomerSuggestionsCount,
} from '@/lib/customer-suggestions';
import type { CustomerSuggestion, CustomerSuggestionStatus } from '@/types';

interface UseCustomerSuggestionsOptions {
    search: string;
    statusFilter?: CustomerSuggestionStatus;
    enabled?: boolean;
}

function normalizeSearchValue(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('es-ES');
}

export function matchesCustomerSuggestionSearch(
    suggestion: CustomerSuggestion,
    search: string,
): boolean {
    const normalizedSearch = normalizeSearchValue(search.trim());
    if (!normalizedSearch) return true;
    return [suggestion.userName, suggestion.userEmail, suggestion.subject ?? '', suggestion.message]
        .some((value) => normalizeSearchValue(value).includes(normalizedSearch));
}

export function useCustomerSuggestions({
    search,
    statusFilter,
    enabled = true,
}: UseCustomerSuggestionsOptions) {
    const [receivedSuggestions, setReceivedSuggestions] = useState<CustomerSuggestion[]>([]);
    const [newCount, setNewCount] = useState(0);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!enabled) return;
        return subscribeCustomerSuggestions(
            { statusFilter },
            (suggestions) => {
                setReceivedSuggestions(suggestions);
                setLoading(false);
            },
            () => {
                setError('No se han podido cargar las sugerencias. Inténtalo de nuevo más tarde.');
                setLoading(false);
            },
        );
    }, [enabled, statusFilter]);

    useEffect(() => {
        if (!enabled) return;
        return subscribeNewCustomerSuggestionsCount(
            setNewCount,
            () => setError('No se ha podido actualizar el contador de sugerencias nuevas.'),
        );
    }, [enabled]);

    const suggestions = useMemo(
        () => receivedSuggestions.filter((suggestion) => matchesCustomerSuggestionSearch(suggestion, search)),
        [receivedSuggestions, search],
    );

    return {
        suggestions: enabled ? suggestions : [],
        newCount: enabled ? newCount : 0,
        loading: enabled ? loading : false,
        error: enabled ? error : '',
    };
}
