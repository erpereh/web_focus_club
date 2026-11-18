'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { auditMinuteRefunds, getMinuteRefundDetail, getMinuteRefunds, retryMinuteRefund, REFUND_REASON_LABELS, REFUND_STATE_LABELS, type RefundPage, type MinuteRefund } from '@/lib/minute-refunds';

const panel = 'rounded-2xl border border-border bg-[var(--color-bg-card)] p-5';
const movementLabels: Record<string, string> = { request: 'Solicitud y restitución inicial', historical_evidence: 'Evidencia histórica', recovered_credit: 'Compensación abonada', review_approved: 'Auditoría aprobada' };
const control = 'rounded-lg border border-border bg-[var(--color-bg-base)] px-3 py-2 text-sm';

export default function RefundsPage() {
    const { userProfile, loading } = useAuth();
    const [page, setPage] = useState<RefundPage | null>(null);
    const [state, setState] = useState('');
    const [userId, setUserId] = useState('');
    const [queryUserId, setQueryUserId] = useState('');
    const [deletedOnly, setDeletedOnly] = useState(false);
    const [cursor, setCursor] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [detail, setDetail] = useState<(MinuteRefund & { movements: Record<string, unknown>[] }) | null>(null);
    const request = useRef(0);
    const isAdmin = userProfile?.role === 'admin';
    const refresh = useCallback(async () => {
        if (!isAdmin) return;
        const version = ++request.current;
        setBusy(true);
        try {
            const result = await getMinuteRefunds({ state, userId: queryUserId, deletedOnly, cursor });
            if (version === request.current) { setPage(result); setError(''); }
        } catch { if (version === request.current) setError('No se han podido consultar las devoluciones. Inténtalo de nuevo.'); }
        finally { if (version === request.current) setBusy(false); }
    }, [isAdmin, state, queryUserId, deletedOnly, cursor]);
    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
        return () => { window.clearInterval(timer); request.current += 1; };
    }, [refresh]);

    if (loading) return <main className="p-8" role="status">Validando acceso…</main>;
    if (!isAdmin) return <main className="p-8"><h1 className="text-xl font-semibold">Acceso restringido</h1><p>Las devoluciones solo están disponibles para administradores.</p><Link href="/admin">Ir al acceso admin</Link></main>;

    return <main className="min-h-screen bg-[var(--color-bg-base)] px-4 py-8 text-[var(--color-text-primary)]">
        <div className="mx-auto max-w-6xl space-y-6">
            <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><ArrowLeft size={16} /> Administración</Link>
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs uppercase tracking-widest text-[var(--color-accent-val)]">Contabilidad de minutos</p><h1 className="mt-2 text-3xl font-semibold">Devoluciones</h1><p className="mt-2 text-sm text-[var(--color-text-secondary)]">Cada minuto solicitado, abonado y pendiente, también de citas eliminadas.</p></div>
                <button className={control} type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw className="mr-2 inline" size={15} />{busy ? 'Actualizando…' : 'Actualizar'}</button>
            </header>
            <div className="grid gap-4 sm:grid-cols-3">
                <div className={panel}><Clock3 size={20} className="text-[var(--color-accent-val)]" /><p className="mt-3 text-3xl font-semibold">{page?.summary.minutes ?? '—'} <span className="text-sm">min</span></p><p className="text-sm text-[var(--color-text-secondary)]">{page?.summary.count ?? '—'} devoluciones pendientes</p></div>
                <div className={panel}><ShieldCheck size={20} /><p className="mt-3 text-3xl font-semibold">{page?.summary.blocked ?? '—'}</p><p className="text-sm text-[var(--color-text-secondary)]">Inconsistencias o históricos por auditar</p></div>
                <div className={panel}><p className="text-sm font-medium">Compensación automática</p><p className="mt-3 text-xl">{page ? page.summary.enabled ? 'Activada' : 'Desactivada' : '—'}</p><p className="mt-2 text-sm text-[var(--color-text-secondary)]">Las deudas siempre se conservan. Los históricos requieren revisión expresa.</p></div>
            </div>
            <form className={`${panel} flex flex-wrap items-end gap-4`} onSubmit={(event) => { event.preventDefault(); setCursor(''); setQueryUserId(userId.trim()); }}>
                <label className="flex flex-col gap-2 text-sm">Estado<select className={control} value={state} onChange={(event) => { setCursor(''); setState(event.target.value); }}><option value="">Todos</option>{Object.entries(REFUND_STATE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="flex flex-1 flex-col gap-2 text-sm">ID del cliente<input className={control} value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
                <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={deletedOnly} onChange={(event) => { setCursor(''); setDeletedOnly(event.target.checked); }} />Solo citas eliminadas</label>
                <button type="submit" className={control}>Filtrar</button>
            </form>
            {error && <p role="alert" className="rounded-lg border border-red-500/30 p-4 text-red-300">{error}</p>}
            <div className={`${panel} overflow-x-auto`} aria-busy={busy}>
                <table className="w-full text-left text-sm"><caption className="sr-only">Devoluciones y contabilidad de minutos</caption><thead className="text-[var(--color-text-secondary)]"><tr>{['Origen', 'Solicitados', 'Abonados', 'Pendientes', 'Estado', 'Acciones'].map((label) => <th className="px-3 py-3 font-medium" scope="col" key={label}>{label}</th>)}</tr></thead>
                    <tbody>{[...(page?.legacyItems ?? []), ...(page?.items ?? [])].map((item) => <tr key={item.id} className="border-t border-border">
                        <td className="px-3 py-4"><p className="font-mono text-xs">{item.appointmentId}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">Cliente: {item.userId}</p>{item.sourceDeleted && <span className="text-xs">Cita eliminada</span>}</td>
                        <td className="px-3 py-4 tabular-nums">{item.requestedMinutes}</td><td className="px-3 py-4 tabular-nums">{item.creditedMinutes}</td><td className="px-3 py-4 tabular-nums">{item.pendingMinutes}</td>
                        <td className="max-w-xs px-3 py-4"><p>{REFUND_STATE_LABELS[item.state]}</p>{item.reason && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{REFUND_REASON_LABELS[item.reason] ?? item.reason}</p>}</td>
                        <td className="px-3 py-4"><button className={control} type="button" onClick={async () => { try {
                            if (item.id.startsWith('legacy:')) {
                                const report = await auditMinuteRefunds([item.appointmentId]);
                                const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
                                const anchor = document.createElement('a'); anchor.href = url; anchor.download = `auditoria-${item.appointmentId}.json`; anchor.click(); URL.revokeObjectURL(url);
                            } else setDetail(await getMinuteRefundDetail(item.id));
                        } catch { setError('No se ha podido consultar la trazabilidad.'); } }}>{item.id.startsWith('legacy:') ? 'Descargar auditoría' : 'Ver trazabilidad'}</button>{item.pendingMinutes > 0 && item.reviewApproved && <button type="button" className={`${control} mt-2`} disabled={busy || !page?.summary.enabled} onClick={async () => { setBusy(true); try { await retryMinuteRefund(item.id); await refresh(); } catch { setError('No se ha podido solicitar el reintento.'); } finally { setBusy(false); } }}>Reintentar</button>}</td>
                    </tr>)}</tbody>
                </table>
                {page && page.items.length === 0 && !page.legacyItems?.length && <p className="p-8 text-center text-[var(--color-text-secondary)]">No hay devoluciones con estos filtros.</p>}
            </div>
            <div className="flex gap-3"><button className={control} type="button" disabled={!cursor || busy} onClick={() => setCursor('')}>Primera página</button><button className={control} type="button" disabled={!page?.nextCursor || busy} onClick={() => setCursor(page?.nextCursor ?? '')}>Siguiente página</button></div>
            {detail && <section className={panel} aria-label="Trazabilidad de la devolución"><div className="flex justify-between gap-4"><h2 className="text-lg font-semibold">Movimientos · {detail.appointmentId}</h2><button className={control} type="button" onClick={() => setDetail(null)}>Cerrar detalle</button></div><p className="mt-3 break-all text-sm">Bono de origen: {detail.sourceBonoId ?? 'Sin identificar'} · Destino: {detail.targetBonoId ?? 'Pendiente'}</p><ol className="mt-4 divide-y divide-border">{detail.movements.map((movement) => <li className="space-y-2 py-4 text-sm" key={String(movement.id)}>
                    <p className="font-medium">{movementLabels[String(movement.kind)] ?? 'Movimiento'} · {new Date(String(movement.at)).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
                    {movement.amount !== undefined ? <p>{Number(movement.amount)} min abonados</p> : <p>Solicitados: {Number(movement.requestedMinutes ?? 0)} · Abonados: {Number(movement.creditedMinutes ?? 0)} · Pendientes: {Number(movement.pendingMinutes ?? 0)}</p>}
                    {movement.balanceBefore !== undefined && <p>Saldo: {Number(movement.balanceBefore)} → {Number(movement.balanceAfter)} min · Capacidad: {Number(movement.capacityBefore)} → {Number(movement.capacityAfter)} min</p>}
                    {movement.reviewerUid !== undefined && <p className="break-all text-xs text-[var(--color-text-secondary)]">Revisado por: {String(movement.reviewerUid)}</p>}
                    {movement.reportHash !== undefined && <p className="break-all font-mono text-xs text-[var(--color-text-secondary)]">Informe: {String(movement.reportHash)}</p>}
                </li>)}</ol></section>}
        </div>
    </main>;
}
