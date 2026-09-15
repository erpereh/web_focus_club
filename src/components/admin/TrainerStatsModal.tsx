'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, CalendarClock, Clock3, Users, X } from 'lucide-react';
import { formatTrainerDuration, type TrainerStats } from '@/lib/trainer-stats';

interface TrainerStatsModalProps {
    trainerName: string;
    periodLabel: string;
    stats: TrainerStats;
    onClose: () => void;
}

const durationOptions = [30, 45, 60] as const;

export function TrainerStatsModal({
    trainerName,
    periodLabel,
    stats,
    onClose,
}: TrainerStatsModalProps) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const metrics = [
        { label: 'Horas realizadas', value: formatTrainerDuration(stats.completedMinutes), icon: Clock3 },
        { label: 'Sesiones realizadas', value: stats.completedSessions.toString(), icon: BarChart3 },
        { label: 'Clientes atendidos', value: stats.uniqueClients.toString(), icon: Users },
        { label: 'Próximas sesiones', value: stats.upcomingSessions.toString(), icon: CalendarClock },
    ];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="trainer-stats-title"
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-base)] bg-[var(--color-bg-card)] shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-base)] px-6 py-5">
                    <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-val)]">
                            {periodLabel}
                        </p>
                        <h2 id="trainer-stats-title" className="text-xl font-bold text-[var(--color-text-primary)]">
                            Estadísticas de {trainerName}
                        </h2>
                    </div>
                    <button
                        type="button"
                        aria-label="Cerrar estadísticas"
                        onClick={onClose}
                        className="rounded-lg p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-muted/50 hover:text-[var(--color-text-primary)]"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-6 p-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                        {metrics.map(({ label, value, icon: Icon }) => (
                            <div key={label} className="rounded-xl border border-white/5 bg-muted/20 p-4">
                                <div className="mb-3 flex items-center gap-2 text-[var(--color-text-secondary)]">
                                    <Icon className="h-4 w-4 text-[var(--color-accent-val)]" />
                                    <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
                                </div>
                                <p className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
                            </div>
                        ))}
                    </div>

                    <div>
                        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                            Distribución por duración
                        </h3>
                        <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-muted/10">
                            {durationOptions.map((duration) => (
                                <div key={duration} className="flex items-center justify-between px-4 py-3">
                                    <span className="text-sm text-[var(--color-text-secondary)]">{duration} min</span>
                                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                                        {stats.durationDistribution[duration]} sesiones
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="text-xs text-[var(--color-text-muted)]">
                        Las próximas sesiones siempre corresponden a los siguientes 7 días.
                    </p>
                </div>
            </motion.div>
        </motion.div>
    );
}
