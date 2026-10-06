'use client';

import { AlertTriangle, CalendarClock, CheckCircle2, CircleSlash, RotateCcw, Undo2 } from 'lucide-react';
import { canRescheduleRenewalRow, renewalReasonLabel, type RenewalRow } from '@/lib/bono-renewal';
import { cn } from '@/lib/utils';
import type { TimeSlot } from '@/types';

export function formatRenewalSlot(slot: TimeSlot): string {
    const [year, month, day] = slot.date.split('-').map(Number);
    const label = new Intl.DateTimeFormat('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
    return `${label} · ${slot.time}`;
}

function sameSlot(a: TimeSlot, b: TimeSlot): boolean {
    return a.date === b.date && a.time === b.time;
}

interface RenewalPreviewPanelProps {
    rows: RenewalRow[];
    busy: boolean;
    onSkip: (key: string) => void;
    onInclude: (key: string) => void;
    onReschedule: (row: RenewalRow) => void;
}

export function RenewalPreviewPanel({ rows, busy, onSkip, onInclude, onReschedule }: RenewalPreviewPanelProps) {
    const ready = rows.filter((row) => row.decision === 'include' && row.status === 'ready').length;
    const conflicts = rows.filter((row) => row.decision === 'include' && row.status === 'conflict').length;
    const skipped = rows.filter((row) => row.decision === 'skip' && row.status !== 'created').length;
    const created = rows.filter((row) => row.status === 'created').length;

    if (rows.length === 0) {
        return (
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-[var(--color-text-secondary)]">
                No hay citas que repetir dentro de la validez del nuevo bono.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-400">{ready} listas</span>
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-red-400">{conflicts} con conflicto</span>
                <span className="rounded-full bg-white/5 px-3 py-1 text-[var(--color-text-secondary)]">{skipped} omitidas</span>
                {created > 0 && <span className="rounded-full bg-sky-500/10 px-3 py-1 text-sky-400">{created} creadas</span>}
            </div>
            <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1" aria-label="Citas a renovar">
                {rows.map((row) => {
                    const isSkipped = row.decision === 'skip' && row.status !== 'created';
                    const isConflict = !isSkipped && row.status === 'conflict';
                    const moved = !sameSlot(row.slot, row.originalSlot);
                    return (
                        <li
                            key={row.key}
                            data-testid={`renewal-row-${row.key}`}
                            className={cn(
                                'rounded-xl border p-3 text-sm',
                                isConflict && 'border-red-500/40 bg-red-500/[0.06]',
                                isSkipped && 'border-white/10 bg-white/[0.01] opacity-60',
                                !isConflict && !isSkipped && row.status === 'created' && 'border-sky-500/30 bg-sky-500/[0.05]',
                                !isConflict && !isSkipped && row.status === 'ready' && 'border-emerald-500/30 bg-emerald-500/[0.04]',
                            )}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                    <div className="font-semibold text-[var(--color-text-primary)]">
                                        {formatRenewalSlot(row.slot)} · {row.durationMinutes} min
                                    </div>
                                    {moved && (
                                        <div className="text-xs text-[var(--color-text-secondary)]">
                                            Patrón original: {formatRenewalSlot(row.originalSlot)}
                                        </div>
                                    )}
                                    <div className="text-xs text-[var(--color-text-secondary)]">
                                        {row.trainerName || 'Sin entrenador'}
                                    </div>
                                </div>
                                <div className="text-right text-xs">
                                    {row.status === 'created' && (
                                        <span className="flex items-center gap-1 text-sky-400"><CheckCircle2 className="h-3.5 w-3.5" /> Creada (pendiente del cliente)</span>
                                    )}
                                    {isSkipped && (
                                        <span className="flex items-center gap-1 text-[var(--color-text-secondary)]"><CircleSlash className="h-3.5 w-3.5" /> Omitida</span>
                                    )}
                                    {!isSkipped && row.status === 'ready' && (
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            <CheckCircle2 className="h-3.5 w-3.5" /> {row.modified ? 'Lista (modificada)' : 'Lista para crear'}
                                        </span>
                                    )}
                                    {isConflict && (
                                        <span className="flex items-center gap-1 font-semibold text-red-400">
                                            <AlertTriangle className="h-3.5 w-3.5" /> {renewalReasonLabel(row.reason)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {row.status !== 'created' && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {isSkipped ? (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onInclude(row.key)}
                                            className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                                        >
                                            <Undo2 className="h-3.5 w-3.5" /> Volver a incluir
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onSkip(row.key)}
                                            className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                                        >
                                            <CircleSlash className="h-3.5 w-3.5" /> Omitir esta cita
                                        </button>
                                    )}
                                    {(isConflict ? canRescheduleRenewalRow(row) : !isSkipped) && (
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => onReschedule(row)}
                                            className={cn(
                                                'flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50',
                                                isConflict
                                                    ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                                                    : 'border-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                                            )}
                                        >
                                            {isConflict ? <CalendarClock className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                            Cambiar fecha/hora
                                        </button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
