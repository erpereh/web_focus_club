'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
    AlertOctagon,
    AlertTriangle,
    Hourglass,
    BarChart3,
    CalendarCheck,
    CalendarClock,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Download,
    Dumbbell,
    Gauge,
    Info,
    ListChecks,
    RefreshCw,
    Ticket,
    UserCheck,
    Users,
    XCircle,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumSelect } from '@/components/ui/premium-select';
import { cn } from '@/lib/utils';
import { formatTrainerDuration } from '@/lib/trainer-stats';
import { getMadridDateKey } from '@/lib/madrid-date';
import { buildAdminDeepLink } from '@/lib/admin-deep-link';
import { CANCELLATION_CATEGORY_SHORT_LABELS } from '@/lib/appointment-cancellation';
import { getStatisticsData, type StatisticsData, type StatisticsDataRequest } from '@/lib/firestore';
import {
    calculateStatistics,
    cancellationsCsv,
    EXPIRING_SOON_DAYS,
    LOW_MINUTES_THRESHOLD,
    RETENTION_INACTIVE_DAYS,
    RETENTION_LOOKBACK_DAYS,
    type ReviewSeverity,
    trainersCsv,
    UPCOMING_OCCUPANCY_CHECK_DAYS,
    WEEKDAY_LABELS,
} from '@/lib/admin-statistics';
import {
    currentPeriod,
    customPeriod,
    formatDateKey,
    MAX_CUSTOM_PERIOD_DAYS,
    periodLabel,
    previousPeriod,
    shiftPeriod,
    type StatsPeriod,
    type StatsPeriodKind,
} from '@/lib/admin-statistics-period';
import {
    CardTitle,
    DeltaBadge,
    EmptyState,
    formatNumber,
    formatPercent,
    KpiCard,
    MiniStat,
    OccupancyHeatmap,
    SectionLink,
    ShareBar,
    StatsSection,
} from './StatisticsParts';

function ChartSkeleton({ height = 'h-64' }: { height?: string }) {
    return <div className={cn('w-full animate-pulse rounded-xl bg-white/[0.03]', height)} aria-hidden="true" />;
}

// Recharts only on the client: smaller first load and no zero-size render during the static export.
const TrainingEvolutionChart = dynamic(() => import('./StatisticsCharts').then((mod) => mod.TrainingEvolutionChart), {
    ssr: false, loading: () => <ChartSkeleton height="h-72" />,
});
const CancellationEvolutionChart = dynamic(() => import('./StatisticsCharts').then((mod) => mod.CancellationEvolutionChart), {
    ssr: false, loading: () => <ChartSkeleton />,
});
const OccupancyEvolutionChart = dynamic(() => import('./StatisticsCharts').then((mod) => mod.OccupancyEvolutionChart), {
    ssr: false, loading: () => <ChartSkeleton />,
});
const OccupancyByHourChart = dynamic(() => import('./StatisticsCharts').then((mod) => mod.OccupancyByHourChart), {
    ssr: false, loading: () => <ChartSkeleton height="h-56" />,
});

const PERIOD_OPTIONS: { value: StatsPeriodKind; label: string }[] = [
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
    { value: 'year', label: 'Año' },
    { value: 'custom', label: 'Personalizado' },
];

const SECTIONS = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'entrenamientos', label: 'Entrenamientos' },
    { id: 'entrenadores', label: 'Entrenadores' },
    { id: 'cancelaciones', label: 'Cancelaciones' },
    { id: 'clientes', label: 'Clientes y bonos' },
    { id: 'ocupacion', label: 'Ocupación' },
    { id: 'revisar', label: 'Revisar' },
] as const;

const SEVERITY_STYLE: Record<ReviewSeverity, { icon: typeof Info; className: string }> = {
    critical: { icon: AlertOctagon, className: 'border-red-500/30 bg-red-500/[0.06] text-red-300' },
    warning: { icon: AlertTriangle, className: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300' },
    info: { icon: Info, className: 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]' },
};

const LIST_PREVIEW = 8;

function downloadCsv(content: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function ActionButton({ onClick, icon: Icon, children, disabled }: { onClick: () => void; icon: typeof Download; children: string; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-base)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {children}
        </button>
    );
}

function percentOf(value: number, total: number): number | null {
    return total > 0 ? value / total : null;
}

export function StatisticsDashboard({
    loadData = getStatisticsData,
}: {
    /** Bounded Firestore reads; replaceable for previews. */
    loadData?: (request: StatisticsDataRequest) => Promise<StatisticsData>;
} = {}) {
    const [period, setPeriod] = useState<StatsPeriod>(() => currentPeriod('month', new Date()));
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [customError, setCustomError] = useState('');
    const [trainerId, setTrainerId] = useState('all');
    const [loaded, setLoaded] = useState<{ key: string; data: StatisticsData; at: Date } | null>(null);
    const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const requestRef = useRef(0);

    const previous = useMemo(() => previousPeriod(period), [period]);
    // Loading and error are derived from the request key: the effect only sets state when a read finishes.
    const requestKey = `${period.kind}|${period.startKey}|${period.endKey}|${reloadToken}`;
    const loading = loaded?.key !== requestKey && failed?.key !== requestKey;
    const error = failed?.key === requestKey ? failed.message : '';
    const data = loaded?.data ?? null;
    const loadedAt = loaded?.at ?? null;

    useEffect(() => {
        const requestId = ++requestRef.current;
        const now = new Date();
        loadData({
            period,
            previous,
            todayKey: getMadridDateKey(now),
            retentionLookbackDays: RETENTION_LOOKBACK_DAYS,
            occupancyCheckDays: UPCOMING_OCCUPANCY_CHECK_DAYS,
        })
            .then((next) => {
                if (requestId !== requestRef.current) return;
                setLoaded({ key: requestKey, data: next, at: now });
            })
            .catch((loadError: unknown) => {
                if (requestId !== requestRef.current) return;
                console.error('No se han podido cargar las estadísticas.', loadError);
                setFailed({ key: requestKey, message: 'No se han podido cargar las estadísticas. Comprueba tu conexión e inténtalo de nuevo.' });
            });
    }, [loadData, period, previous, requestKey]);

    const selectedTrainer = trainerId === 'all' ? null : trainerId;
    const result = useMemo(() => (data && loadedAt ? calculateStatistics({
        period,
        previous,
        now: loadedAt,
        trainerId: selectedTrainer,
        appointments: data.appointments,
        trainers: data.trainers,
        clients: data.clients,
        activeBonos: data.activeBonos,
        bonoHistory: data.bonoHistory,
        siteConfig: data.siteConfig,
        blockedSlots: data.blockedSlots,
        upcomingOccupancy: data.upcomingOccupancy,
        pendingApprovalCount: data.pendingApprovalCount,
    }) : null), [data, loadedAt, period, previous, selectedTrainer]);

    const trainerOptions = useMemo(() => [
        { value: 'all', label: 'Todos los entrenadores' },
        ...[...(data?.trainers ?? [])]
            .sort((left, right) => Number(right.active !== false) - Number(left.active !== false) || left.name.localeCompare(right.name, 'es'))
            .map((trainer) => ({ value: trainer.id, label: trainer.active === false ? `${trainer.name} (inactivo)` : trainer.name, muted: trainer.active === false })),
    ], [data?.trainers]);

    const selectKind = useCallback((kind: StatsPeriodKind) => {
        setCustomError('');
        if (kind === 'custom') {
            setCustomStart(period.startKey);
            setCustomEnd(period.endKey);
            setPeriod({ ...period, kind: 'custom' });
            return;
        }
        setPeriod(currentPeriod(kind, new Date()));
    }, [period]);

    const applyCustom = (start: string, end: string) => {
        setCustomStart(start);
        setCustomEnd(end);
        if (!start || !end) return;
        const next = customPeriod(start, end);
        if (!next) {
            setCustomError(`Elige un rango válido de ${MAX_CUSTOM_PERIOD_DAYS} días como máximo.`);
            return;
        }
        setCustomError('');
        setPeriod(next);
    };

    const filenameSuffix = `${period.startKey}_${period.endKey}`;
    const previousText = periodLabel(previous);
    const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

    return (
        <div className="space-y-8">
            {/* ---------------------------------------------------- title + filters */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Estadísticas</h1>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {periodLabel(period)} · comparado con {result?.comparison.partial
                            ? `${formatDateKey(result.comparison.startKey)} – ${formatDateKey(result.comparison.endKey)} (mismo tramo transcurrido)`
                            : previousText}
                    </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                    {loadedAt && <span>Datos de las {loadedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>}
                    <ActionButton icon={RefreshCw} onClick={() => setReloadToken((token) => token + 1)} disabled={loading}>
                        Actualizar
                    </ActionButton>
                </div>
            </div>

            <div className="glass-dark z-20 -mx-4 lg:sticky lg:top-16 space-y-3 border-y border-[var(--color-border-base)] px-4 py-3 sm:mx-0 sm:rounded-2xl sm:border">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div
                            role="group"
                            aria-label="Tipo de período"
                            className="flex w-full gap-1 overflow-x-auto rounded-xl border border-[var(--color-border-base)] bg-muted/20 p-1 sm:w-fit"
                        >
                            {PERIOD_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={period.kind === option.value}
                                    onClick={() => selectKind(option.value)}
                                    className={cn(
                                        'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                        period.kind === option.value
                                            ? 'bg-[var(--color-accent-val)] text-[var(--color-bg-base)] shadow-sm'
                                            : 'text-[var(--color-text-secondary)] hover:bg-muted/40 hover:text-[var(--color-text-primary)]',
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>

                        {period.kind === 'custom' ? (
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <label className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                                    Desde
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={(event) => applyCustom(event.target.value, customEnd)}
                                        className="rounded-lg border border-[var(--color-border-base)] bg-muted/20 px-2 py-1.5 text-[var(--color-text-primary)] [color-scheme:dark]"
                                    />
                                </label>
                                <label className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                                    Hasta
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={(event) => applyCustom(customStart, event.target.value)}
                                        className="rounded-lg border border-[var(--color-border-base)] bg-muted/20 px-2 py-1.5 text-[var(--color-text-primary)] [color-scheme:dark]"
                                    />
                                </label>
                                {customError && <span role="alert" className="text-xs text-red-400">{customError}</span>}
                            </div>
                        ) : (
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setPeriod(shiftPeriod(period, -1))}
                                    aria-label="Período anterior"
                                    className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="min-w-[10rem] text-center text-sm font-medium text-[var(--color-text-primary)]" aria-live="polite">
                                    {periodLabel(period)}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setPeriod(shiftPeriod(period, 1))}
                                    aria-label="Período siguiente"
                                    className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPeriod(currentPeriod(period.kind as Exclude<StatsPeriodKind, 'custom'>, new Date()))}
                                    className="ml-1 rounded-lg border border-[var(--color-border-base)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                >
                                    Actual
                                </button>
                            </div>
                        )}
                    </div>
                    <PremiumSelect
                        value={trainerId}
                        onChange={setTrainerId}
                        options={trainerOptions}
                        ariaLabel="Filtrar por entrenador"
                        size="compact"
                        className="w-full sm:w-64"
                    />
                </div>
                <nav aria-label="Secciones de estadísticas" className="flex gap-1 overflow-x-auto">
                    {SECTIONS.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className="shrink-0 rounded-full px-3 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-accent-dim)] hover:text-[var(--color-accent-val)]"
                        >
                            {section.label}
                        </a>
                    ))}
                </nav>
            </div>

            {error && (
                <GlassCard hover={false} className="flex flex-col items-start gap-3 border-red-500/30 sm:flex-row sm:items-center sm:justify-between">
                    <p role="alert" className="flex items-center gap-2 text-sm text-red-300">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {error}
                    </p>
                    <ActionButton icon={RefreshCw} onClick={() => setReloadToken((token) => token + 1)}>Reintentar</ActionButton>
                </GlassCard>
            )}

            {!result && !error && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Cargando estadísticas">
                    {Array.from({ length: 8 }, (_, index) => <ChartSkeleton key={index} height="h-36" />)}
                </div>
            )}

            {result && (
                <div className={cn('space-y-10 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
                    {/* ---------------------------------------------------- resumen */}
                    <StatsSection
                        id="resumen"
                        icon={BarChart3}
                        title="Resumen general"
                        description="Horas contabilizadas = sesiones aprobadas cuya hora ya ha pasado. No implica asistencia verificada."
                    >
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <KpiCard
                                icon={CalendarCheck}
                                label="Sesiones contabilizadas"
                                value={formatNumber(result.summary.countedSessions.current)}
                                delta={<DeltaBadge {...result.summary.countedSessions} />}
                            />
                            <KpiCard
                                icon={Clock3}
                                label="Horas contabilizadas de entrenadores"
                                value={formatTrainerDuration(result.summary.countedMinutes.current)}
                                delta={<DeltaBadge {...result.summary.countedMinutes} previousLabel={formatTrainerDuration(result.summary.countedMinutes.previous)} />}
                            />
                            <KpiCard
                                icon={Hourglass}
                                accent="from-amber-500 to-amber-700"
                                label="Cancelaciones con cargo"
                                value={formatNumber(result.summary.chargedCancellations.current)}
                                hint={`${formatTrainerDuration(result.summary.chargedMinutes.current)} cobrados sin entrenamiento`}
                                delta={<DeltaBadge {...result.summary.chargedCancellations} tone="up-bad" />}
                            />
                            <KpiCard
                                icon={XCircle}
                                accent="from-zinc-500 to-zinc-700"
                                label="Cancelaciones sin cargo"
                                value={formatNumber(result.summary.notChargedCancellations.current)}
                                hint={result.summary.unclassifiedCancellations.current > 0
                                    ? `+ ${result.summary.unclassifiedCancellations.current} sin clasificar (anteriores al cambio)`
                                    : undefined}
                                delta={<DeltaBadge {...result.summary.notChargedCancellations} tone="neutral" />}
                            />
                            <KpiCard
                                icon={UserCheck}
                                label="Clientes activos"
                                value={formatNumber(result.summary.activeClients.current)}
                                hint="Con al menos una sesión aprobada en el período"
                                delta={<DeltaBadge {...result.summary.activeClients} />}
                            />
                            <KpiCard
                                icon={Gauge}
                                accent="from-[#2d6a4f] to-[var(--color-accent-val)]"
                                label="Ocupación media"
                                value={formatPercent(result.summary.averageOccupancy.current, true)}
                                hint={`Aforo ${result.occupancy.capacity} · todo el centro${result.comparison.partial ? ' · hasta hoy' : ''}`}
                                delta={<DeltaBadge
                                    current={result.summary.averageOccupancy.current}
                                    previous={result.summary.averageOccupancy.previous}
                                    previousLabel={formatPercent(result.summary.averageOccupancy.previous, true)}
                                />}
                            />
                            <KpiCard
                                icon={Users}
                                label="Clientes nuevos"
                                value={formatNumber(result.clients.newClients.current)}
                                hint={`${result.clients.totalClients} clientes registrados`}
                                delta={<DeltaBadge {...result.clients.newClients} />}
                            />
                            <KpiCard
                                icon={Ticket}
                                label="Bonos activos"
                                value={formatNumber(result.clients.activeBonos)}
                                hint={`${formatTrainerDuration(result.clients.remainingActiveMinutes)} restantes en total`}
                            />
                        </div>
                    </StatsSection>

                    {/* ---------------------------------------------------- entrenamientos */}
                    <StatsSection
                        id="entrenamientos"
                        icon={Dumbbell}
                        title="Entrenamientos"
                        description={`Evolución ${result.training.granularity === 'day' ? 'diaria' : result.training.granularity === 'week' ? 'semanal' : 'mensual'} por fecha de la sesión.`}
                        actions={<SectionLink href={buildAdminDeepLink({ tab: 'appointments', ...(selectedTrainer ? { trainerId: selectedTrainer } : {}) })}>Ver citas</SectionLink>}
                    >
                        <GlassCard hover={false} className="p-4 sm:p-6">
                            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                                <MiniStat label="Contabilizadas" value={formatNumber(result.training.totals.counted)} tone="accent" />
                                <MiniStat label="Próximas aprobadas" value={formatNumber(result.training.totals.upcoming)} />
                                <Link href={buildAdminDeepLink({ tab: 'appointments', status: 'pending' })} className="block rounded-xl transition-colors hover:bg-white/[0.02]">
                                    <MiniStat label="Pendientes" value={formatNumber(result.training.totals.pending)} tone="amber" />
                                </Link>
                                <Link href={buildAdminDeepLink({ tab: 'appointments', status: 'cancelled' })} className="block rounded-xl transition-colors hover:bg-white/[0.02]">
                                    <MiniStat label="Canceladas" value={formatNumber(result.training.totals.cancelled)} tone="muted" />
                                </Link>
                                <MiniStat label="Rechazadas" value={formatNumber(result.training.totals.rejected)} tone="muted" />
                            </div>
                            <TrainingEvolutionChart training={result.training} />
                        </GlassCard>
                        <div className="grid gap-4 lg:grid-cols-2">
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Por duración</CardTitle>
                                {result.training.durationDistribution.length === 0 ? <EmptyState>Sin sesiones aprobadas.</EmptyState> : (
                                    <ul className="space-y-3">
                                        {result.training.durationDistribution.map((item) => {
                                            const total = result.training.durationDistribution.reduce((sum, entry) => sum + entry.sessions, 0);
                                            return (
                                                <li key={item.label} className="space-y-1.5">
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-[var(--color-text-primary)]">{item.label}</span>
                                                        <span className="text-[var(--color-text-secondary)]">{item.sessions} · {formatPercent(percentOf(item.sessions, total))}</span>
                                                    </div>
                                                    <ShareBar value={item.sessions} max={total} />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </GlassCard>
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Por tipo</CardTitle>
                                {result.training.typeDistribution.length === 0 ? <EmptyState>Sin sesiones aprobadas.</EmptyState> : (
                                    <ul className="space-y-3">
                                        {result.training.typeDistribution.map((item) => {
                                            const total = result.training.typeDistribution.reduce((sum, entry) => sum + entry.sessions, 0);
                                            return (
                                                <li key={item.label} className="space-y-1.5">
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-[var(--color-text-primary)]">{item.label}</span>
                                                        <span className="text-[var(--color-text-secondary)]">{item.sessions} sesiones · {formatTrainerDuration(item.minutes)}</span>
                                                    </div>
                                                    <ShareBar value={item.sessions} max={total} color={item.label === 'Nutrición' ? '#a3b18a' : undefined} />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                <p className="mt-4 text-xs text-[var(--color-text-muted)]">Sesiones aprobadas del período (pasadas y próximas).</p>
                            </GlassCard>
                        </div>
                    </StatsSection>

                    {/* ---------------------------------------------------- entrenadores */}
                    <StatsSection
                        id="entrenadores"
                        icon={Users}
                        title="Entrenadores"
                        description="Mismo cálculo que el apartado Equipo. Las cancelaciones con cargo nunca suman horas ni sesiones."
                        actions={(
                            <ActionButton icon={Download} onClick={() => downloadCsv(trainersCsv(result.trainers), `focus-club-entrenadores-${filenameSuffix}.csv`)}>
                                Exportar CSV
                            </ActionButton>
                        )}
                    >
                        <GlassCard hover={false} className="p-0">
                            {result.trainers.length === 0 ? <EmptyState>No hay entrenadores.</EmptyState> : (
                                <>
                                    <div className="hidden overflow-x-auto md:block">
                                        <table className="w-full text-sm">
                                            <caption className="sr-only">Comparativa de entrenadores en {periodLabel(period)}</caption>
                                            <thead>
                                                <tr className="border-b border-[var(--color-border-base)] text-left text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
                                                    <th scope="col" className="px-5 py-3 font-medium">Entrenador</th>
                                                    <th scope="col" className="px-3 py-3 font-medium">Horas contabilizadas</th>
                                                    <th scope="col" className="px-3 py-3 text-right font-medium">Sesiones</th>
                                                    <th scope="col" className="px-3 py-3 text-right font-medium">Clientes atendidos</th>
                                                    <th scope="col" className="px-3 py-3 text-right font-medium">Próximas</th>
                                                    <th scope="col" className="px-3 py-3 text-right font-medium">Canc. con cargo</th>
                                                    <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.trainers.map((row) => {
                                                    const max = Math.max(...result.trainers.map((item) => item.countedMinutes), 1);
                                                    return (
                                                        <tr key={row.trainerId ?? 'none'} className="border-b border-[var(--color-border-base)] last:border-0">
                                                            <td className="px-5 py-3">
                                                                <span className={cn('font-medium', row.trainerId ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}>
                                                                    {row.name}
                                                                </span>
                                                                {!row.active && <span className="ml-2 text-xs text-[var(--color-text-muted)]">inactivo</span>}
                                                            </td>
                                                            <td className="px-3 py-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="w-24 shrink-0 text-[var(--color-text-primary)]">{formatTrainerDuration(row.countedMinutes)}</span>
                                                                    <DeltaBadge current={row.countedMinutes} previous={row.previousCountedMinutes} previousLabel={formatTrainerDuration(row.previousCountedMinutes)} />
                                                                </div>
                                                                <div className="mt-1.5 max-w-[14rem]"><ShareBar value={row.countedMinutes} max={max} /></div>
                                                            </td>
                                                            <td className="px-3 py-3 text-right text-[var(--color-text-primary)]">{row.countedSessions}</td>
                                                            <td className="px-3 py-3 text-right text-[var(--color-text-primary)]">{row.uniqueClients}</td>
                                                            <td className="px-3 py-3 text-right text-[var(--color-text-secondary)]">{row.upcomingSessions}</td>
                                                            <td className="px-3 py-3 text-right">
                                                                <span className={row.chargedCancellations > 0 ? 'text-amber-300' : 'text-[var(--color-text-secondary)]'}>
                                                                    {row.chargedCancellations}
                                                                </span>
                                                                {row.chargedMinutes > 0 && <span className="block text-xs text-[var(--color-text-muted)]">{formatTrainerDuration(row.chargedMinutes)}</span>}
                                                            </td>
                                                            <td className="px-5 py-3 text-right">
                                                                {row.trainerId && (
                                                                    <SectionLink href={buildAdminDeepLink({ tab: 'appointments', trainerId: row.trainerId })}>Ver citas</SectionLink>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <ul className="divide-y divide-[var(--color-border-base)] md:hidden">
                                        {result.trainers.map((row) => (
                                            <li key={row.trainerId ?? 'none'} className="space-y-2 p-4">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-medium text-[var(--color-text-primary)]">{row.name}</span>
                                                    <DeltaBadge current={row.countedMinutes} previous={row.previousCountedMinutes} previousLabel={formatTrainerDuration(row.previousCountedMinutes)} />
                                                </div>
                                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                                    <dt className="text-[var(--color-text-secondary)]">Horas</dt>
                                                    <dd className="text-right text-[var(--color-text-primary)]">{formatTrainerDuration(row.countedMinutes)}</dd>
                                                    <dt className="text-[var(--color-text-secondary)]">Sesiones</dt>
                                                    <dd className="text-right text-[var(--color-text-primary)]">{row.countedSessions}</dd>
                                                    <dt className="text-[var(--color-text-secondary)]">Clientes atendidos</dt>
                                                    <dd className="text-right text-[var(--color-text-primary)]">{row.uniqueClients}</dd>
                                                    <dt className="text-[var(--color-text-secondary)]">Canc. con cargo</dt>
                                                    <dd className="text-right text-amber-300">{row.chargedCancellations}</dd>
                                                </dl>
                                                {row.trainerId && (
                                                    <SectionLink href={buildAdminDeepLink({ tab: 'appointments', trainerId: row.trainerId })}>Ver citas</SectionLink>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </GlassCard>
                    </StatsSection>

                    {/* ---------------------------------------------------- cancelaciones */}
                    <StatsSection
                        id="cancelaciones"
                        icon={XCircle}
                        title="Cancelaciones"
                        description="Por fecha de la sesión cancelada. Las anteriores a este cambio aparecen como «Sin clasificar»."
                        actions={(
                            <ActionButton
                                icon={Download}
                                disabled={result.cancellations.records.length === 0}
                                onClick={() => downloadCsv(cancellationsCsv(result.cancellations.records), `focus-club-cancelaciones-${filenameSuffix}.csv`)}
                            >
                                Exportar CSV
                            </ActionButton>
                        )}
                    >
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <MiniStat label="Con cargo" value={formatNumber(result.cancellations.totals.charged)} tone="amber" />
                            <MiniStat label="Sin cargo" value={formatNumber(result.cancellations.totals.not_charged)} />
                            <MiniStat label="Sin clasificar" value={formatNumber(result.cancellations.totals.unclassified)} tone="muted" hint="Anteriores al registro de modalidad" />
                            <MiniStat label="Minutos cobrados sin entrenamiento" value={formatTrainerDuration(result.cancellations.chargedMinutes)} tone="amber" />
                        </div>
                        <div className="grid gap-4 xl:grid-cols-5">
                            <GlassCard hover={false} className="p-4 sm:p-6 xl:col-span-3">
                                <CardTitle>Evolución</CardTitle>
                                <CancellationEvolutionChart cancellations={result.cancellations} />
                            </GlassCard>
                            <GlassCard hover={false} className="p-4 sm:p-6 xl:col-span-2">
                                <CardTitle>Por entrenador</CardTitle>
                                {result.cancellations.byTrainer.length === 0 ? <EmptyState>Sin cancelaciones en el período.</EmptyState> : (
                                    <ul className="space-y-3 text-sm">
                                        {result.cancellations.byTrainer.map((row) => (
                                            <li key={row.trainerId ?? 'none'} className="flex items-center justify-between gap-3">
                                                <span className="truncate text-[var(--color-text-primary)]">{row.name}</span>
                                                <span className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-0.5 text-xs">
                                                    <span className="text-amber-300">{row.charged} con cargo{row.chargedMinutes > 0 ? ` (${formatTrainerDuration(row.chargedMinutes)})` : ''}</span>
                                                    <span className="text-[var(--color-text-secondary)]">{row.notCharged} sin cargo</span>
                                                    {row.unclassified > 0 && <span className="text-[var(--color-text-muted)]">{row.unclassified} sin clasificar</span>}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </GlassCard>
                        </div>
                        {result.cancellations.records.length > 0 && (
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle aside={result.cancellations.records.length > LIST_PREVIEW && (
                                    <button type="button" onClick={() => toggle('cancellations')} className="text-xs text-[var(--color-accent-val)] hover:underline">
                                        {expanded.cancellations ? 'Ver menos' : `Ver todas (${result.cancellations.records.length})`}
                                    </button>
                                )}>
                                    Detalle
                                </CardTitle>
                                <ul className="divide-y divide-[var(--color-border-base)] text-sm">
                                    {(expanded.cancellations ? result.cancellations.records : result.cancellations.records.slice(0, LIST_PREVIEW)).map((record) => (
                                        <li key={record.appointmentId} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                                            <span className="text-[var(--color-text-primary)]">
                                                {formatDateKey(record.date)} · {record.time} · {record.clientName}
                                                <span className="text-[var(--color-text-secondary)]"> · {record.trainerName}</span>
                                            </span>
                                            <span className={cn(
                                                'w-fit rounded-full border px-2.5 py-0.5 text-xs',
                                                record.category === 'charged' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                                                record.category === 'not_charged' && 'border-[var(--color-border-base)] text-[var(--color-text-secondary)]',
                                                record.category === 'unclassified' && 'border-dashed border-[var(--color-border-base)] text-[var(--color-text-muted)]',
                                            )}>
                                                {CANCELLATION_CATEGORY_SHORT_LABELS[record.category]}
                                                {record.category === 'charged' ? ` · ${record.chargedMinutes} min` : ''}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </GlassCard>
                        )}
                    </StatsSection>

                    {/* ---------------------------------------------------- clientes y bonos */}
                    <StatsSection
                        id="clientes"
                        icon={Ticket}
                        title="Clientes y bonos"
                        scopeNote={selectedTrainer ? 'Bonos: todo el centro' : undefined}
                        actions={<SectionLink href={buildAdminDeepLink({ tab: 'clients' })}>Ver clientes</SectionLink>}
                    >
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <MiniStat label="Clientes activos" value={formatNumber(result.clients.activeClients.current)} tone="accent" />
                            <MiniStat label="Clientes nuevos" value={formatNumber(result.clients.newClients.current)} />
                            <MiniStat label="Con bono activo" value={formatNumber(result.clients.clientsWithActiveBono)} />
                            <MiniStat label="Bonos caducados en el período" value={formatNumber(result.clients.expiredInPeriod)} tone="muted" />
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Minutos del período</CardTitle>
                                {(() => {
                                    const minutes = result.clients.minutes;
                                    const total = minutes.counted + minutes.charged + minutes.reserved;
                                    const rows = [
                                        { label: 'Sesiones contabilizadas', value: minutes.counted, color: 'var(--color-accent-val)' },
                                        { label: 'Cancelaciones con cargo', value: minutes.charged, color: '#fbbf24' },
                                        { label: 'Reservados (próximas y pendientes)', value: minutes.reserved, color: '#2d6a4f' },
                                    ];
                                    return (
                                        <>
                                            <p className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">{formatTrainerDuration(total)} <span className="text-sm font-normal text-[var(--color-text-secondary)]">descontados de bonos</span></p>
                                            <ul className="space-y-3">
                                                {rows.map((row) => (
                                                    <li key={row.label} className="space-y-1.5">
                                                        <div className="flex justify-between text-sm">
                                                            <span className="text-[var(--color-text-primary)]">{row.label}</span>
                                                            <span className="text-[var(--color-text-secondary)]">{formatTrainerDuration(row.value)}</span>
                                                        </div>
                                                        <ShareBar value={row.value} max={total} color={row.color} />
                                                    </li>
                                                ))}
                                            </ul>
                                            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
                                                {minutes.coverage === null
                                                    ? 'Sin sesiones contabilizadas de entrenamiento en el período.'
                                                    : minutes.sessionsWithoutData > 0
                                                        ? `Datos de minutos fiables en el ${formatPercent(minutes.coverage)} de las sesiones contabilizadas: ${minutes.sessionsWithoutData} sesiones antiguas no registran el descuento y no se suman.`
                                                        : 'Todas las sesiones contabilizadas registran su descuento de minutos.'}
                                                {' '}Minutos restantes en bonos activos: {formatTrainerDuration(result.clients.remainingActiveMinutes)}.
                                            </p>
                                        </>
                                    );
                                })()}
                            </GlassCard>
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Renovación de bonos</CardTitle>
                                {result.clients.renewal.ended === 0 ? <EmptyState>Ningún bono ha terminado en este período.</EmptyState> : (
                                    <>
                                        <div className="mb-4 flex items-baseline gap-3">
                                            <span className="text-2xl font-bold text-[var(--color-text-primary)]">
                                                {formatPercent(percentOf(result.clients.renewal.renewed, result.clients.renewal.ended))}
                                            </span>
                                            <span className="text-sm text-[var(--color-text-secondary)]">
                                                {result.clients.renewal.renewed} de {result.clients.renewal.ended} bonos terminados se renovaron
                                            </span>
                                        </div>
                                        <ShareBar value={result.clients.renewal.renewed} max={result.clients.renewal.ended} />
                                        <ul className="mt-4 space-y-2 text-sm">
                                            {result.clients.renewal.clients.filter((client) => !client.renewed).slice(0, 6).map((client) => (
                                                <li key={`${client.userId}-${client.endedAt}`} className="flex items-center justify-between gap-3">
                                                    <Link href={buildAdminDeepLink({ tab: 'clients', clientQuery: client.name })} className="truncate text-[var(--color-text-primary)] hover:text-[var(--color-accent-val)]">
                                                        {client.name}
                                                    </Link>
                                                    <span className="shrink-0 text-xs text-amber-300">Sin renovar · caducó {new Date(client.endedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </GlassCard>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Bonos próximos a caducar</CardTitle>
                                {result.clients.expiringSoon.length === 0 && result.clients.lowMinutes.length === 0
                                    ? <EmptyState>Ningún bono caduca en {EXPIRING_SOON_DAYS} días ni tiene {LOW_MINUTES_THRESHOLD} min o menos.</EmptyState>
                                    : (
                                        <ul className="space-y-2 text-sm">
                                            {result.clients.expiringSoon.map((item) => (
                                                <li key={`exp-${item.bonoId}`} className="flex items-center justify-between gap-3">
                                                    <Link href={buildAdminDeepLink({ tab: 'clients', clientQuery: item.name })} className="truncate text-[var(--color-text-primary)] hover:text-[var(--color-accent-val)]">{item.name}</Link>
                                                    <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                                                        Caduca {new Date(item.expiresAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · {formatTrainerDuration(item.minutesLeft)}
                                                    </span>
                                                </li>
                                            ))}
                                            {result.clients.lowMinutes
                                                .filter((item) => !result.clients.expiringSoon.some((soon) => soon.bonoId === item.bonoId))
                                                .map((item) => (
                                                    <li key={`low-${item.bonoId}`} className="flex items-center justify-between gap-3">
                                                        <Link href={buildAdminDeepLink({ tab: 'clients', clientQuery: item.name })} className="truncate text-[var(--color-text-primary)] hover:text-[var(--color-accent-val)]">{item.name}</Link>
                                                        <span className="shrink-0 text-xs text-amber-300">Quedan {formatTrainerDuration(item.minutesLeft)}</span>
                                                    </li>
                                                ))}
                                        </ul>
                                    )}
                            </GlassCard>
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle aside={result.clients.retention.length > LIST_PREVIEW && (
                                    <button type="button" onClick={() => toggle('retention')} className="text-xs text-[var(--color-accent-val)] hover:underline">
                                        {expanded.retention ? 'Ver menos' : `Ver todos (${result.clients.retention.length})`}
                                    </button>
                                )}>
                                    Clientes sin actividad
                                </CardTitle>
                                <p className="-mt-2 mb-3 text-xs text-[var(--color-text-muted)]">
                                    Entrenaron en los últimos {RETENTION_LOOKBACK_DAYS} días, llevan {RETENTION_INACTIVE_DAYS}+ días sin sesión y no tienen ninguna cita futura. Siempre a fecha de hoy.
                                </p>
                                {result.clients.retention.length === 0 ? <EmptyState>Ningún cliente en riesgo.</EmptyState> : (
                                    <ul className="space-y-2 text-sm">
                                        {(expanded.retention ? result.clients.retention : result.clients.retention.slice(0, LIST_PREVIEW)).map((client) => (
                                            <li key={client.userId} className="flex items-center justify-between gap-3">
                                                <Link href={buildAdminDeepLink({ tab: 'clients', clientQuery: client.email || client.name })} className="truncate text-[var(--color-text-primary)] hover:text-[var(--color-accent-val)]">
                                                    {client.name}
                                                </Link>
                                                <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                                                    {client.daysSinceLastSession} días · {client.activeBonoMinutes === null ? 'sin bono activo' : `${formatTrainerDuration(client.activeBonoMinutes)} en bono`}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </GlassCard>
                        </div>
                    </StatsSection>

                    {/* ---------------------------------------------------- ocupación */}
                    <StatsSection
                        id="ocupacion"
                        icon={Gauge}
                        title="Ocupación"
                        scopeNote="Todo el centro"
                        description={`Plazas de 15 min ocupadas por citas aprobadas sobre el aforo (${result.occupancy.capacity}) del horario abierto, sin franjas bloqueadas.`}
                        actions={<SectionLink href={buildAdminDeepLink({ tab: 'availability' })}>Disponibilidad</SectionLink>}
                    >
                        <GlassCard hover={false} className="p-4 sm:p-6">
                            <CardTitle aside={<span className="text-sm text-[var(--color-text-primary)]">Media {formatPercent(result.occupancy.averageRate, true)}</span>}>
                                Días y horas
                            </CardTitle>
                            <OccupancyHeatmap occupancy={result.occupancy} />
                        </GlassCard>
                        <div className="grid gap-4 lg:grid-cols-2">
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Por franja horaria</CardTitle>
                                <OccupancyByHourChart occupancy={result.occupancy} />
                            </GlassCard>
                            <GlassCard hover={false} className="p-4 sm:p-6">
                                <CardTitle>Reservadas frente a canceladas</CardTitle>
                                <OccupancyEvolutionChart occupancy={result.occupancy} />
                            </GlassCard>
                        </div>
                        <GlassCard hover={false} className="p-4 sm:p-6">
                            <CardTitle>Horarios con más demanda</CardTitle>
                            {result.occupancy.topDemand.length === 0 ? <EmptyState>Sin solicitudes en el período.</EmptyState> : (
                                <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {result.occupancy.topDemand.map((item, index) => (
                                        <li key={`${item.weekday}-${item.time}`} className="flex items-center gap-3 rounded-xl border border-[var(--color-border-base)] bg-muted/10 px-3 py-2 text-sm">
                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-dim)] text-xs font-semibold text-[var(--color-accent-val)]">{index + 1}</span>
                                            <span className="text-[var(--color-text-primary)]">{WEEKDAY_LABELS[item.weekday]} · {item.time}</span>
                                            <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{item.requests} solicitudes</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <p className="mt-3 text-xs text-[var(--color-text-muted)]">Solicitudes aprobadas, pendientes y canceladas por hora de inicio (sin rechazadas).</p>
                        </GlassCard>
                    </StatsSection>

                    {/* ---------------------------------------------------- revisar */}
                    <StatsSection id="revisar" icon={ListChecks} title="Aspectos a revisar" description="Avisos calculados con los datos actuales.">
                        {result.review.length === 0 ? (
                            <GlassCard hover={false}><EmptyState>Todo en orden: no hay avisos pendientes.</EmptyState></GlassCard>
                        ) : (
                            <ul className="grid gap-3 md:grid-cols-2">
                                {result.review.map((item) => {
                                    const style = SEVERITY_STYLE[item.severity];
                                    const Icon = style.icon;
                                    return (
                                        <li key={item.id} className={cn('flex items-start gap-3 rounded-2xl border p-4', style.className)}>
                                            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-[var(--color-text-primary)]">
                                                    {item.title} <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs">{item.count}</span>
                                                </p>
                                                <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{item.description}</p>
                                                {item.id === 'occupancy-drift' && (
                                                    <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-text-secondary)]">
                                                        {result.occupancyDrift.slice(0, 5).map((drift) => (
                                                            <li key={`${drift.date}_${drift.time}`}>
                                                                {formatDateKey(drift.date)} {drift.time}: registrado {drift.recorded}, citas {drift.expected}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                            <SectionLink href={buildAdminDeepLink(item.link)}>Revisar</SectionLink>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <details className="rounded-2xl border border-[var(--color-border-base)] bg-muted/10 p-4 text-sm text-[var(--color-text-secondary)]">
                            <summary className="flex cursor-pointer items-center gap-2 text-[var(--color-text-primary)]">
                                <CalendarRange className="h-4 w-4 text-[var(--color-accent-val)]" aria-hidden="true" />
                                ¿Cómo se calcula?
                            </summary>
                            <ul className="mt-3 list-disc space-y-1.5 pl-5">
                                <li>Cada cita cuenta en el período de la fecha de su sesión (hora de Madrid).</li>
                                <li><strong>Horas contabilizadas</strong>: sesiones aprobadas cuya hora de inicio ya ha pasado. No hay confirmación de asistencia, así que no se presupone.</li>
                                <li><strong>Cancelación con cargo</strong>: mantiene los minutos consumidos del bono, pero nunca cuenta como sesión realizada ni como hora del entrenador.</li>
                                <li><strong>Sin clasificar</strong>: cancelaciones anteriores al registro de la modalidad. No se reclasifican automáticamente.</li>
                                <li>Las cifras de bonos, ocupación y retención describen todo el centro aunque filtres por entrenador.</li>
                                <li>
                                    <CalendarClock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                                    Los descuadres de aforo se revisan en los próximos {UPCOMING_OCCUPANCY_CHECK_DAYS} días.
                                    {result.excludedWithoutSlot > 0 && ` ${result.excludedWithoutSlot} citas antiguas sin fecha válida no se incluyen.`}
                                </li>
                            </ul>
                        </details>
                    </StatsSection>
                </div>
            )}
        </div>
    );
}
