'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import {
    formatLongDate,
    formatMonthTitle,
    getMonthGrid,
    shiftMonth,
    WEEKDAY_LABELS,
} from '@/components/admin/appointments/appointment-calendar-utils';
import { useCapacityChangeConfirmation } from '@/components/admin/useCapacityChangeConfirmation';
import {
    deleteCapacityExceptionsFromAdmin,
    subscribeCapacityExceptionsInRange,
    upsertCapacityExceptionsFromAdmin,
} from '@/lib/firestore';
import { MAX_CAPACITY_EXCEPTION_DATES, type CapacityException } from '@/lib/capacity-exceptions';
import { getMadridDateKey } from '@/lib/madrid-date';
import { MAX_MAX_CAPACITY, MIN_MAX_CAPACITY, normalizeMaxCapacity } from '@/lib/site-config';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface CapacityExceptionsCardProps {
    globalCapacity: number;
    /** site_config.capacityExceptionsEnabled: new exceptions are refused by the server until it is on. */
    enabled: boolean;
    /** Injected in tests; Madrid "today" otherwise. */
    todayKey?: string;
    className?: string;
}

function notify(title: string, description: string, destructive = false) {
    const t = toast({ title, description, ...(destructive ? { variant: 'destructive' as const } : {}) });
    setTimeout(() => t.dismiss(), destructive ? 4500 : 3500);
}

function errorText(error: unknown): string {
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? message : 'No se ha modificado el aforo. Inténtalo de nuevo.';
}

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/**
 * "Aforo por fecha": the admin selects several days on a month grid and gives
 * them their own capacity, or removes it so they follow the global value.
 * Every change goes through Cloud Functions, which asks for confirmation when
 * approved appointments exceed the new capacity and never touches them.
 */
export function CapacityExceptionsCard({ globalCapacity, enabled, todayKey: todayOverride, className }: CapacityExceptionsCardProps) {
    const todayKey = todayOverride ?? getMadridDateKey(new Date());
    const [todayYear, todayMonth] = todayKey.split('-').map(Number);
    const [month, setMonth] = useState({ year: todayYear, monthIndex: todayMonth - 1 });
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [capacity, setCapacity] = useState(() => Math.max(MIN_MAX_CAPACITY, globalCapacity - 1));
    const [exceptions, setExceptions] = useState<CapacityException[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [saving, setSaving] = useState(false);
    const confirmation = useCapacityChangeConfirmation();

    useEffect(() => subscribeCapacityExceptionsInRange(
        todayKey,
        undefined,
        (next) => {
            setExceptions(next);
            setLoadError(false);
        },
        (error) => {
            console.error('Error cargando el aforo por fecha:', error);
            setLoadError(true);
        },
    ), [todayKey]);

    const byDate = useMemo(() => new Map(exceptions.map((item) => [item.date, item.maxCapacity])), [exceptions]);
    const grid = useMemo(() => getMonthGrid(month.year, month.monthIndex), [month]);
    const selectedDates = useMemo(() => [...selected].sort(), [selected]);
    const selectedWithException = selectedDates.filter((date) => byDate.has(date));
    const canGoBack = month.year > todayYear || (month.year === todayYear && month.monthIndex > todayMonth - 1);
    const busy = saving || confirmation.waiting;

    const toggle = (date: string) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(date)) next.delete(date);
            else if (next.size < MAX_CAPACITY_EXCEPTION_DATES) next.add(date);
            return next;
        });
    };

    const finish = (title: string, description: string) => {
        setSelected(new Set());
        notify(title, description);
    };

    const save = async () => {
        if (selectedDates.length === 0 || !enabled) return;
        const dates = selectedDates;
        const maxCapacity = normalizeMaxCapacity(capacity);
        setSaving(true);
        try {
            await confirmation.run(async ({ requestId, acknowledgedRestrictions }) => {
                await upsertCapacityExceptionsFromAdmin({ dates, maxCapacity, requestId, acknowledgedRestrictions });
                finish('Aforo por fecha guardado', `${plural(dates.length, 'día', 'días')} con aforo ${maxCapacity}.`);
            });
        } catch (error) {
            notify('Error al guardar el aforo', errorText(error), true);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (dates: string[]) => {
        if (dates.length === 0) return;
        setSaving(true);
        try {
            await confirmation.run(async ({ requestId, acknowledgedRestrictions }) => {
                await deleteCapacityExceptionsFromAdmin({ dates, requestId, acknowledgedRestrictions });
                finish('Excepción eliminada', `${plural(dates.length, 'día vuelve', 'días vuelven')} al aforo general (${globalCapacity}).`);
            });
        } catch (error) {
            notify('Error al eliminar el aforo', errorText(error), true);
        } finally {
            setSaving(false);
        }
    };

    const edit = (item: CapacityException) => {
        const [year, monthNumber] = item.date.split('-').map(Number);
        setMonth({ year, monthIndex: monthNumber - 1 });
        setSelected(new Set([item.date]));
        setCapacity(item.maxCapacity);
    };

    return (
        <GlassCard className={cn('p-6', className)}>
            <div className="mb-2 flex items-center gap-3">
                <CalendarRange className="h-5 w-5 text-[var(--color-accent-val)]" />
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Aforo por fecha</h2>
            </div>
            <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
                Selecciona uno o varios días y asígnales un aforo distinto del general ({globalCapacity} persona(s)).
                Las citas ya aprobadas nunca se cancelan ni se modifican.
            </p>

            {!enabled && (
                <p role="status" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                    El aforo por fecha todavía no está activado: se activará cuando las nuevas versiones de la app estén
                    disponibles en Google Play y App Store. Mientras tanto puedes consultar y eliminar excepciones, pero no crear nuevas.
                </p>
            )}
            {loadError && (
                <p role="alert" className="mb-5 text-sm text-red-400">No se ha podido cargar el aforo por fecha.</p>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <button
                            type="button"
                            aria-label="Mes anterior"
                            disabled={!canGoBack}
                            onClick={() => setMonth(shiftMonth(month.year, month.monthIndex, -1))}
                            className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-muted/50 disabled:opacity-30"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="font-medium capitalize text-[var(--color-text-primary)]" aria-live="polite">
                            {formatMonthTitle(month.year, month.monthIndex)}
                        </span>
                        <button
                            type="button"
                            aria-label="Mes siguiente"
                            onClick={() => setMonth(shiftMonth(month.year, month.monthIndex, 1))}
                            className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-muted/50"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] font-semibold text-[var(--color-text-secondary)]">
                        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
                    </div>
                    <div role="group" aria-label="Días del mes" className="mt-1 grid grid-cols-7 gap-1">
                        {grid.map((cell) => {
                            const past = cell.date < todayKey;
                            const exception = byDate.get(cell.date);
                            const isSelected = selected.has(cell.date);
                            if (!cell.inCurrentMonth) return <span key={cell.date} aria-hidden="true" />;
                            return (
                                <button
                                    key={cell.date}
                                    type="button"
                                    disabled={past || busy}
                                    aria-pressed={isSelected}
                                    aria-label={`${formatLongDate(cell.date)}${exception !== undefined ? `, aforo ${exception}` : ''}`}
                                    onClick={() => toggle(cell.date)}
                                    className={cn(
                                        'flex min-h-[3rem] flex-col items-center justify-center rounded-lg border text-sm transition-colors',
                                        past
                                            ? 'cursor-not-allowed border-transparent text-[var(--color-text-secondary)] opacity-40'
                                            : 'border-white/10 text-[var(--color-text-primary)] hover:border-[var(--color-accent-border)]',
                                        exception !== undefined && !past && 'border-amber-500/40 bg-amber-500/10',
                                        isSelected && 'border-[var(--color-accent-val)] bg-[var(--color-accent-dim)] ring-1 ring-[var(--color-accent-val)]',
                                    )}
                                >
                                    <span>{cell.day}</span>
                                    {exception !== undefined && (
                                        <span className="text-[0.65rem] font-semibold text-amber-300">Aforo {exception}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="capacity-exception-value" className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
                            Aforo para los días seleccionados
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                id="capacity-exception-value"
                                type="number"
                                min={MIN_MAX_CAPACITY}
                                max={MAX_MAX_CAPACITY}
                                value={capacity}
                                disabled={!enabled || busy}
                                onChange={(event) => setCapacity(normalizeMaxCapacity(event.target.value))}
                                className="w-24 rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none disabled:opacity-50"
                            />
                            <span className="text-sm text-[var(--color-text-secondary)]">personas</span>
                        </div>
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
                        {selectedDates.length === 0 ? 'Ningún día seleccionado.' : `${plural(selectedDates.length, 'día seleccionado', 'días seleccionados')}.`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={save}
                            disabled={!enabled || busy || selectedDates.length === 0}
                            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright px-5 py-2.5 font-semibold text-[var(--color-bg-base)] transition-all disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Guardar aforo
                        </button>
                        {selectedWithException.length > 0 && (
                            <button
                                type="button"
                                onClick={() => remove(selectedWithException)}
                                disabled={busy}
                                className="flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                Quitar excepción
                            </button>
                        )}
                        {selectedDates.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSelected(new Set())}
                                disabled={busy}
                                className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                            >
                                <X className="h-4 w-4" />
                                Limpiar selección
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
                <h3 className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Próximas excepciones</h3>
                {exceptions.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)]">No hay días con aforo propio: se aplica el aforo general.</p>
                ) : (
                    <ul className="divide-y divide-white/5" aria-label="Próximas excepciones">
                        {exceptions.map((item) => (
                            <li key={item.date} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                                <span className="capitalize text-[var(--color-text-primary)]">{formatLongDate(item.date)}</span>
                                <span className="flex items-center gap-2">
                                    <strong className="text-amber-300">Aforo {item.maxCapacity}</strong>
                                    <button
                                        type="button"
                                        onClick={() => edit(item)}
                                        disabled={busy || !enabled}
                                        aria-label={`Editar el aforo del ${formatLongDate(item.date)}`}
                                        className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)] disabled:opacity-40"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => remove([item.date])}
                                        disabled={busy}
                                        aria-label={`Eliminar el aforo del ${formatLongDate(item.date)}`}
                                        className="rounded-lg p-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {confirmation.modal}
        </GlassCard>
    );
}
