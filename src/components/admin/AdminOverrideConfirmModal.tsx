'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, Check, RefreshCw, ShieldAlert } from 'lucide-react';
import {
    type AdminOverridePrompt,
    describeAdminRestriction,
    groupAdminRestrictions,
} from '@/lib/admin-booking-overrides';

export interface AdminOverrideConfirmModalProps {
    prompt: AdminOverridePrompt;
    /** Serie recurrente: cambia los textos y avisa de que se crea todo o nada. */
    isSeries: boolean;
    totalSessions?: number;
    saving: boolean;
    error?: string;
    onConfirm: (input: { fingerprint: string; confirmPastDate: boolean }) => void;
    onCancel: () => void;
}

function formatLongDate(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function AdminOverrideConfirmModal({
    prompt,
    isSeries,
    totalSessions,
    saving,
    error,
    onConfirm,
    onCancel,
}: AdminOverrideConfirmModalProps) {
    // Tied to the list it was given for: a refreshed list must be confirmed again from scratch.
    const [pastConfirmedFor, setPastConfirmedFor] = useState<string | null>(null);
    const pastConfirmed = pastConfirmedFor === prompt.fingerprint;
    const groups = useMemo(() => groupAdminRestrictions(prompt.restrictions), [prompt.restrictions]);

    const canConfirm = !saving && (!prompt.requiresPastConfirmation || pastConfirmed);

    return (
        <motion.div
            key="admin-override-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6"
            onClick={() => { if (!saving) onCancel(); }}
        >
            <motion.div
                initial={{ scale: 0.97, opacity: 0, y: 18 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.98, opacity: 0, y: 10 }}
                onClick={(event) => event.stopPropagation()}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="admin-override-title"
                aria-describedby="admin-override-description"
                className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-[1.75rem] border border-amber-500/30 bg-background shadow-2xl sm:max-h-[calc(100vh-3rem)]"
            >
                <header className="border-b border-white/10 p-5">
                    <h2 id="admin-override-title" className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
                        <ShieldAlert className="h-5 w-5 text-amber-400" />
                        {isSeries ? 'La serie tiene restricciones' : 'La cita tiene restricciones'}
                    </h2>
                    <p id="admin-override-description" className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {isSeries
                            ? `${groups.length} de ${totalSessions ?? groups.length} sesiones no cumplen las reglas normales de reserva. Si confirmas, se crea la serie completa; si algo falla, no se crea ninguna cita.`
                            : 'La franja elegida no cumple las reglas normales de reserva. Puedes crearla igualmente como administrador.'}
                    </p>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                    {prompt.changed && (
                        <p role="alert" className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                            Las condiciones han cambiado desde que abriste este aviso. Revisa los motivos actualizados y vuelve a confirmar.
                        </p>
                    )}

                    <ul className="space-y-2" aria-label="Fechas afectadas">
                        {groups.map((group) => (
                            <li
                                key={`${group.date}T${group.time}`}
                                className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3"
                            >
                                <div className="flex items-center gap-2 text-sm font-semibold capitalize text-[var(--color-text-primary)]">
                                    <CalendarClock className="h-4 w-4 shrink-0 text-amber-400" />
                                    {formatLongDate(group.date)} · {group.time}
                                </div>
                                <ul className="mt-1.5 space-y-1 pl-6 text-sm text-amber-200/90">
                                    {group.restrictions.map((restriction) => (
                                        <li key={restriction.reason} className="list-disc">{describeAdminRestriction(restriction)}</li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>

                    {prompt.requiresPastConfirmation && (
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                            <input
                                type="checkbox"
                                checked={pastConfirmed}
                                disabled={saving}
                                onChange={(event) => setPastConfirmedFor(event.target.checked ? prompt.fingerprint : null)}
                                className="mt-0.5 h-4 w-4 accent-red-500"
                            />
                            <span>
                                Confirmo que quiero registrar {isSeries ? 'sesiones' : 'una cita'} en fecha pasada.
                                Se descontarán los minutos del bono y no se enviarán avisos al cliente por esas sesiones.
                            </span>
                        </label>
                    )}

                    <p className="text-xs text-[var(--color-text-secondary)]">
                        La excepción quedará registrada con tu usuario, la fecha y los motivos superados. Antes de crear se vuelve a validar todo en el servidor.
                    </p>
                </div>

                <footer className="flex flex-col gap-3 border-t border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-h-[1.25rem] text-sm">
                        {error && (
                            <span role="alert" className="flex items-center gap-2 text-red-400">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={saving}
                            className="rounded-xl border border-white/10 px-4 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={() => onConfirm({ fingerprint: prompt.fingerprint, confirmPastDate: pastConfirmed })}
                            disabled={!canConfirm}
                            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-2.5 font-semibold text-[var(--color-bg-base)] transition-all disabled:opacity-50"
                        >
                            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {saving ? 'Guardando...' : 'Confirmar'}
                        </button>
                    </div>
                </footer>
            </motion.div>
        </motion.div>
    );
}
