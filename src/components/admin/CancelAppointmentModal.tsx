'use client';

import { useEffect, useId, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Hourglass, CalendarX, Check, RefreshCw, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type CancellationCharge, previewCancellationMinutes } from '@/lib/appointment-cancellation';
import type { Appointment } from '@/types';

export interface CancelAppointmentModalProps {
    appointment: Pick<Appointment,
        'name' | 'status' | 'appointmentType' | 'bonoId' | 'minutesDeducted' | 'minutesDeductedAmount' | 'minutesDeductedAt' | 'minutesRefundedAt' | 'recurrenceSeriesId'>;
    /** Fecha y hora ya formateadas para el admin. */
    whenLabel: string;
    saving: boolean;
    error?: string;
    onConfirm: (charge: CancellationCharge) => void;
    onCancel: () => void;
}

interface OptionCopy {
    value: CancellationCharge;
    title: string;
    description: string;
    icon: typeof Undo2;
}

function optionCopies(consumedMinutes: number, noMinutesReason: string | null): OptionCopy[] {
    return [
        {
            value: 'not_charged',
            title: 'Sin cargo',
            description: consumedMinutes > 0
                ? `Se libera la plaza y se devuelven ${consumedMinutes} min al bono.`
                : `Se libera la plaza. ${noMinutesReason ?? 'No hay minutos que devolver.'}`,
            icon: Undo2,
        },
        {
            value: 'charged',
            title: 'Con cargo',
            description: consumedMinutes > 0
                ? `Se libera la plaza y se mantienen los ${consumedMinutes} min consumidos. No cuenta como sesión realizada ni como hora del entrenador.`
                : `Se libera la plaza. ${noMinutesReason ?? 'No hay minutos descontados'}: no se cobrará nada adicional. No cuenta como hora del entrenador.`,
            icon: Hourglass,
        },
    ];
}

export function CancelAppointmentModal({
    appointment,
    whenLabel,
    saving,
    error,
    onConfirm,
    onCancel,
}: CancelAppointmentModalProps) {
    const titleId = useId();
    const descriptionId = useId();
    // Deliberately no default: the admin must choose the modality explicitly.
    const [charge, setCharge] = useState<CancellationCharge | null>(null);
    const preview = previewCancellationMinutes(appointment);
    const noMinutesReason = preview.consumedMinutes > 0
        ? null
        : preview.isNutrition
            ? 'Las consultas de nutrición no consumen minutos.'
            : !preview.hasBono
                ? 'La cita no tiene bono asociado.'
                : 'La cita todavía no había descontado minutos del bono.';
    const options = optionCopies(preview.consumedMinutes, noMinutesReason);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !saving) onCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onCancel, saving]);

    return (
        <motion.div
            key="cancel-appointment"
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
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-background shadow-2xl sm:max-h-[calc(100vh-3rem)]"
            >
                <header className="border-b border-white/10 p-5">
                    <h2 id={titleId} className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
                        <CalendarX className="h-5 w-5 text-red-400" />
                        Cancelar cita
                    </h2>
                    <p id={descriptionId} className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {appointment.name} · {whenLabel}
                        {appointment.status === 'pending' ? ' · Pendiente de aprobación' : ''}
                    </p>
                </header>

                <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    <p className="text-sm text-[var(--color-text-primary)]">¿Cómo quieres cancelarla?</p>
                    <div role="radiogroup" aria-label="Modalidad de cancelación" className="space-y-3">
                        {options.map((option) => {
                            const selected = charge === option.value;
                            const Icon = option.icon;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    disabled={saving}
                                    onClick={() => setCharge(option.value)}
                                    className={cn(
                                        'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all disabled:opacity-60',
                                        selected
                                            ? option.value === 'charged'
                                                ? 'border-amber-500/50 bg-amber-500/10'
                                                : 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]'
                                            : 'border-white/10 hover:border-white/20 hover:bg-muted/20',
                                    )}
                                >
                                    <span className={cn(
                                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                        option.value === 'charged' ? 'bg-amber-500/15 text-amber-300' : 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]',
                                    )}>
                                        <Icon className="h-4 w-4" />
                                    </span>
                                    <span className="flex-1">
                                        <span className="block font-semibold text-[var(--color-text-primary)]">{option.title}</span>
                                        <span className="mt-0.5 block text-sm text-[var(--color-text-secondary)]">{option.description}</span>
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                            selected ? 'border-transparent bg-[var(--color-accent-val)] text-[var(--color-bg-base)]' : 'border-white/20',
                                        )}
                                    >
                                        {selected && <Check className="h-3 w-3" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {appointment.recurrenceSeriesId && (
                        <p className="text-xs text-[var(--color-text-secondary)]">
                            Solo se cancela esta sesión; el resto de la serie no cambia.
                        </p>
                    )}
                    <p className="text-xs text-[var(--color-text-secondary)]">
                        La cita no se borra: queda en el historial con la modalidad, tu usuario y la fecha. El cliente recibe el aviso habitual de cancelación.
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
                            Volver
                        </button>
                        <button
                            type="button"
                            onClick={() => { if (charge) onConfirm(charge); }}
                            disabled={!charge || saving}
                            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-red-600 px-6 py-2.5 font-semibold text-white transition-all disabled:opacity-50"
                        >
                            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarX className="h-4 w-4" />}
                            {saving ? 'Cancelando...' : 'Cancelar cita'}
                        </button>
                    </div>
                </footer>
            </motion.div>
        </motion.div>
    );
}
