'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChartLine, Loader2, Lock, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { StatisticsDashboard } from '@/components/admin/statistics/StatisticsDashboard';

/**
 * Admin-only statistics. The page guard is a convenience: Firestore rules
 * (`isAdmin()`) are what refuse the range reads to anyone else.
 */
export default function StatisticsPage() {
    const { user, userProfile, loading: authLoading, logout } = useAuth();
    const router = useRouter();
    const hasAdminAccess = userProfile?.role === 'admin';
    const profilePending = authLoading || (user !== null && userProfile === null);

    useEffect(() => {
        if (!authLoading && userProfile && userProfile.role !== 'admin') {
            router.replace('/admin');
        }
    }, [authLoading, router, userProfile]);

    if (profilePending) {
        return (
            <div className="min-h-screen -mt-20 flex items-center justify-center bg-[var(--color-bg-base)] px-4">
                <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent-val)]" />
                    Validando acceso a las estadísticas...
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
                        Las estadísticas solo están disponibles para administradores.
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
                                <ChartLine className="w-4 h-4" />
                            </div>
                            <span className="hidden font-bold sm:inline">Focus Club Admin</span>
                        </Link>
                        <span className="text-[var(--color-text-muted)]">/</span>
                        <span className="truncate text-sm font-medium text-[var(--color-accent-val)]">Estadísticas</span>
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

            <main className="container mx-auto px-4 py-6 lg:py-8">
                <StatisticsDashboard />
            </main>
        </div>
    );
}
