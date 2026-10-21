'use client';

import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { CancellationStats, OccupancyStats, TrainingStats } from '@/lib/admin-statistics';

/**
 * Recharts wrappers of the statistics page. SVG presentation attributes do not
 * resolve CSS variables reliably, so the palette mirrors the Focus Club tokens
 * of globals.css (`--color-accent-val`, text and border alphas).
 */
export const CHART_COLORS = {
    accent: '#52b788',
    accentDeep: '#2d6a4f',
    pending: '#eab308',
    rejected: '#f87171',
    charged: '#fbbf24',
    notCharged: 'rgba(255, 255, 255, 0.38)',
    unclassified: 'rgba(255, 255, 255, 0.16)',
    grid: 'rgba(255, 255, 255, 0.07)',
    axis: 'rgba(255, 255, 255, 0.45)',
} as const;

const axisProps = {
    stroke: CHART_COLORS.grid,
    tick: { fill: CHART_COLORS.axis, fontSize: 11 },
    tickLine: false,
} as const;

interface TooltipEntry {
    name?: string | number;
    value?: number | string | readonly (number | string)[];
    color?: string;
    dataKey?: string | number | ((obj: unknown) => unknown);
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; unit?: (key: string, value: number) => string }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-xl border border-[var(--color-border-base)] bg-[#101010]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
            <p className="mb-1 font-semibold text-[var(--color-text-primary)]">{label}</p>
            <ul className="space-y-0.5">
                {payload.map((entry) => {
                    const value = Number(Array.isArray(entry.value) ? entry.value[0] : entry.value ?? 0);
                    const key = String(entry.dataKey ?? entry.name);
                    return (
                        <li key={key} className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
                            <span>{entry.name}</span>
                            <span className="ml-auto pl-3 font-medium text-[var(--color-text-primary)]">
                                {unit ? unit(key, value) : value.toLocaleString('es-ES')}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

const legendStyle = { fontSize: 12, color: CHART_COLORS.axis, paddingTop: 8 };

function hoursLabel(minutes: number): string {
    return `${(minutes / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h`;
}

export function TrainingEvolutionChart({ training }: { training: TrainingStats }) {
    return (
        <div className="h-72 w-full" role="img" aria-label="Evolución de citas por estado y horas contabilizadas">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={training.buckets} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis yAxisId="count" allowDecimals={false} {...axisProps} axisLine={false} />
                    <YAxis yAxisId="minutes" orientation="right" {...axisProps} axisLine={false} tickFormatter={(value: number) => `${Math.round(value / 60)}h`} />
                    <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        content={(props) => (
                            <ChartTooltip
                                active={props.active}
                                payload={props.payload as readonly TooltipEntry[] | undefined}
                                label={props.label as string | undefined}
                                unit={(key, value) => (key === 'countedMinutes' ? hoursLabel(value) : value.toLocaleString('es-ES'))}
                            />
                        )}
                    />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} itemSorter={null} />
                    <Bar yAxisId="count" dataKey="countedSessions" name="Contabilizadas" stackId="s" fill={CHART_COLORS.accent} />
                    <Bar yAxisId="count" dataKey="upcoming" name="Próximas" stackId="s" fill={CHART_COLORS.accentDeep} />
                    <Bar yAxisId="count" dataKey="pending" name="Pendientes" stackId="s" fill={CHART_COLORS.pending} />
                    <Bar yAxisId="count" dataKey="cancelled" name="Canceladas" stackId="s" fill={CHART_COLORS.notCharged} />
                    <Bar yAxisId="count" dataKey="rejected" name="Rechazadas" stackId="s" fill={CHART_COLORS.rejected} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="minutes" type="monotone" dataKey="countedMinutes" name="Horas contabilizadas" stroke="#d8f3dc" strokeWidth={2} dot={false} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

export function CancellationEvolutionChart({ cancellations }: { cancellations: CancellationStats }) {
    return (
        <div className="h-64 w-full" role="img" aria-label="Evolución de cancelaciones por modalidad">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cancellations.buckets} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis allowDecimals={false} {...axisProps} axisLine={false} />
                    <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        content={(props) => (
                            <ChartTooltip active={props.active} payload={props.payload as readonly TooltipEntry[] | undefined} label={props.label as string | undefined} />
                        )}
                    />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} itemSorter={null} />
                    <Bar dataKey="charged" name="Con cargo" stackId="c" fill={CHART_COLORS.charged} />
                    <Bar dataKey="notCharged" name="Sin cargo" stackId="c" fill={CHART_COLORS.notCharged} />
                    <Bar dataKey="unclassified" name="Sin clasificar" stackId="c" fill={CHART_COLORS.unclassified} radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

export function OccupancyEvolutionChart({ occupancy }: { occupancy: OccupancyStats }) {
    return (
        <div className="h-64 w-full" role="img" aria-label="Plazas reservadas y canceladas por período">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={occupancy.buckets} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <defs>
                        <linearGradient id="reservedFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis {...axisProps} axisLine={false} tickFormatter={(value: number) => `${value}h`} />
                    <Tooltip
                        content={(props) => (
                            <ChartTooltip
                                active={props.active}
                                payload={props.payload as readonly TooltipEntry[] | undefined}
                                label={props.label as string | undefined}
                                unit={(_key, value) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h·plaza`}
                            />
                        )}
                    />
                    <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} itemSorter={null} />
                    <Area type="monotone" dataKey="reservedSeatHours" name="Reservadas (aprobadas)" stroke={CHART_COLORS.accent} fill="url(#reservedFill)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cancelledSeatHours" name="Canceladas" stroke={CHART_COLORS.charged} fill="transparent" strokeDasharray="4 3" strokeWidth={1.5} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

export function OccupancyByHourChart({ occupancy }: { occupancy: OccupancyStats }) {
    const data = occupancy.byHour.map((hour) => ({ ...hour, percent: hour.rate === null ? 0 : Math.round(hour.rate * 1000) / 10 }));
    return (
        <div className="h-56 w-full" role="img" aria-label="Ocupación por franja horaria">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
                    <XAxis dataKey="label" {...axisProps} interval={0} angle={-45} textAnchor="end" height={44} />
                    <YAxis {...axisProps} axisLine={false} domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} />
                    <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        content={(props) => (
                            <ChartTooltip
                                active={props.active}
                                payload={props.payload as readonly TooltipEntry[] | undefined}
                                label={props.label as string | undefined}
                                unit={(_key, value) => `${value.toLocaleString('es-ES')} %`}
                            />
                        )}
                    />
                    <Bar dataKey="percent" name="Ocupación" fill={CHART_COLORS.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
