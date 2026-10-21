'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus, type LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import { type OccupancyStats, relativeChange, WEEKDAY_LABELS } from '@/lib/admin-statistics';

const percentFormat = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });
const preciseFormat = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 });

export function formatPercent(value: number | null, precise = false): string {
    if (value === null) return '—';
    return (precise ? preciseFormat : percentFormat).format(value);
}

export function formatNumber(value: number): string {
    return value.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

/**
 * Change against the previous period. `tone` says whether going up is good
 * (sessions), bad (charged cancellations) or neither.
 */
export function DeltaBadge({
    current,
    previous,
    tone = 'up-good',
    previousLabel,
}: {
    current: number | null;
    previous: number | null;
    tone?: 'up-good' | 'up-bad' | 'neutral';
    previousLabel?: string;
}) {
    const change = relativeChange({ current, previous });
    const title = previous === null ? undefined : `Período anterior: ${previousLabel ?? formatNumber(previous)}`;
    if (change === null) {
        return (
            <span title={title} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-base)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                <Minus className="h-3 w-3" aria-hidden="true" />
                {previous === 0 ? 'Sin datos previos' : 'Sin comparar'}
            </span>
        );
    }
    const up = change > 0;
    const flat = Math.abs(change) < 0.005;
    const good = tone === 'neutral' || flat ? null : (tone === 'up-good') === up;
    const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                good === null && 'border-[var(--color-border-base)] text-[var(--color-text-secondary)]',
                good === true && 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]',
                good === false && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
            )}
        >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {flat ? '0 %' : `${up ? '+' : ''}${percentFormat.format(change)}`}
            <span className="sr-only"> respecto al período anterior</span>
        </span>
    );
}

export function KpiCard({
    icon: Icon,
    label,
    value,
    hint,
    delta,
    accent = 'from-[var(--color-accent-val)] to-[#2d6a4f]',
}: {
    icon: LucideIcon;
    label: string;
    value: string;
    hint?: ReactNode;
    delta?: ReactNode;
    accent?: string;
}) {
    return (
        <GlassCard className="p-5" hover={false}>
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br', accent)}>
                    <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                </div>
                {delta}
            </div>
            <div className="text-2xl font-bold text-[var(--color-text-primary)] sm:text-3xl">{value}</div>
            <div className="mt-1 text-sm text-[var(--color-text-secondary)]">{label}</div>
            {hint && <div className="mt-2 text-xs text-[var(--color-text-muted)]">{hint}</div>}
        </GlassCard>
    );
}

export function StatsSection({
    id,
    icon: Icon,
    title,
    description,
    actions,
    scopeNote,
    children,
}: {
    id: string;
    icon: LucideIcon;
    title: string;
    description?: string;
    actions?: ReactNode;
    /** e.g. "Todo el centro" when the trainer filter does not apply. */
    scopeNote?: string;
    children: ReactNode;
}) {
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
                        <Icon className="h-5 w-5 text-[var(--color-accent-val)]" aria-hidden="true" />
                        {title}
                        {scopeNote && (
                            <span className="rounded-full border border-[var(--color-border-base)] px-2 py-0.5 text-[11px] font-normal text-[var(--color-text-secondary)]">
                                {scopeNote}
                            </span>
                        )}
                    </h2>
                    {description && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>}
                </div>
                {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
    return (
        <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">{children}</h3>
            {aside}
        </div>
    );
}

export function MiniStat({ label, value, tone = 'default', hint }: { label: string; value: string; tone?: 'default' | 'accent' | 'amber' | 'muted'; hint?: string }) {
    return (
        <div className="rounded-xl border border-[var(--color-border-base)] bg-muted/10 p-3">
            <div className={cn(
                'text-xl font-bold',
                tone === 'default' && 'text-[var(--color-text-primary)]',
                tone === 'accent' && 'text-[var(--color-accent-val)]',
                tone === 'amber' && 'text-amber-300',
                tone === 'muted' && 'text-[var(--color-text-secondary)]',
            )}>
                {value}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{label}</div>
            {hint && <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">{hint}</div>}
        </div>
    );
}

export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="inline-flex items-center gap-1 text-sm text-[var(--color-accent-val)] hover:underline">
            {children}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
    );
}

export function EmptyState({ children }: { children: ReactNode }) {
    return <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">{children}</p>;
}

/** Horizontal share bar used inside tables. */
export function ShareBar({ value, max, color = 'var(--color-accent-val)' }: { value: number; max: number; color?: string }) {
    const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    return (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${value > 0 ? width : 0}%`, background: color }} />
        </div>
    );
}

/** Weekday × hour occupancy grid; colour intensity follows the occupancy rate. */
export function OccupancyHeatmap({ occupancy }: { occupancy: OccupancyStats }) {
    if (occupancy.hours.length === 0) return <EmptyState>No hay horario configurado.</EmptyState>;
    const cell = (weekday: number, hour: number) => occupancy.heatmap.find((item) => item.weekday === weekday && item.hour === hour);
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-1 text-[11px]">
                <caption className="sr-only">Ocupación media por día de la semana y hora</caption>
                <thead>
                    <tr>
                        <th scope="col" className="w-10" />
                        {occupancy.hours.map((hour) => (
                            <th key={hour} scope="col" className="font-normal text-[var(--color-text-secondary)]">{String(hour).padStart(2, '0')}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {WEEKDAY_LABELS.map((label, weekday) => (
                        <tr key={label}>
                            <th scope="row" className="pr-1 text-left font-normal text-[var(--color-text-secondary)]">{label}</th>
                            {occupancy.hours.map((hour) => {
                                const item = cell(weekday, hour);
                                const rate = item?.rate ?? null;
                                const description = rate === null
                                    ? `${label} ${hour}:00 · cerrado o bloqueado`
                                    : `${label} ${hour}:00 · ${formatPercent(rate)} de ocupación · ${item?.sessions ?? 0} sesiones`;
                                return (
                                    <td
                                        key={hour}
                                        title={description}
                                        aria-label={description}
                                        className="h-8 rounded-md text-center align-middle font-medium"
                                        style={{
                                            background: rate === null
                                                ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0 4px, transparent 4px 8px)'
                                                : `rgba(82, 183, 136, ${0.06 + rate * 0.8})`,
                                            color: rate !== null && rate > 0.45 ? '#080808' : 'rgba(255,255,255,0.6)',
                                        }}
                                    >
                                        {rate === null ? '' : Math.round(rate * 100)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                % de plazas ocupadas por citas aprobadas en cada hora. Las celdas rayadas están fuera de horario o bloqueadas.
            </p>
        </div>
    );
}
