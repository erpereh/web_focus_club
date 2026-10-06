'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, CalendarCheck, RefreshCw, Repeat2, Ticket } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { AdminSlotPickerModal, type AdminSlotPickerResult } from '@/components/admin/AdminSlotPickerModal';
import { formatRenewalSlot, RenewalPreviewPanel } from '@/components/admin/RenewalPreviewPanel';
import {
    addActivityLog,
    assignBono,
    commitBonoAppointmentRenewalFromAdmin,
    countApprovedSeriesForBono,
    deactivateBono,
    getBonosByUser,
    previewBonoAppointmentRenewalFromAdmin,
} from '@/lib/firestore';
import { formatBonoSize } from '@/lib/bono-sizes';
import {
    applyCommitResult,
    applyValidation,
    changeRowSlot,
    findPreviousBono,
    newRenewalId,
    readyRowsToCommit,
    remainingMinutesForValidation,
    renewalReasonLabel,
    rowsFromPreview,
    rowsToSubmit,
    setRowDecision,
    skippedPayload,
    summarizeRenewal,
    unresolvedConflicts,
    type RenewalRow,
} from '@/lib/bono-renewal';
import { cn } from '@/lib/utils';
import type { Appointment, Bono, Trainer, UserProfile } from '@/types';

export interface BonoDatesResult {
    error?: string;
    fechaAsignacion?: string;
    fechaExpiracion?: string;
}

export interface AssignBonoModalProps {
    client: UserProfile;
    /** Bono activo actual (se reemplaza al asignar uno nuevo). */
    activeBono?: Bono;
    /** Tamaños configurados en minutos (Configuración de Bonos). */
    sizes: number[];
    defaultStartDate: string;
    defaultEndDate: string;
    buildDates: (startDate: string, endDate: string) => BonoDatesResult;
    trainers: Trainer[];
    appointments: Appointment[];
    adminEmail: string;
    onClose: () => void;
    onAssigned: () => Promise<void> | void;
}

type View = 'form' | 'preview' | 'summary';

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function AssignBonoModal({
    client,
    activeBono,
    sizes,
    defaultStartDate,
    defaultEndDate,
    buildDates,
    trainers,
    appointments,
    adminEmail,
    onClose,
    onAssigned,
}: AssignBonoModalProps) {
    const [size, setSize] = useState<number>(sizes[0] ?? 240);
    const [startDate, setStartDate] = useState(defaultStartDate);
    const [endDate, setEndDate] = useState(defaultEndDate);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState<View>('form');

    const [previousBono, setPreviousBono] = useState<Bono | null>(null);
    const [previousSeriesCount, setPreviousSeriesCount] = useState(0);
    const [repeatAppointments, setRepeatAppointments] = useState(false);
    const [rows, setRows] = useState<RenewalRow[] | null>(null);
    const [pickerRow, setPickerRow] = useState<RenewalRow | null>(null);
    const [createdBonoId, setCreatedBonoId] = useState<string | null>(null);
    const [renewalId] = useState(() => newRenewalId());

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bonos = await getBonosByUser(client.uid);
                const previous = findPreviousBono(bonos);
                if (!previous) return;
                const count = await countApprovedSeriesForBono(client.uid, previous.id);
                if (cancelled) return;
                setPreviousBono(previous);
                setPreviousSeriesCount(count);
            } catch (loadError) {
                console.error('Error loading previous bono:', loadError);
            }
        })();
        return () => { cancelled = true; };
    }, [client.uid]);

    const bonoLocked = Boolean(createdBonoId);
    const conflicts = rows ? unresolvedConflicts(rows) : [];
    const summary = rows ? summarizeRenewal(rows) : null;
    const plannedSlotsFor = useMemo(() => (key: string) => (rows ?? [])
        .filter((row) => row.key !== key && row.decision === 'include' && (row.status === 'ready' || row.status === 'created'))
        .map((row) => ({ slot: row.slot, durationMinutes: row.durationMinutes })), [rows]);

    const resetPreview = () => {
        if (bonoLocked) return;
        setRows(null);
        setView('form');
    };

    const previewInput = (currentRows: RenewalRow[] | null) => ({
        userId: client.uid,
        sourceBonoId: previousBono?.id ?? '',
        periodStart: startDate,
        periodEnd: endDate,
        availableMinutes: currentRows ? remainingMinutesForValidation(size, currentRows) : size,
    });

    const loadPreview = async () => {
        const dates = buildDates(startDate, endDate);
        if (dates.error) {
            setError(dates.error);
            return;
        }
        if (!previousBono) return;
        setBusy(true);
        setError('');
        try {
            const result = await previewBonoAppointmentRenewalFromAdmin(previewInput(null));
            setRows(rowsFromPreview(result.items));
            setView('preview');
        } catch (previewError) {
            setError(errorMessage(previewError, 'No se ha podido generar la previsualización.'));
        } finally {
            setBusy(false);
        }
    };

    /** Revalida en el servidor todas las citas incluidas (minutos, aforo, conflictos...). */
    const revalidate = async (nextRows: RenewalRow[]): Promise<RenewalRow[]> => {
        const result = await previewBonoAppointmentRenewalFromAdmin({
            ...previewInput(nextRows),
            items: rowsToSubmit(nextRows),
        });
        return applyValidation(nextRows, result.items);
    };

    const updateDecision = async (key: string, decision: 'include' | 'skip') => {
        if (!rows) return;
        const next = setRowDecision(rows, key, decision);
        setRows(next);
        setBusy(true);
        setError('');
        try {
            setRows(await revalidate(next));
        } catch (validationError) {
            setError(errorMessage(validationError, 'No se ha podido revalidar la renovación.'));
        } finally {
            setBusy(false);
        }
    };

    const handlePickerConfirm = async (result: AdminSlotPickerResult) => {
        if (!rows || !pickerRow) return;
        const changed = changeRowSlot(rows, pickerRow.key, result.slot, { id: result.trainerId, name: result.trainerName });
        const validated = await revalidate(changed);
        const row = validated.find((item) => item.key === pickerRow.key);
        if (row?.status === 'conflict') {
            throw new Error(`No se puede usar esta franja: ${renewalReasonLabel(row.reason).toLowerCase()}.`);
        }
        setRows(validated);
        setPickerRow(null);
    };

    const assignTheBono = async (): Promise<string | null> => {
        if (createdBonoId) return createdBonoId;
        const dates = buildDates(startDate, endDate);
        if (dates.error || !dates.fechaAsignacion || !dates.fechaExpiracion) {
            setError(dates.error || 'Revisa las fechas del bono.');
            return null;
        }
        if (activeBono) await deactivateBono(activeBono.id);
        const bonoId = await assignBono({
            userId: client.uid,
            tamano: size,
            minutosTotales: size,
            minutosRestantes: size,
            fechaAsignacion: dates.fechaAsignacion,
            fechaExpiracion: dates.fechaExpiracion,
            estado: 'activo',
            historial: [],
            asignadoPor: adminEmail || 'admin',
        });
        await addActivityLog({
            action: 'bono_assigned',
            adminEmail: adminEmail || 'unknown',
            details: `Cliente: ${client.name}, Bono Mensual ${formatBonoSize(size)}, Validez: ${startDate} - ${endDate}`,
        });
        setCreatedBonoId(bonoId);
        return bonoId;
    };

    const handleConfirm = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const bonoId = await assignTheBono();
            if (!bonoId) return;
            if (!repeatAppointments || !rows || !previousBono) {
                await onAssigned();
                onClose();
                return;
            }
            const result = await commitBonoAppointmentRenewalFromAdmin({
                renewalId,
                userId: client.uid,
                bonoId,
                sourceBonoId: previousBono.id,
                items: readyRowsToCommit(rows),
                skipped: skippedPayload(rows),
            });
            const next = applyCommitResult(rows, result);
            setRows(next);
            if (result.conflicts.length > 0) {
                setNotice('El bono está asignado, pero algunas citas ya no estaban disponibles al crearlas. Resuélvelas u omítelas y vuelve a confirmar.');
                return;
            }
            setView('summary');
            await onAssigned();
        } catch (confirmError) {
            setError(errorMessage(confirmError, createdBonoId
                ? 'El bono está asignado, pero no se han podido crear las citas. Vuelve a intentarlo.'
                : 'Error al asignar el bono.'));
        } finally {
            setBusy(false);
        }
    };

    const closeAfterAssign = async () => {
        if (createdBonoId && view !== 'summary') await onAssigned();
        onClose();
    };

    const canRepeat = Boolean(previousBono && previousSeriesCount > 0);
    const primaryLabel = view === 'form' && repeatAppointments
        ? 'Previsualizar citas'
        : createdBonoId ? 'Reintentar las citas pendientes' : repeatAppointments ? 'Confirmar renovación' : 'Asignar Bono';

    return (
        <>
            <motion.div
                key="assign-bono-modal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                onClick={() => { if (!busy) void closeAfterAssign(); }}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn('w-full', view === 'form' ? 'max-w-lg' : 'max-w-2xl')}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="assign-bono-title"
                >
                    <GlassCard className="max-h-[calc(100vh-2rem)] overflow-y-auto p-6">
                        <h2 id="assign-bono-title" className="mb-1 text-xl font-bold text-[var(--color-text-primary)]">
                            {view === 'summary' ? 'Renovación completada' : 'Asignar Bono'}
                        </h2>
                        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
                            Asigna un bono a <strong className="text-[var(--color-text-primary)]">{client.name}</strong>
                        </p>

                        {view === 'form' && (
                            <>
                                {activeBono && (
                                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        Este cliente ya tiene un bono activo. Asignar uno nuevo reemplazará el actual.
                                    </div>
                                )}
                                <div className="space-y-5">
                                    <div>
                                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Tamaño del Bono</label>
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                            {sizes.map((minutes) => (
                                                <button
                                                    key={minutes}
                                                    type="button"
                                                    aria-pressed={size === minutes}
                                                    onClick={() => { setSize(minutes); resetPreview(); }}
                                                    className={cn(
                                                        'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                                                        size === minutes
                                                            ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                                            : 'border-white/10 bg-muted/20 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                                                    )}
                                                >
                                                    {formatBonoSize(minutes)} / mes
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div>
                                            <label htmlFor="assign-bono-start" className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Fecha de inicio</label>
                                            <input
                                                id="assign-bono-start"
                                                type="date"
                                                value={startDate}
                                                onChange={(e) => { setStartDate(e.target.value); setError(''); resetPreview(); }}
                                                className="w-full rounded-xl border border-border bg-input px-4 py-3 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="assign-bono-end" className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Fecha de fin</label>
                                            <input
                                                id="assign-bono-end"
                                                type="date"
                                                value={endDate}
                                                onChange={(e) => { setEndDate(e.target.value); setError(''); resetPreview(); }}
                                                className="w-full rounded-xl border border-border bg-input px-4 py-3 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    {canRepeat && (
                                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                                            <input
                                                type="checkbox"
                                                checked={repeatAppointments}
                                                onChange={(e) => { setRepeatAppointments(e.target.checked); resetPreview(); }}
                                                className="mt-1 h-4 w-4 accent-[var(--color-accent-val)]"
                                            />
                                            <span>
                                                <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                                    <Repeat2 className="h-4 w-4 text-[var(--color-accent-val)]" />
                                                    Repetir citas del bono anterior
                                                </span>
                                                <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                                                    Replica {previousSeriesCount === 1 ? 'la serie recurrente aprobada' : `las ${previousSeriesCount} series recurrentes aprobadas`} (día, hora, duración y entrenador) dentro del nuevo bono.
                                                    Verás una previsualización antes de crear nada. Las citas quedarán pendientes de que el cliente las confirme desde la app.
                                                </span>
                                            </span>
                                        </label>
                                    )}

                                    <div className="rounded-xl border border-white/5 bg-muted/10 p-4">
                                        <h3 className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">Resumen del Bono</h3>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Cliente</span><span className="text-[var(--color-text-primary)]">{client.name}</span></div>
                                            <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Tipo</span><span className="text-[var(--color-text-primary)]">Bono Mensual</span></div>
                                            <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Horas</span><span className="text-[var(--color-text-primary)]">{formatBonoSize(size)} ({size} min)</span></div>
                                            <div className="flex justify-between"><span className="text-[var(--color-text-secondary)]">Validez</span><span className="text-[var(--color-text-primary)]">{startDate || '--'} - {endDate || '--'}</span></div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {view === 'preview' && rows && (
                            <div className="space-y-4">
                                <p className="text-sm text-[var(--color-text-secondary)]">
                                    Estas son las citas que se intentarán crear en el bono de {formatBonoSize(size)} ({startDate} - {endDate}).
                                    Resuelve o omite cada conflicto antes de confirmar. Se crearán como <strong>pendientes</strong> y el cliente deberá confirmarlas desde la app.
                                </p>
                                <RenewalPreviewPanel
                                    rows={rows}
                                    busy={busy}
                                    onSkip={(key) => void updateDecision(key, 'skip')}
                                    onInclude={(key) => void updateDecision(key, 'include')}
                                    onReschedule={(row) => setPickerRow(row)}
                                />
                                {conflicts.length > 0 && (
                                    <p className="text-xs text-amber-400">
                                        Quedan {conflicts.length} {conflicts.length === 1 ? 'conflicto' : 'conflictos'} por resolver: cambia su fecha/hora u omítelos.
                                    </p>
                                )}
                            </div>
                        )}

                        {view === 'summary' && summary && (
                            <div className="space-y-4 text-sm" data-testid="renewal-summary">
                                <div className="flex items-center gap-2 text-emerald-400">
                                    <CalendarCheck className="h-5 w-5" />
                                    Bono asignado. {summary.created.length} {summary.created.length === 1 ? 'cita creada' : 'citas creadas'} como pendientes de confirmación del cliente.
                                </div>
                                <section>
                                    <h3 className="mb-1 font-semibold text-[var(--color-text-primary)]">Citas creadas como pendientes ({summary.created.length})</h3>
                                    <ul className="space-y-1 text-[var(--color-text-secondary)]">
                                        {summary.created.map((row) => <li key={row.key}>{formatRenewalSlot(row.slot)} · {row.durationMinutes} min · {row.trainerName || 'Sin entrenador'}</li>)}
                                    </ul>
                                </section>
                                <section>
                                    <h3 className="mb-1 font-semibold text-[var(--color-text-primary)]">Modificadas respecto al patrón original ({summary.modified.length})</h3>
                                    <ul className="space-y-1 text-[var(--color-text-secondary)]">
                                        {summary.modified.map((row) => (
                                            <li key={row.key}>{formatRenewalSlot(row.originalSlot)} → {formatRenewalSlot(row.slot)}</li>
                                        ))}
                                    </ul>
                                </section>
                                <section>
                                    <h3 className="mb-1 font-semibold text-[var(--color-text-primary)]">Omitidas ({summary.skipped.length})</h3>
                                    <ul className="space-y-1 text-[var(--color-text-secondary)]">
                                        {summary.skipped.map((row) => (
                                            <li key={row.key}>
                                                {formatRenewalSlot(row.originalSlot)} — {row.reason ? renewalReasonLabel(row.reason) : 'Omitida por el administrador'}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            </div>
                        )}

                        {notice && (
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {notice}
                            </div>
                        )}
                        {error && (
                            <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="mt-6 flex flex-wrap justify-end gap-3">
                            {view === 'preview' && !bonoLocked && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setView('form')}
                                    className="mr-auto flex items-center gap-1 rounded-xl border border-white/10 px-4 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                >
                                    <ArrowLeft className="h-4 w-4" /> Volver
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void closeAfterAssign()}
                                className="rounded-xl border border-white/10 px-4 py-2.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
                            >
                                {view === 'summary' || bonoLocked ? 'Cerrar' : 'Cancelar'}
                            </button>
                            {view !== 'summary' && (
                                <button
                                    type="button"
                                    disabled={busy || (view === 'preview' && conflicts.length > 0)}
                                    onClick={() => void (view === 'form' && repeatAppointments ? loadPreview() : handleConfirm())}
                                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright px-6 py-2.5 font-semibold text-[var(--color-bg-base)] transition-all hover:shadow-lg hover:shadow-emerald/25 disabled:opacity-50"
                                >
                                    {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                                    {busy ? 'Procesando...' : primaryLabel}
                                </button>
                            )}
                        </div>
                    </GlassCard>
                </motion.div>
            </motion.div>

            <AnimatePresence>
                {pickerRow && (
                    <AdminSlotPickerModal
                        title="Cambiar fecha/hora de la cita renovada"
                        description={`Patrón original: ${formatRenewalSlot(pickerRow.originalSlot)}${pickerRow.reason ? ` · ${renewalReasonLabel(pickerRow.reason)}` : ''}`}
                        confirmLabel="Validar y usar esta franja"
                        appointmentType="training"
                        durationMinutes={pickerRow.durationMinutes}
                        customerUserId={client.uid}
                        initialSlot={null}
                        initialTrainerId={pickerRow.trainerId}
                        trainers={trainers}
                        appointments={appointments}
                        plannedCustomerSlots={plannedSlotsFor(pickerRow.key)}
                        onConfirm={handlePickerConfirm}
                        onClose={() => setPickerRow(null)}
                    />
                )}
            </AnimatePresence>
        </>
    );
}
