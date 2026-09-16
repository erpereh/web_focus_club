'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, Clock3, Repeat2, UserRound, X } from 'lucide-react';
import {
  InteractiveCalendar,
  type CalendarAvailabilityState,
} from '@/components/ui/interactive-calendar';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { getAppointmentEffectiveSlot } from '@/lib/madrid-date';
import {
  buildRescheduleCalendarContext,
  getRecurringRescheduleErrorMessage,
  getRecurringRescheduleExcludedAppointmentIds,
  RECURRING_RESCHEDULE_SCOPE_OPTIONS,
  type RecurringRescheduleScope,
} from '@/lib/recurring-reschedule';
import { cn } from '@/lib/utils';
import type { Appointment, TimeSlot, Trainer } from '@/types';

export interface AppointmentRescheduleSubmit {
  slot: TimeSlot;
  scope: RecurringRescheduleScope | null;
}

interface AppointmentRescheduleModalProps {
  appointment: Appointment;
  appointments: Appointment[];
  trainers: Trainer[];
  onClose: () => void;
  onSave: (input: AppointmentRescheduleSubmit) => Promise<void>;
}

function formatCivilDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function AppointmentRescheduleModal({
  appointment,
  appointments,
  trainers,
  onClose,
  onSave,
}: AppointmentRescheduleModalProps) {
  const isRecurringApproved = appointment.status === 'approved' && Boolean(appointment.recurrenceSeriesId);
  const [scope, setScope] = useState<RecurringRescheduleScope | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [availabilityState, setAvailabilityState] = useState<CalendarAvailabilityState>({
    status: 'loading',
    message: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const currentSlot = getAppointmentEffectiveSlot(appointment);
  const duration = Number(appointment.duration) as 30 | 45 | 60;
  const trainerName = appointment.assignedTrainer
    ? trainers.find((trainer) => trainer.id === appointment.assignedTrainer)?.name
      ?? appointment.assignedTrainer
    : null;

  const seriesExcludedIds = useMemo(() => isRecurringApproved
    ? getRecurringRescheduleExcludedAppointmentIds(appointments, appointment, 'series', new Date())
    : new Set<string>(), [appointment, appointments, isRecurringApproved]);
  const excludedIds = useMemo(() => {
    if (!isRecurringApproved) return new Set([appointment.id]);
    if (!scope) return new Set<string>();
    return getRecurringRescheduleExcludedAppointmentIds(appointments, appointment, scope, new Date());
  }, [appointment, appointments, isRecurringApproved, scope]);
  const calendarContext = useMemo(() => buildRescheduleCalendarContext(
    appointments,
    appointment.userId,
    excludedIds,
  ), [appointment.userId, appointments, excludedIds]);

  const clearSelectedSlot = useCallback(() => setSelectedSlot(null), []);
  const handleAvailabilityStateChange = useCallback((state: CalendarAvailabilityState) => {
    setAvailabilityState(state);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const handleScopeChange = (nextScope: RecurringRescheduleScope) => {
    if (nextScope === scope) return;
    setScope(nextScope);
    setSelectedDate(null);
    setSelectedSlot(null);
    setAvailabilityState({ status: 'loading', message: null });
    setError('');
  };

  const handleSubmit = async () => {
    if (!selectedSlot || busy || availabilityState.status !== 'ready') return;
    if (isRecurringApproved && !scope) {
      setError('Elige qué citas quieres modificar.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({ slot: selectedSlot, scope });
    } catch (saveError) {
      setError(getRecurringRescheduleErrorMessage(saveError, 'Error al modificar la franja.'));
    } finally {
      setBusy(false);
    }
  };

  const futureCount = seriesExcludedIds.size;
  const canShowCalendar = !isRecurringApproved || Boolean(scope);
  const canSave = Boolean(
    selectedSlot
    && availabilityState.status === 'ready'
    && (!isRecurringApproved || scope)
    && !busy,
  );

  return (
    <motion.div
      key="edit-slot-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-md sm:p-6"
      onClick={() => { if (!busy) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0, y: 18 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.98, opacity: 0, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-reschedule-title"
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-background shadow-2xl sm:max-h-[calc(100vh-3rem)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/70 bg-background/95 px-5 py-5 backdrop-blur-xl sm:px-7">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--color-accent-val)]">Agenda Focus Club</p>
            <h2 id="appointment-reschedule-title" className="text-xl font-bold text-[var(--color-text-primary)] sm:text-2xl">Modificar cita</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {isRecurringApproved ? 'Elige el alcance y después una nueva franja.' : 'Elige una nueva fecha y hora para esta sesión.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar modificación de cita"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white/5 text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent-border)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
          <div className="space-y-6">
            <section aria-labelledby="current-appointment-heading">
              <p id="current-appointment-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">Cita actual</p>
              <GlassCard className="relative overflow-hidden p-4 sm:p-5">
                <span className="absolute inset-y-0 left-0 w-1 bg-[var(--color-accent-val)]" aria-hidden="true" />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold capitalize text-[var(--color-text-primary)]">
                      {currentSlot ? formatCivilDate(currentSlot.date) : 'Fecha no disponible'}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <Clock3 className="h-4 w-4 text-[var(--color-accent-val)]" />
                      {currentSlot?.time ?? '--:--'} · {duration} min
                    </p>
                  </div>
                  {trainerName && (
                    <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <UserRound className="h-4 w-4" />
                      {trainerName}
                    </p>
                  )}
                </div>
              </GlassCard>
            </section>

            {isRecurringApproved && (
              <section aria-labelledby="reschedule-scope-heading">
                <div className="mb-3 flex items-center gap-2">
                  <Repeat2 className="h-4 w-4 text-[var(--color-accent-val)]" />
                  <h3 id="reschedule-scope-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">¿Qué quieres modificar?</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {RECURRING_RESCHEDULE_SCOPE_OPTIONS.map((option) => {
                    const selected = scope === option.scope;
                    return (
                      <button
                        key={option.scope}
                        type="button"
                        disabled={busy}
                        onClick={() => handleScopeChange(option.scope)}
                        aria-pressed={selected}
                        className={cn(
                          'relative min-h-32 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]',
                          selected
                            ? 'border-[var(--color-accent-val)] bg-[var(--color-accent-dim)] shadow-emerald-glow'
                            : 'border-border bg-white/[0.025] hover:border-[var(--color-accent-border)] hover:bg-white/[0.04]',
                        )}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-semibold text-[var(--color-text-primary)]">{option.title}</span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-[var(--color-accent-val)]" />}
                        </span>
                        {option.scope === 'series' && (
                          <span className="mt-2 block text-xs font-bold uppercase tracking-wider text-[var(--color-accent-val)]">
                            {futureCount} {futureCount === 1 ? 'sesión futura' : 'sesiones futuras'}
                          </span>
                        )}
                        <span className="mt-2 block text-sm leading-relaxed text-[var(--color-text-secondary)]">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {canShowCalendar && (
                <motion.section
                  key={isRecurringApproved ? scope : 'single-appointment'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  aria-labelledby="new-slot-heading"
                >
                  <h3 id="new-slot-heading" className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">Nueva fecha y hora</h3>
                  <InteractiveCalendar
                    selectedSlot={selectedSlot}
                    onSelectSlot={(slot) => {
                      setSelectedDate(slot.date);
                      setSelectedSlot(slot);
                      setError('');
                    }}
                    onClearSlot={clearSelectedSlot}
                    selectedDate={selectedDate}
                    onSelectDate={(date) => {
                      setSelectedDate(date);
                      setSelectedSlot(null);
                    }}
                    selectedDuration={duration}
                    userBookedSlotKeys={calendarContext.userBookedSlotKeys}
                    occupancyCreditsByKey={calendarContext.occupancyCreditsByKey}
                    disabled={busy}
                    showSelectedSlotSummary={false}
                    availabilityLabelMode="occupancy"
                    onAvailabilityStateChange={handleAvailabilityStateChange}
                  />
                </motion.section>
            )}

            {selectedSlot && (
                <motion.section
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  aria-labelledby="selected-slot-heading"
                >
                  <p id="selected-slot-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-val)]">Nueva franja</p>
                  <div className="rounded-2xl border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-val)]/15">
                        <CalendarClock className="h-4 w-4 text-[var(--color-accent-val)]" />
                      </span>
                      <div>
                        <p className="font-semibold capitalize text-[var(--color-text-primary)]">{formatCivilDate(selectedSlot.date)}</p>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{selectedSlot.time} · {duration} min</p>
                        {isRecurringApproved && scope === 'single' && (
                          <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">Se modificará únicamente esta sesión.</p>
                        )}
                        {isRecurringApproved && scope === 'series' && (
                          <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                            Este horario se utilizará como referencia para recolocar {futureCount === 1 ? 'la sesión futura' : `las ${futureCount} sesiones futuras`} de la serie.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.section>
            )}

            {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-border/70 bg-background/95 px-5 py-4 backdrop-blur-xl sm:flex-row sm:justify-end sm:px-7">
          <PremiumButton variant="ghost" onClick={onClose} disabled={busy}>Cancelar</PremiumButton>
          <PremiumButton
            variant="cta"
            icon={<CalendarClock className="h-4 w-4" />}
            onClick={handleSubmit}
            disabled={!canSave}
          >
            {busy ? 'Guardando...' : 'Guardar cambio'}
          </PremiumButton>
        </footer>
      </motion.div>
    </motion.div>
  );
}
