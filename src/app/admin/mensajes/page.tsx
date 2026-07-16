'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft,
    CircleAlert,
    Loader2,
    Lock,
    LogOut,
    MessageCircle,
    Search,
    Send,
    Trash2,
    X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
    adminHideSupportConversation,
    adminSendSupportMessage,
    closeSupportConversation,
    markSupportConversationRead,
    reopenSupportConversation,
    subscribeSupportConversations,
    subscribeSupportMessages,
} from '@/lib/support-chat';
import type { SupportConversation, SupportConversationStatus, SupportMessage } from '@/types';
import CustomerSuggestionsPanel from '@/components/admin/CustomerSuggestionsPanel';
import MessagesSectionTabs, { type MessagesSection } from '@/components/admin/MessagesSectionTabs';

type ConversationFilter = 'all' | SupportConversationStatus;

function initials(name: string): string {
    const value = name.trim();
    if (!value) return 'FC';
    return value
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
}

function formatTimestamp(timestamp: SupportConversation['lastMessageAt'], includeDate = false): string {
    if (!timestamp) return 'Ahora';
    const date = timestamp.toDate();
    if (Number.isNaN(date.getTime())) return 'Ahora';

    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (!includeDate && sameDay) {
        return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date);
    }

    return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: 'short',
        ...(includeDate ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date);
}

function friendlyError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
}

function ConversationAvatar({ conversation, size = 'md' }: { conversation: SupportConversation; size?: 'sm' | 'md' }) {
    return (
        <div
            className={cn(
                'shrink-0 rounded-full bg-[var(--color-accent-dim)] border border-[var(--color-accent-border)] text-[var(--color-accent-bright)] flex items-center justify-center font-semibold',
                size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm',
            )}
            aria-hidden="true"
        >
            {initials(conversation.userName)}
        </div>
    );
}

export default function MessagesPage() {
    const { user, userProfile, loading: authLoading, logout } = useAuth();
    const router = useRouter();
    const [activeSection, setActiveSection] = useState<MessagesSection>('conversations');
    const [filter, setFilter] = useState<ConversationFilter>('all');
    const [search, setSearch] = useState('');
    const [conversations, setConversations] = useState<SupportConversation[]>([]);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [loadingConversations, setLoadingConversations] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [conversationsError, setConversationsError] = useState('');
    const [messagesError, setMessagesError] = useState('');
    const [actionError, setActionError] = useState('');
    const [sending, setSending] = useState(false);
    const [changingStatus, setChangingStatus] = useState(false);
    const [hideConfirmationOpen, setHideConfirmationOpen] = useState(false);
    const [hidingConversation, setHidingConversation] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const hasAdminAccess = userProfile?.role === 'admin';
    const profilePending = authLoading || (user !== null && userProfile === null);
    const selectedConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
        [conversations, selectedConversationId],
    );

    useEffect(() => {
        if (!authLoading && userProfile && userProfile.role !== 'admin') {
            router.replace('/admin');
        }
    }, [authLoading, router, userProfile]);

    useEffect(() => {
        const statusFilter = filter === 'all' ? undefined : filter;
        if (!hasAdminAccess) return;

        setLoadingConversations(true);
        setConversationsError('');
        return subscribeSupportConversations(
            { statusFilter, search, excludeAdminHidden: true },
            (nextConversations) => {
                setConversations(nextConversations);
                setLoadingConversations(false);
            },
            (error) => {
                console.error('No se han podido cargar las conversaciones de soporte.', error);
                setConversationsError('No se han podido cargar las conversaciones. Inténtalo de nuevo más tarde.');
                setLoadingConversations(false);
            },
        );
    }, [filter, hasAdminAccess, search]);

    useEffect(() => {
        if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
            setSelectedConversationId(null);
            setMessages([]);
        }
    }, [conversations, selectedConversationId]);

    useEffect(() => {
        if (!hasAdminAccess || !selectedConversationId) {
            setMessages([]);
            setLoadingMessages(false);
            return;
        }

        setLoadingMessages(true);
        setMessagesError('');
        return subscribeSupportMessages(
            selectedConversationId,
            (nextMessages) => {
                setMessages(nextMessages);
                setLoadingMessages(false);
            },
            (error) => {
                console.error('No se han podido cargar los mensajes de soporte.', error);
                setMessagesError('No se ha podido cargar este hilo. Inténtalo de nuevo más tarde.');
                setLoadingMessages(false);
            },
        );
    }, [hasAdminAccess, selectedConversationId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, selectedConversationId]);

    const selectConversation = (conversation: SupportConversation) => {
        setSelectedConversationId(conversation.id);
        setActionError('');

        if (conversation.unreadAdminCount > 0) {
            void markSupportConversationRead(conversation.id).catch((error) => {
                console.error('No se ha podido marcar la conversación como leída.', error);
                setActionError('No se ha podido actualizar el estado de lectura.');
            });
        }
    };

    const sendMessage = async () => {
        const text = draft.trim();
        if (!selectedConversation || selectedConversation.status !== 'open' || !text || sending) return;

        setSending(true);
        setActionError('');
        try {
            await adminSendSupportMessage(selectedConversation.id, text);
            setDraft('');
        } catch (error) {
            console.error('No se ha podido enviar el mensaje de soporte.', error);
            setActionError(friendlyError(error, 'No se ha podido enviar el mensaje. Inténtalo de nuevo.'));
        } finally {
            setSending(false);
        }
    };

    const updateStatus = async (status: SupportConversationStatus) => {
        if (!selectedConversation || changingStatus) return;

        setChangingStatus(true);
        setActionError('');
        try {
            if (status === 'closed') {
                await closeSupportConversation(selectedConversation.id);
            } else {
                await reopenSupportConversation(selectedConversation.id);
            }
        } catch (error) {
            console.error('No se ha podido actualizar el estado de la conversación.', error);
            setActionError(friendlyError(error, 'No se ha podido actualizar la conversación. Inténtalo de nuevo.'));
        } finally {
            setChangingStatus(false);
        }
    };

    const hideConversation = async () => {
        if (!selectedConversation || hidingConversation) return;

        setHidingConversation(true);
        setActionError('');
        try {
            await adminHideSupportConversation(selectedConversation.id);
            setHideConfirmationOpen(false);
            setSelectedConversationId(null);
            setMessages([]);
        } catch (error) {
            console.error('No se ha podido ocultar la conversación del panel.', error);
            setActionError(friendlyError(error, 'No se ha podido ocultar la conversación. Inténtalo de nuevo.'));
        } finally {
            setHidingConversation(false);
        }
    };

    if (profilePending) {
        return (
            <div className="min-h-screen -mt-20 flex items-center justify-center bg-[var(--color-bg-base)] px-4">
                <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent-val)]" />
                    Validando acceso al panel de mensajes...
                </div>
            </div>
        );
    }

    if (!hasAdminAccess) {
        return (
            <div className="min-h-screen -mt-20 flex items-center justify-center bg-[var(--color-bg-base)] px-4">
                <div className="max-w-md w-full rounded-2xl border border-border bg-[var(--color-bg-card)] p-8 text-center shadow-glow">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                        <Lock className="w-6 h-6" />
                    </div>
                    <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Acceso restringido</h1>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                        Los mensajes de soporte solo están disponibles para administradores.
                    </p>
                    <Link
                        href="/admin"
                        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent-border)] px-4 py-2 text-sm font-medium text-[var(--color-accent-val)] transition-colors hover:bg-[var(--color-accent-dim)]"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Ir al acceso admin
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen -mt-20 bg-[var(--color-bg-base)]">
            <header className="glass-dark sticky top-0 z-30 border-b border-border">
                <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Link href="/admin" className="flex items-center gap-2 text-[var(--color-text-primary)]">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]">
                                <MessageCircle className="w-4 h-4" />
                            </div>
                            <span className="hidden font-bold sm:inline">Focus Club Admin</span>
                        </Link>
                        <span className="text-[var(--color-text-muted)]">/</span>
                        <span className="truncate text-sm font-medium text-[var(--color-accent-val)]">Mensajes</span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        <Link
                            href="/admin"
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-primary)]"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            <span className="hidden sm:inline">Admin</span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => void logout()}
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-primary)]"
                        >
                            <LogOut className="w-4 h-4" />
                            <span className="hidden sm:inline">Salir</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-5 lg:py-7">
                <MessagesSectionTabs value={activeSection} onChange={setActiveSection} />
                {activeSection === 'conversations' ? (
                <div className="overflow-hidden rounded-2xl border border-border bg-[var(--color-bg-surface)] shadow-glow lg:h-[calc(100vh-11.5rem)] lg:min-h-[600px] lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
                    <section className={cn('flex min-h-[calc(100vh-9.5rem)] flex-col border-r border-border lg:min-h-0', selectedConversation && 'hidden lg:flex')}>
                        <div className="border-b border-border p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Mensajes</h1>
                                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Soporte general de clientes</p>
                                </div>
                                <span className="rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-val)]">
                                    {conversations.length}
                                </span>
                            </div>

                            <label className="relative block">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Buscar por cliente, email o asunto"
                                    className="w-full rounded-xl border border-border bg-input py-2.5 pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                                />
                            </label>

                            <div className="mt-3 flex gap-2" role="tablist" aria-label="Filtrar conversaciones">
                                {([
                                    ['all', 'Todas'],
                                    ['open', 'Abiertas'],
                                    ['closed', 'Cerradas'],
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        role="tab"
                                        aria-selected={filter === value}
                                        onClick={() => setFilter(value)}
                                        className={cn(
                                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
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
                            {loadingConversations && conversations.length === 0 ? (
                                <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
                                    <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent-val)]" />
                                    Cargando conversaciones...
                                </div>
                            ) : conversationsError ? (
                                <div className="m-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
                                    <CircleAlert className="mx-auto mb-2 h-5 w-5 text-red-400" />
                                    <p className="text-sm text-red-200">{conversationsError}</p>
                                </div>
                            ) : conversations.length === 0 ? (
                                <div className="flex h-52 flex-col items-center justify-center px-6 text-center">
                                    <MessageCircle className="mb-3 h-9 w-9 text-[var(--color-text-muted)]" />
                                    <p className="text-sm font-medium text-[var(--color-text-primary)]">No hay conversaciones</p>
                                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">Prueba con otro filtro o vuelve más tarde.</p>
                                </div>
                            ) : conversations.map((conversation) => {
                                const isSelected = conversation.id === selectedConversationId;
                                const isOpen = conversation.status === 'open';
                                return (
                                    <button
                                        key={conversation.id}
                                        type="button"
                                        onClick={() => selectConversation(conversation)}
                                        className={cn(
                                            'mb-1 flex w-full gap-3 rounded-xl border p-3 text-left transition-all',
                                            isSelected
                                                ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] shadow-[inset_3px_0_0_var(--color-accent-val)]'
                                                : 'border-transparent hover:border-border hover:bg-white/[0.025]',
                                        )}
                                    >
                                        <ConversationAvatar conversation={conversation} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{conversation.userName || 'Cliente'}</p>
                                                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{conversation.userEmail || 'Sin email'}</p>
                                                </div>
                                                <div className="flex shrink-0 flex-col items-end gap-1">
                                                    <span className="text-[11px] text-[var(--color-text-secondary)]">{formatTimestamp(conversation.lastMessageAt)}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={cn(
                                                            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                                            isOpen ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]' : 'bg-white/5 text-[var(--color-text-secondary)]',
                                                        )}>
                                                            {isOpen ? 'Abierta' : 'Cerrada'}
                                                        </span>
                                                        {conversation.unreadAdminCount > 0 && (
                                                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent-val)] px-1.5 text-[10px] font-bold text-[#08110c]">
                                                                {conversation.unreadAdminCount > 99 ? '99+' : conversation.unreadAdminCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="mt-1 truncate text-xs font-medium text-[var(--color-accent-bright)]">{conversation.subject || 'Consulta general'}</p>
                                            <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{conversation.lastMessage || 'Sin mensajes'}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className={cn('hidden min-h-[calc(100vh-9.5rem)] flex-col lg:min-h-0 lg:flex', selectedConversation && 'flex')}>
                        {!selectedConversation ? (
                            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]">
                                    <MessageCircle className="h-7 w-7" />
                                </div>
                                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Selecciona una conversación</h2>
                                <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--color-text-secondary)]">Elige un mensaje de la lista para revisar el historial y responder al cliente.</p>
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 lg:flex-nowrap">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedConversationId(null)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-primary)] lg:hidden"
                                        aria-label="Volver a la lista de conversaciones"
                                    >
                                        <ArrowLeft className="h-5 w-5" />
                                    </button>
                                    <ConversationAvatar conversation={selectedConversation} size="md" />
                                    <div className="min-w-0 flex-1">
                                        <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{selectedConversation.userName || 'Cliente'}</h2>
                                        <p className="truncate text-xs text-[var(--color-text-secondary)]">{selectedConversation.userEmail || 'Sin email'}</p>
                                        <p className="mt-0.5 truncate text-xs text-[var(--color-accent-bright)]">{selectedConversation.subject || 'Consulta general'}</p>
                                    </div>
                                    <span className={cn(
                                        'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                                        selectedConversation.status === 'open'
                                            ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]'
                                            : 'bg-white/5 text-[var(--color-text-secondary)]',
                                    )}>
                                        {selectedConversation.status === 'open' ? 'Abierta' : 'Cerrada'}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={changingStatus}
                                        onClick={() => void updateStatus(selectedConversation.status === 'open' ? 'closed' : 'open')}
                                        className={cn(
                                            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                            selectedConversation.status === 'open'
                                                ? 'border-red-500/25 text-red-300 hover:bg-red-500/10'
                                                : 'border-[var(--color-accent-border)] text-[var(--color-accent-val)] hover:bg-[var(--color-accent-dim)]',
                                        )}
                                    >
                                        {changingStatus && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        {selectedConversation.status === 'open' ? 'Cerrar' : 'Reabrir'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={hidingConversation}
                                        onClick={() => {
                                            setActionError('');
                                            setHideConfirmationOpen(true);
                                        }}
                                        title="Ocultar esta conversación del panel"
                                        aria-label="Ocultar esta conversación del panel"
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/25 text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(82,183,136,0.045),transparent_45%)] px-4 py-5 sm:px-6">
                                    {loadingMessages ? (
                                        <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
                                            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent-val)]" />
                                            Cargando mensajes...
                                        </div>
                                    ) : messagesError ? (
                                        <div className="mx-auto max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
                                            <CircleAlert className="mx-auto mb-2 h-5 w-5 text-red-400" />
                                            <p className="text-sm text-red-200">{messagesError}</p>
                                        </div>
                                    ) : messages.length === 0 ? (
                                        <div className="flex h-full flex-col items-center justify-center text-center">
                                            <MessageCircle className="mb-3 h-8 w-8 text-[var(--color-text-muted)]" />
                                            <p className="text-sm text-[var(--color-text-secondary)]">Aún no hay mensajes en esta conversación.</p>
                                        </div>
                                    ) : (
                                        <div className="mx-auto flex max-w-3xl flex-col gap-4">
                                            {messages.map((message) => {
                                                const isAdmin = message.senderRole === 'admin';
                                                return (
                                                    <div key={message.id} className={cn('flex', isAdmin ? 'justify-end' : 'justify-start')}>
                                                        <div className={cn(
                                                            'max-w-[85%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%]',
                                                            isAdmin
                                                                ? 'rounded-br-md border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]'
                                                                : 'rounded-bl-md border border-border bg-white/[0.045] text-[var(--color-text-primary)]',
                                                        )}>
                                                            <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
                                                            <p className={cn('mt-1 text-right text-[10px]', isAdmin ? 'text-[var(--color-accent-bright)]/80' : 'text-[var(--color-text-secondary)]')}>
                                                                {formatTimestamp(message.createdAt, true)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div ref={messagesEndRef} />
                                        </div>
                                    )}
                                </div>

                                <div className="border-t border-border bg-[var(--color-bg-surface)] p-3 sm:p-4">
      {actionError && (
                                        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
                                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                                            <span className="flex-1">{actionError}</span>
                                            <button type="button" onClick={() => setActionError('')} aria-label="Cerrar error" className="text-red-300 hover:text-white">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
      )}
      {selectedConversation.status === 'closed' && (
          <p className="mb-3 rounded-lg border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-3 py-2 text-xs text-[var(--color-accent-bright)]">
              Esta conversación está cerrada. Pulsa Reabrir antes de responder.
          </p>
      )}
      <form
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            void sendMessage();
                                        }}
                                        className="flex items-end gap-2"
                                    >
                                        <textarea
                                            value={draft}
                                            onChange={(event) => setDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                                    event.preventDefault();
                                                    void sendMessage();
                                                }
                                            }}
              rows={1}
              disabled={selectedConversation.status !== 'open'}
              placeholder={selectedConversation.status === 'open' ? 'Escribe tu respuesta...' : 'Reabre la conversación para responder.'}
                                            className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-border bg-input px-3 py-2.5 text-sm leading-5 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                                        />
                                        <button
                                            type="submit"
              disabled={selectedConversation.status !== 'open' || !draft.trim() || sending}
                                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-val)] text-[#08110c] transition-colors hover:bg-[var(--color-accent-bright)] disabled:cursor-not-allowed disabled:opacity-40"
                                            aria-label="Enviar mensaje"
                                        >
                                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </button>
                                    </form>
                                    <p className="mt-2 hidden text-[10px] text-[var(--color-text-secondary)] sm:block">Enter para enviar · Shift + Enter para añadir una línea</p>
                                </div>
                            </>
                        )}
                    </section>
                </div>
                ) : (
                    <CustomerSuggestionsPanel />
                )}
            </main>
            {hideConfirmationOpen && selectedConversation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="hide-conversation-title"
                        className="w-full max-w-md rounded-2xl border border-border bg-[var(--color-bg-surface)] p-6 shadow-2xl"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                                <Trash2 className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 id="hide-conversation-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
                                    ¿Ocultar esta conversación del panel?
                                </h2>
                                <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                                    El cliente seguirá viendo la conversación. Solo se ocultará para el admin.
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                disabled={hidingConversation}
                                onClick={() => setHideConfirmationOpen(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-primary)] disabled:opacity-60"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={hidingConversation}
                                onClick={() => void hideConversation()}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {hidingConversation && <Loader2 className="h-4 w-4 animate-spin" />}
                                Ocultar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
