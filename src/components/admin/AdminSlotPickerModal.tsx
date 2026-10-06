'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CalendarClock, Check, RefreshCw, User, X } from 'lucide-react';
import { InteractiveCalendar, type CalendarAvailabilityState } from '@/components/ui/interactive-calendar';
import { PremiumSelect } from '@/components/ui/premium-select';
import { getCanonicalSlotBlocks } from '@/lib/appointment-slots';
import { getAppointmentEffectiveSlot, getMadridDateKey } from '@/lib/madrid-date';
import { buildRescheduleCalendarContext } from '@/lib/recurring-reschedule';
import { cn } from '@/lib/utils';
import { getAppointmentType, type Appointment, type AppointmentType, type TimeSlot, type Trainer } from '@/types';

const UNASSIGNED = '__unassigned__';

export interface AdminSlotPickerResult {
    slot: TimeSlot;
    trainerId: string | null;
    trainerName: string;
}

export interface AdminSlotPickerModalProps {
    title: string;
    description?: string;
    confirmLabel: string;
    appointmentType: AppointmentType;
    durationMinutes: 30 | 45 | 60;
    customerUserId: string;
    initialSlot?: TimeSlot | null;
    initialTrainerId?: string | null;
    trainers: Trainer[];
    /** Citas ya cargadas en el panel (se muestran por día con entrenador y estado). */
    appointments: Appointment[];
    excludeAppointmentIds?: string[];
    /** Franjas que el mismo flujo ya va a dar al cliente (p. ej. otras citas renovadas). */
    plannedCustomerSlots?: Array<{ slot: TimeSlot; durationMinutes: number }>;
    /** Lanza un error con mensaje en español si el servidor rechaza la franja. */
    onConfirm: (result: AdminSlotPickerResult) => Promise<void>;
    onClose: () => void;
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
    pending: 'Pendiente',
    approved: 'Aprobada',
    rejected: 'Rechazada',
    cancelled: 'Cancelada',
};

function slotKey(date: string, time: string): string {
    return `${date}_${time}`;
}

function formatLongDate(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function AdminSlotPickerModal({
    title,
    description,
    confirmLabel,
    appointmentType,
    durationMinutes,
    customerUserId,
    initialSlot = null,
    initialTrainerId = null,
    trainers,
    appointments,
    excludeAppointmentIds = [],
    plannedCustomerSlots = [],
    onConfirm,
    onClose,
}: AdminSlotPickerModalProps) {
    const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(initialSlot);
    const [selectedDate, setSelectedDate] = useState<string | null>(initialSlot?.date ?? null);
    const [trainerId, setTrainerId] = useState<string | null>(initialTrainerId);
    const [availability, setAvailability] = useState<CalendarAvailabilityState>({ status: 'loading', message: null });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const isNutrition = appointmentType === 'nutrition';
    const eligibleTrainers = useMemo(() => trainers.filter((trainer) => trainer.active !== false
        && (!isNutrition || trainer.offersNutrition === true)), [isNutrition, trainers]);
    const trainerName = trainers.find((trainer) => trainer.id === trainerId)?.name ?? '';

    const calendarContext = useMemo(() => {
        const context = buildRescheduleCalendarContext(appointments, customerUserId, new Set(excludeAppointmentIds));
        plannedCustomerSlots.forEach(({ slot, durationMinutes: minutes }) => {
            getCanonicalSlotBlocks(slot.time, minutes).forEach((time) => {
                context.userBookedSlotKeys.add(slotKey(slot.date, time));
            });
        });
        return context;
    }, [appointments, customerUserId, excludeAppointmentIds, plannedCustomerSlots]);

    const dayAppointments = useMemo(() => {
        if (!selectedDate) return [];
        return appointments
            .filter((appointment) => appointment.status === 'pending' || appointment.status === 'approved')
            .map((appointment) => ({ appointment, slot: getAppointmentEffectiveSlot(appointment) }))
            .filter((entry): entry is { appointment: Appointment; slot: TimeSlot } => entry.slot?.date === selectedDate)
            .sort((a, b) => a.slot.time.localeCompare(b.slot.time));
    }, [appointments, selectedDate]);

    const trainerRequired = isNutrition;
    const canConfirm = Boolean(selectedSlot)
        && availability.status === 'ready'
        && (!trainerRequired || Boolean(trainerId))
        && !busy;

    const handleConfirm = async () => {
        if (!selectedSlot) {
            setError('Elige una fecha y hora en el calendario.');
            return;
        }
        if (trainerRequired && !trainerId) {
            setError('Selecciona el profesional de nutrición.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await onConfirm({ slot: selectedSlot, trainerId, trainerName });
        } catch (confirmError) {
            setError(confirmError instanceof Error && confirmError.message
                ? confirmError.message
                : 'No se ha podido validar la franja seleccionada.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <motion.div
            key="admin-slot-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6"
            onClick={() => { if (!busy) onClose(); }}
        >
            <motion.div
                initial={{ scale: 0.97, opacity: 0, y: 18 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.98, opacity: 0, y: 10 }}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-slot-picker-title"
                className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-background shadow-2xl sm:max-h-[calc(100vh-3rem)]"
            >
                <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
                    <div>
                        <h2 id="admin-slot-picker-title" className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
                            <CalendarClock className="h-5 w-5 text-[var(--color-accent-val)]" />
                            {title}
                        </h2>
                        {description && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>}
                        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                            {isNutrition ? 'Consulta de nutrición' : 'Entrenamiento'} · {durationMinutes} min
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Cerrar"
                        className="rounded-xl p-2 text-[var(--color-text-secondary)] hover:bg-white/5 hover:text-[var(--color-text-primary)]"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="grid flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <section aria-label="Calendario de disponibilidad">
                        <InteractiveCalendar
                            selectedSlot={selectedSlot}
                            onSelectSlot={(slot) => {
                                setSelectedDate(slot.date);
                                setSelectedSlot(slot);
                                setError('');
                            }}
                            onClearSlot={() => setSelectedSlot(null)}
                            selectedDate={selectedDate}
                            onSelectDate={(date) => {
                                setSelectedDate(date);
                                setSelectedSlot(null);
                                setError('');
                            }}
                            selectedDuration={durationMinutes}
                            userBookedSlotKeys={calendarContext.userBookedSlotKeys}
                            occupancyCreditsByKey={calendarContext.occupancyCreditsByKey}
                            minDate={getMadridDateKey(new Date())}
                            availabilityLabelMode="occupancy"
                            disabled={busy}
                            onAvailabilityStateChange={setAvailability}
                        />
                    </section>

                    <aside className="space-y-4">
                        <div>
                            <label htmlFor="admin-slot-picker-trainer" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">
                                {isNutrition ? 'Profesional de nutrición' : 'Entrenador'}
                            </label>
                            <PremiumSelect
                                id="admin-slot-picker-trainer"
                                ariaLabel={isNutrition ? 'Profesional de nutrición' : 'Entrenador'}
                                value={trainerId ?? UNASSIGNED}
                                disabled={busy}
                                onChange={(value) => {
                                    setTrainerId(value === UNASSIGNED ? null : value);
                                    setError('');
                                }}
                                options={[
                                    {
                                        value: UNASSIGNED,
                                        label: isNutrition ? 'Selecciona un profesional' : 'Sin asignar',
                                        disabled: isNutrition,
                                    },
                                    ...eligibleTrainers.map((trainer) => ({ value: trainer.id, label: trainer.name })),
                                ]}
                            />
                            {isNutrition && eligibleTrainers.length === 0 && (
                                <p className="mt-2 text-xs text-amber-400">
                                    No hay profesionales marcados para nutrición. Actívalo en la pestaña Equipo.
                                </p>
                            )}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                                {selectedDate ? `Citas del ${formatLongDate(selectedDate)}` : 'Elige un día para ver sus citas'}
                            </h3>
                            {selectedDate && dayAppointments.length === 0 && (
                                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">No hay citas pendientes ni aprobadas.</p>
                            )}
                            <ul className="mt-3 space-y-2">
                                {dayAppointments.map(({ appointment, slot }) => {
                                    const appointmentTrainer = trainers.find((trainer) => trainer.id === appointment.assignedTrainer)?.name;
                                    const isOwn = appointment.userId === customerUserId;
                                    return (
                                        <li
                                            key={appointment.id}
                                            className={cn(
                                                'rounded-xl border px-3 py-2 text-xs',
                                                isOwn ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-dim)]' : 'border-white/10 bg-white/[0.02]',
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-[var(--color-text-primary)]">{slot.time} · {appointment.duration} min</span>
                                                <span className={appointment.status === 'approved' ? 'text-emerald-400' : 'text-amber-400'}>
                                                    {STATUS_LABELS[appointment.status]}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-[var(--color-text-secondary)]">
                                                {appointment.name}{isOwn ? ' (este cliente)' : ''}
                                                {getAppointmentType(appointment) === 'nutrition' ? ' · Nutrición' : ''}
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-1 text-[var(--color-text-secondary)]">
                                                <User className="h-3 w-3" />
                                                {appointmentTrainer ?? 'Sin entrenador'}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        {selectedSlot && (
                            <p className="rounded-xl border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] p-3 text-sm text-[var(--color-text-primary)]">
                                Nueva franja: <strong>{formatLongDate(selectedSlot.date)} a las {selectedSlot.time}</strong>
                                {trainerName ? ` con ${trainerName}` : ''}
                            </p>
                        )}
                        {availability.status === 'error' && (
                            <p role="alert" className="text-sm text-red-400">{availability.message}</p>
                        )}
                    </aside>
                </div>

                <footer className="flex flex-col gap-3 border-t border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-h-[1.25rem] text-sm">
                        {error && (
                            <span role="alert" className="flex items-center gap-2 text-red-400">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                {error}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="rounded-xl border border-white/10 px-4 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={!canConfirm}
                            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright px-6 py-2.5 font-semibold text-[var(--color-bg-base)] transition-all disabled:opacity-50"
                        >
                            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {busy ? 'Validando...' : confirmLabel}
                        </button>
                    </div>
                </footer>
            </motion.div>
        </motion.div>
    );
}
