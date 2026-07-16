'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    Check,
    CircleAlert,
    Inbox,
    Loader2,
    RotateCcw,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { useCustomerSuggestions } from '@/hooks/useCustomerSuggestions';
import {
    adminDeleteSuggestion,
    adminMarkSuggestionNew,
    adminMarkSuggestionReviewed,
} from '@/lib/customer-suggestions';
import { cn } from '@/lib/utils';
import type { CustomerSuggestion, CustomerSuggestionStatus } from '@/types';

type SuggestionFilter = 'all' | CustomerSuggestionStatus;

const STATUS_LABELS: Record<CustomerSuggestionStatus, string> = {
    new: 'Nueva',
    reviewed: 'Revisada',
};

function formatSuggestionTimestamp(timestamp: CustomerSuggestion['createdAt'], includeTime = false): string {
    if (!timestamp) return 'Ahora';
    const date = timestamp.toDate();
    if (Number.isNaN(date.getTime())) return 'Ahora';
    return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: 'short',
        year: includeTime ? 'numeric' : undefined,
        hour: includeTime ? '2-digit' : undefined,
        minute: includeTime ? '2-digit' : undefined,
    }).format(date);
}

function statusClass(status: CustomerSuggestionStatus): string {
    if (status === 'new') return 'bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]';
    return 'bg-blue-500/10 text-blue-300';
}

function StatusBadge({ status }: { status: CustomerSuggestionStatus }) {
    return (
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusClass(status))}>
            {STATUS_LABELS[status]}
        </span>
    );
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase()).join('') || 'FC';
}

export default function CustomerSuggestionsPanel() {
    const [filter, setFilter] = useState<SuggestionFilter>('all');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<CustomerSuggestionStatus | null>(null);
    const [actionError, setActionError] = useState('');
    const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
    const [deletingSuggestion, setDeletingSuggestion] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const { suggestions, newCount, loading, error } = useCustomerSuggestions({
        search,
        statusFilter: filter === 'all' ? undefined : filter,
    });
    const selectedSuggestion = useMemo(
        () => suggestions.find((suggestion) => suggestion.id === selectedId) ?? null,
        [selectedId, suggestions],
    );

    useEffect(() => {
        if (selectedId && !suggestions.some((suggestion) => suggestion.id === selectedId)) {
            setSelectedId(null);
        }
    }, [selectedId, suggestions]);

    const runAction = async (action: CustomerSuggestionStatus) => {
        if (!selectedSuggestion || pendingAction) return;
        setPendingAction(action);
        setActionError('');
        try {
            if (action === 'reviewed') {
                await adminMarkSuggestionReviewed(selectedSuggestion.id);
            } else if (action === 'new') {
                await adminMarkSuggestionNew(selectedSuggestion.id);
            }
        } catch (actionFailure) {
            setActionError(actionFailure instanceof Error && actionFailure.message
                ? actionFailure.message
                : 'No se ha podido actualizar la sugerencia. Inténtalo de nuevo.');
        } finally {
            setPendingAction(null);
        }
    };

    const deleteSuggestion = async () => {
        if (!selectedSuggestion || deletingSuggestion) return;
        setDeletingSuggestion(true);
        setDeleteError('');
        try {
            await adminDeleteSuggestion(selectedSuggestion.id);
            setDeleteConfirmationOpen(false);
            setSelectedId(null);
        } catch (deleteFailure) {
            setDeleteError(deleteFailure instanceof Error && deleteFailure.message
                ? deleteFailure.message
                : 'No se ha podido eliminar la sugerencia. Inténtalo de nuevo.');
        } finally {
            setDeletingSuggestion(false);
        }
    };

    return (
        <div className="overflow-hidden rounded-2xl border border-border bg-[var(--color-bg-surface)] shadow-glow lg:h-[calc(100vh-11.5rem)] lg:min-h-[600px] lg:grid lg:grid-cols-[380px_minmax(0,1fr)]">
            <section className={cn('flex min-h-[calc(100vh-12.5rem)] flex-col border-r border-border lg:min-h-0', selectedSuggestion && 'hidden lg:flex')}>
                <div className="border-b border-border p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Sugerencias</h1>
                            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Comentarios enviados por clientes</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-val)]">
                            {newCount} {newCount === 1 ? 'nueva' : 'nuevas'}
                        </span>
                    </div>
                    <label className="relative block">
                        <span className="sr-only">Buscar sugerencias</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar cliente, email, asunto o texto"
                            className="w-full rounded-xl border border-border bg-input py-2.5 pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                        />
                    </label>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar sugerencias">
                        {([
                            ['all', 'Todas'],
                            ['new', 'Nuevas'],
                            ['reviewed', 'Revisadas'],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={filter === value}
                                onClick={() => setFilter(value)}
                                className={cn(
                                    'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                    filter === value
                                        ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] ring-1 ring-[var(--color-accent-border)]'
                                        : 'text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]',
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {loading && suggestions.length === 0 ? (
                        <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
                            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-val)]" />
                            Cargando sugerencias...
                        </div>
                    ) : error ? (
                        <div className="m-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
                            <CircleAlert className="mx-auto mb-2 h-5 w-5 text-red-400" />
                            <p className="text-sm text-red-200">{error}</p>
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="flex h-52 flex-col items-center justify-center px-6 text-center">
                            <Inbox className="mb-3 h-9 w-9 text-[var(--color-text-muted)]" />
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">No hay sugerencias</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">Prueba con otro filtro o búsqueda.</p>
                        </div>
                    ) : suggestions.map((suggestion) => (
                        <button
                            key={suggestion.id}
                            type="button"
                            onClick={() => {
                                setSelectedId(suggestion.id);
                                setActionError('');
                            }}
                            className={cn(
                                'mb-1 flex w-full gap-3 rounded-xl border p-3 text-left transition-all',
                                selectedId === suggestion.id
                                    ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] shadow-[inset_3px_0_0_var(--color-accent-val)]'
                                    : 'border-transparent hover:border-border hover:bg-white/[0.025]',
                            )}
                        >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-sm font-semibold text-[var(--color-accent-bright)]" aria-hidden="true">
                                {initials(suggestion.userName)}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{suggestion.userName || 'Cliente'}</span>
                                        <span className="block truncate text-xs text-[var(--color-text-secondary)]">{suggestion.userEmail || 'Sin email'}</span>
                                    </span>
                                    <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">{formatSuggestionTimestamp(suggestion.createdAt)}</span>
                                </span>
                                <span className="mt-1 flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-[var(--color-accent-bright)]">{suggestion.subject || 'Sin asunto'}</span>
                                    <StatusBadge status={suggestion.status} />
                                </span>
                                <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{suggestion.message}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <section className={cn('hidden min-h-[calc(100vh-12.5rem)] flex-col lg:min-h-0 lg:flex', selectedSuggestion && 'flex')}>
                {!selectedSuggestion ? (
                    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                        <Inbox className="mb-4 h-10 w-10 text-[var(--color-text-muted)]" />
                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Selecciona una sugerencia</h2>
                        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Elige un elemento para leer el comentario completo.</p>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:flex-nowrap">
                            <button
                                type="button"
                                onClick={() => setSelectedId(null)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)] lg:hidden"
                                aria-label="Volver a la lista de sugerencias"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                            <div className="min-w-0 flex-1">
                                <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{selectedSuggestion.userName}</h2>
                                <p className="truncate text-xs text-[var(--color-text-secondary)]">{selectedSuggestion.userEmail}</p>
                            </div>
                            <StatusBadge status={selectedSuggestion.status} />
                            {selectedSuggestion.status === 'new' && (
                                <button
                                    type="button"
                                    disabled={pendingAction !== null}
                                    onClick={() => void runAction('reviewed')}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent-border)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-val)] hover:bg-[var(--color-accent-dim)] disabled:opacity-60"
                                >
                                    {pendingAction === 'reviewed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    Marcar como revisada
                                </button>
                            )}
                            {selectedSuggestion.status === 'reviewed' && (
                                <button
                                    type="button"
                                    disabled={pendingAction !== null}
                                    onClick={() => void runAction('new')}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent-border)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-val)] hover:bg-[var(--color-accent-dim)] disabled:opacity-60"
                                >
                                    {pendingAction === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                    Marcar como nueva
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={pendingAction !== null || deletingSuggestion}
                                onClick={() => {
                                    setDeleteError('');
                                    setDeleteConfirmationOpen(true);
                                }}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-500/25 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Eliminar
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
                            {actionError && (
                                <div className="mb-5 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
                                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="flex-1">{actionError}</span>
                                    <button type="button" onClick={() => setActionError('')} aria-label="Cerrar error">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            )}
                            <div className="mx-auto max-w-3xl">
                                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">{formatSuggestionTimestamp(selectedSuggestion.createdAt, true)}</p>
                                <h3 className="mt-3 text-xl font-semibold text-[var(--color-text-primary)]">{selectedSuggestion.subject || 'Sin asunto'}</h3>
                                <div className="mt-5 rounded-2xl border border-border bg-white/[0.025] p-5 sm:p-6">
                                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-text-primary)]">{selectedSuggestion.message}</p>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </section>
            {deleteConfirmationOpen && selectedSuggestion && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-suggestion-title"
                        className="w-full max-w-md rounded-2xl border border-border bg-[var(--color-bg-surface)] p-6 shadow-2xl"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                                <Trash2 className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 id="delete-suggestion-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
                                    Eliminar sugerencia
                                </h2>
                                <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                                    Esta acción eliminará definitivamente la sugerencia y no se podrá deshacer.
                                </p>
                            </div>
                        </div>
                        {deleteError && (
                            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{deleteError}</span>
                            </div>
                        )}
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                disabled={deletingSuggestion}
                                onClick={() => setDeleteConfirmationOpen(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)] disabled:opacity-60"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={deletingSuggestion}
                                onClick={() => void deleteSuggestion()}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                            >
                                {deletingSuggestion && <Loader2 className="h-4 w-4 animate-spin" />}
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
