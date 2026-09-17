'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  Check,
  Clock3,
  Repeat2,
  UserRound,
  X,
} from 'lucide-react';
import {
  InteractiveCalendar,
  type CalendarAvailabilityState,
} from '@/components/ui/interactive-calendar';
import { PremiumSelect } from '@/components/ui/premium-select';
import { RecurringHastaSelect } from '@/components/ui/recurring-hasta-select';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import {
  getAppointmentRecurrence,
  getAvailabilityForDates,
  getBonosByUser,
  getSiteConfig,
} from '@/lib/firestore';
import { classifyMadridCivilSlot, getAppointmentEffectiveSlot } from '@/lib/madrid-date';
import {
  formatRecurringSeriesPreview,
  generateRecurringOccurrenceDates,
  getAdminRecurringHastaViewModel,
  sanitizeRecurringEndDate,
} from '@/lib/recurring-appointments';
import {
  evaluateRecurringHastaOptions,
  sanitizeRecurringEndDateByAvailability,
  type RecurringHastaAvailabilityPhase,
  type RecurringHastaOptionStatus,
} from '@/lib/recurring-hasta-availability';
import {
  buildRescheduleCalendarContext,
  getRecurringRescheduleErrorMessage,
  getRecurringRescheduleExcludedAppointmentIds,
  RECURRING_RESCHEDULE_SCOPE_OPTIONS,
  type RecurringRescheduleScope,
} from '@/lib/recurring-reschedule';
import { cn } from '@/lib/utils';
import {
  getBonoMinutosRestantes,
  type Appointment,
  type AppointmentRecurrence,
  type Bono,
  type TimeSlot,
  type Trainer,
} from '@/types';

export interface AppointmentRescheduleSubmit {
  slot: TimeSlot;
  scope: RecurringRescheduleScope | null;
  assignedTrainer: string | null;
  endDate?: string;
}

export interface AppointmentRescheduleModalProps {
  appointment: Appointment;
  appointments: Appointment[];
  trainers: Trainer[];
  onClose: () => void;
  onSave: (input: AppointmentRescheduleSubmit) => Promise<void>;
}

const TRAINER_PENDING_VALUE = '__trainer_pending__';
const TRAINER_UNASSIGNED_VALUE = '__trainer_unassigned__';

type TrainerSelection =
  | { kind: 'pending' }
  | { kind: 'unassigned' }
  | { kind: 'trainer'; trainerId: string };

function formatCivilDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function slotsMatch(left: TimeSlot | undefined, right: TimeSlot | undefined): boolean {
  return Boolean(left && right && left.date === right.date && left.time === right.time);
}

function isValidDuration(value: number): value is 30 | 45 | 60 {
  return value === 30 || value === 45 || value === 60;
}

function isFutureApprovedOccurrence(appointment: Appointment, now: Date): boolean {
  if (appointment.status !== 'approved') return false;
  const slot = getAppointmentEffectiveSlot(appointment);
  return Boolean(slot && classifyMadridCivilSlot(slot, now).isFuture);
}

function activeTrainerIds(trainers: Trainer[]): Set<string> {
  return new Set(trainers.filter((trainer) => trainer.active !== false).map((trainer) => trainer.id));
}

function getSingleTrainerSelection(
  appointment: Appointment,
  trainers: Trainer[],
  currentIsHistorical: boolean,
): TrainerSelection {
  const trainerId = appointment.assignedTrainer;
  if (!trainerId) return { kind: 'unassigned' };
  const trainer = trainers.find((item) => item.id === trainerId);
  if (trainer?.active !== false && trainer) return { kind: 'trainer', trainerId };
  if (trainer && currentIsHistorical) return { kind: 'trainer', trainerId };
  return { kind: 'pending' };
}

function getSeriesTrainerSelection(
  recurrence: AppointmentRecurrence,
  futureAppointments: Appointment[],
  trainers: Trainer[],
): TrainerSelection {
  const activeIds = activeTrainerIds(trainers);
  if (recurrence.assignedTrainer && activeIds.has(recurrence.assignedTrainer)) {
    return { kind: 'trainer', trainerId: recurrence.assignedTrainer };
  }
  const futureTrainerIds = new Set(futureAppointments.map((item) => item.assignedTrainer ?? null));
  if (futureTrainerIds.size !== 1) return { kind: 'pending' };
  const [onlyTrainerId] = futureTrainerIds;
  return typeof onlyTrainerId === 'string' && activeIds.has(onlyTrainerId)
    ? { kind: 'trainer', trainerId: onlyTrainerId }
    : { kind: 'pending' };
}

function trainerSelectionValue(selection: TrainerSelection): string {
  if (selection.kind === 'pending') return TRAINER_PENDING_VALUE;
  if (selection.kind === 'unassigned') return TRAINER_UNASSIGNED_VALUE;
  return selection.trainerId;
}

function hasValidFutureReservation(
  appointment: Appointment,
  duration: 30 | 45 | 60,
  seriesBonoId?: string,
): boolean {
  return appointment.status === 'approved'
    && (!seriesBonoId || appointment.bonoId === seriesBonoId)
    && appointment.minutesDeducted === true
    && appointment.minutesDeductedAmount === duration
    && typeof appointment.minutesDeductedAt === 'string'
    && appointment.minutesDeductedAt.length > 0
    && appointment.minutesRefunded !== true
    && !appointment.minutesRefundedAt;
}

export function AppointmentRescheduleModal({
  appointment,
  appointments,
  trainers,
  onClose,
  onSave,
}: AppointmentRescheduleModalProps) {
  const isRecurringApproved = appointment.status === 'approved' && Boolean(appointment.recurrenceSeriesId);
  const currentSlot = getAppointmentEffectiveSlot(appointment);
  const parsedDuration = Number(appointment.duration);
  const duration = isValidDuration(parsedDuration) ? parsedDuration : 60;
  const originalTrainerId = appointment.assignedTrainer ?? null;
  const [now] = useState(() => new Date());
  const currentIsHistorical = Boolean(currentSlot && !classifyMadridCivilSlot(currentSlot, now).isFuture);
  const [trainerSelection, setTrainerSelection] = useState<TrainerSelection>(() =>
    getSingleTrainerSelection(appointment, trainers, currentIsHistorical));
  const [scope, setScope] = useState<RecurringRescheduleScope | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [endDate, setEndDate] = useState('');
  const [availabilityState, setAvailabilityState] = useState<CalendarAvailabilityState>({
    status: 'loading',
    message: null,
  });
  const [hastaAvailabilityPhase, setHastaAvailabilityPhase] = useState<RecurringHastaAvailabilityPhase>('idle');
  const [hastaOptionStatuses, setHastaOptionStatuses] = useState<RecurringHastaOptionStatus[]>([]);
  const [recurrence, setRecurrence] = useState<AppointmentRecurrence | null>(null);
  const [seriesBono, setSeriesBono] = useState<Bono | null>(null);
  const [seriesMetadataPhase, setSeriesMetadataPhase] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedTrainerId = trainerSelection.kind === 'trainer' ? trainerSelection.trainerId : null;
  const trainerDecisionReady = trainerSelection.kind !== 'pending';
  const trainerChanged = trainerDecisionReady && selectedTrainerId !== originalTrainerId;
  const trainerName = appointment.assignedTrainer
    ? trainers.find((trainer) => trainer.id === appointment.assignedTrainer)?.name
      ?? appointment.assignedTrainer
    : null;
  const selectedTrainerName = trainerSelection.kind === 'trainer'
    ? trainers.find((trainer) => trainer.id === selectedTrainerId)?.name ?? selectedTrainerId
    : null;
  const futureSeriesAppointments = useMemo(() => {
    if (!appointment.recurrenceSeriesId) return [];
    return appointments
      .filter((item) => item.recurrenceSeriesId === appointment.recurrenceSeriesId)
      .filter((item) => isFutureApprovedOccurrence(item, now))
      .sort((left, right) => (left.recurrenceIndex ?? 0) - (right.recurrenceIndex ?? 0));
  }, [appointment.recurrenceSeriesId, appointments, now]);
  const isSeriesFlow = isRecurringApproved && scope === 'series';
  const futureApprovedCount = futureSeriesAppointments.length;
  const visibleTrainers = useMemo(() => trainers.filter((trainer) =>
    trainer.active !== false
    || (!isSeriesFlow
      && currentIsHistorical
      && trainer.id === appointment.assignedTrainer)), [appointment.assignedTrainer, currentIsHistorical, isSeriesFlow, trainers]);

  useEffect(() => {
    if (scope === 'series') return;
    setTrainerSelection(getSingleTrainerSelection(appointment, trainers, currentIsHistorical));
  }, [appointment, currentIsHistorical, scope, trainers]);

  useEffect(() => {
    if (!isRecurringApproved || scope !== 'series' || !appointment.recurrenceSeriesId) {
      setRecurrence(null);
      setSeriesBono(null);
      setSeriesMetadataPhase('idle');
      return;
    }

    let cancelled = false;
    setSeriesMetadataPhase('loading');
    setTrainerSelection({ kind: 'pending' });
    setError('');
    getAppointmentRecurrence(appointment.recurrenceSeriesId)
      .then(async (rawRecurrence) => {
        const loadedRecurrence = rawRecurrence as AppointmentRecurrence | null;
        if (!loadedRecurrence) return { loadedRecurrence: null, bonos: [] as Bono[] };
        const bonos = await getBonosByUser(loadedRecurrence.userId);
        return { loadedRecurrence, bonos };
      })
      .then(({ loadedRecurrence, bonos }) => {
        if (cancelled) return;
        if (!loadedRecurrence) {
          setRecurrence(null);
          setSeriesBono(null);
          setSeriesMetadataPhase('error');
          setTrainerSelection({ kind: 'pending' });
          setError('No se ha podido cargar la serie recurrente.');
          return;
        }
        const exactBono = bonos.find((bono) => bono.id === loadedRecurrence.bonoId) ?? null;
        setRecurrence(loadedRecurrence);
        setSeriesBono(exactBono);
        if (!exactBono) {
          setSeriesMetadataPhase('error');
          setTrainerSelection({ kind: 'pending' });
          setError('No se ha podido cargar el bono reservado de la serie.');
          return;
        }
        if (exactBono.estado === 'eliminado') {
          setSeriesMetadataPhase('unavailable');
          setTrainerSelection({ kind: 'pending' });
          setError('El bono asociado a esta serie está eliminado y la programación no puede modificarse.');
          return;
        }
        setSeriesMetadataPhase('ready');
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        console.error('Error cargando la serie para modificarla:', loadError);
        setRecurrence(null);
        setSeriesBono(null);
        setSeriesMetadataPhase('error');
        setTrainerSelection({ kind: 'pending' });
        setError('No se ha podido cargar la serie recurrente.');
      });

    return () => {
      cancelled = true;
    };
  }, [appointment.recurrenceSeriesId, appointment.userId, isRecurringApproved, scope]);

  useEffect(() => {
    if (!isSeriesFlow
      || seriesMetadataPhase !== 'ready'
      || !recurrence
      || trainerSelection.kind !== 'pending') return;
    setTrainerSelection(getSeriesTrainerSelection(recurrence, futureSeriesAppointments, trainers));
  }, [futureSeriesAppointments, isSeriesFlow, recurrence, seriesMetadataPhase, trainerSelection.kind, trainers]);

  useEffect(() => {
    if (!isRecurringApproved || scope !== 'series' || futureApprovedCount > 0) return;
    setScope(null);
    setSelectedDate(null);
    setSelectedSlot(null);
    setEndDate('');
    setHastaAvailabilityPhase('idle');
    setHastaOptionStatuses([]);
    setAvailabilityState({ status: 'loading', message: null });
    setError('');
  }, [futureApprovedCount, isRecurringApproved, scope]);

  const seriesExcludedIds = useMemo(() => isRecurringApproved
    ? getRecurringRescheduleExcludedAppointmentIds(appointments, appointment, 'series', now)
    : new Set<string>(), [appointment, appointments, isRecurringApproved, now]);
  const excludedIds = useMemo(() => {
    if (!isRecurringApproved) return new Set([appointment.id]);
    if (!scope) return new Set<string>();
    return scope === 'series'
      ? seriesExcludedIds
      : new Set([appointment.id]);
  }, [appointment.id, isRecurringApproved, scope, seriesExcludedIds]);
  const calendarContext = useMemo(() => {
    if (isSeriesFlow) {
      if (seriesMetadataPhase !== 'ready' || !recurrence?.userId) {
        return { userBookedSlotKeys: new Set<string>(), occupancyCreditsByKey: new Map<string, number>() };
      }
      return buildRescheduleCalendarContext(appointments, recurrence.userId, excludedIds);
    }
    return buildRescheduleCalendarContext(appointments, appointment.userId, excludedIds);
  }, [appointment.userId, appointments, excludedIds, isSeriesFlow, recurrence?.userId, seriesMetadataPhase]);
  const currentFutureReservedMinutes = useMemo(() => futureSeriesAppointments.reduce(
    (total, item) => total + (hasValidFutureReservation(item, duration, recurrence?.bonoId) ? duration : 0),
    0,
  ), [duration, futureSeriesAppointments, recurrence?.bonoId]);
  const recurringHasta = useMemo(() => getAdminRecurringHastaViewModel({
    startDate: isSeriesFlow ? selectedDate : null,
    intervalDays: recurrence?.intervalDays ?? 0,
    durationMinutes: duration,
    remainingMinutes: (seriesBono ? getBonoMinutosRestantes(seriesBono) : 0) + currentFutureReservedMinutes,
    futureReservedCount: futureApprovedCount,
    bonoExpirationDate: seriesBono?.fechaExpiracion,
    now,
  }), [currentFutureReservedMinutes, duration, futureApprovedCount, isSeriesFlow, now, recurrence?.intervalDays, selectedDate, seriesBono]);

  useEffect(() => {
    if (!isSeriesFlow) {
      if (endDate) setEndDate('');
      if (hastaAvailabilityPhase !== 'idle') setHastaAvailabilityPhase('idle');
      if (hastaOptionStatuses.length > 0) setHastaOptionStatuses([]);
      return;
    }
    const mathSanitized = sanitizeRecurringEndDate(endDate, recurringHasta.options);
    const nextEndDate = sanitizeRecurringEndDateByAvailability(
      mathSanitized,
      hastaOptionStatuses,
      hastaAvailabilityPhase,
    );
    if (nextEndDate !== endDate) setEndDate(nextEndDate);
  }, [endDate, hastaAvailabilityPhase, hastaOptionStatuses, isSeriesFlow, recurringHasta.options]);

  useEffect(() => {
    if (!isSeriesFlow
      || seriesMetadataPhase !== 'ready'
      || !selectedDate
      || !selectedSlot?.time
      || recurringHasta.options.length === 0) {
      if (hastaAvailabilityPhase !== 'idle') setHastaAvailabilityPhase('idle');
      if (hastaOptionStatuses.length > 0) setHastaOptionStatuses([]);
      return;
    }

    let cancelled = false;
    setHastaAvailabilityPhase('loading');
    const lastEndDate = recurringHasta.options.at(-1)?.endDate;
    if (!lastEndDate) return () => { cancelled = true; };
    const dates = generateRecurringOccurrenceDates(
      selectedDate,
      recurrence?.intervalDays ?? 0,
      lastEndDate,
    );

    Promise.all([getAvailabilityForDates(dates), getSiteConfig()])
      .then(([availability, config]) => {
        if (cancelled) return;
        const blockedKeys = new Set(
          availability.blockedSlots.map((slot) => `${slot.date}_${slot.time}`),
        );
        setHastaOptionStatuses(evaluateRecurringHastaOptions({
          startDate: selectedDate,
          startTime: selectedSlot.time,
          intervalDays: recurrence?.intervalDays ?? 0,
          durationMinutes: duration,
          options: recurringHasta.options,
          occupancy: availability.occupancy,
          occupancyCreditsByKey: calendarContext.occupancyCreditsByKey,
          blockedKeys,
          userBookedSlotKeys: calendarContext.userBookedSlotKeys,
          siteConfig: config,
          now: new Date(),
        }));
        setHastaAvailabilityPhase('ready');
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        console.error('Error comprobando la disponibilidad de la serie:', loadError);
        setHastaOptionStatuses([]);
        setHastaAvailabilityPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [calendarContext, duration, isSeriesFlow, recurrence?.intervalDays, recurringHasta.options, selectedDate, selectedSlot?.time, seriesMetadataPhase]);

  const clearSelectedSlot = useCallback(() => {
    setSelectedSlot(null);
    setEndDate('');
    setHastaAvailabilityPhase('idle');
    setHastaOptionStatuses([]);
  }, []);
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
    if (nextScope === scope || (nextScope === 'series' && futureApprovedCount === 0)) return;
    setScope(nextScope);
    setSelectedDate(null);
    setSelectedSlot(null);
    setEndDate('');
    setHastaAvailabilityPhase('idle');
    setHastaOptionStatuses([]);
    setAvailabilityState({ status: 'loading', message: null });
    setError('');
    if (nextScope === 'series') {
      setTrainerSelection({ kind: 'pending' });
      setRecurrence(null);
      setSeriesBono(null);
      setSeriesMetadataPhase('loading');
    } else {
      setTrainerSelection(getSingleTrainerSelection(appointment, trainers, currentIsHistorical));
      setRecurrence(null);
      setSeriesBono(null);
      setSeriesMetadataPhase('idle');
    }
  };

  const effectiveSlot = selectedSlot ?? currentSlot;
  const selectedIsHistorical = Boolean(effectiveSlot && !classifyMadridCivilSlot(effectiveSlot, now).isFuture);
  const showHistoricalNotice = !isSeriesFlow && (currentIsHistorical || selectedIsHistorical);
  const targetSlotChanged = !slotsMatch(effectiveSlot, currentSlot);
  const calendarReady = availabilityState.status === 'ready';
  const selectedEndOption = endDate
    ? recurringHasta.options.find((option) => option.endDate === endDate)
    : undefined;
  const selectedSeriesStatus = endDate
    ? hastaOptionStatuses.find((status) => status.option.endDate === endDate)
    : undefined;
  const seriesReady = Boolean(
    futureApprovedCount > 0
    && seriesMetadataPhase === 'ready'
    && selectedSlot
    && endDate
    && hastaAvailabilityPhase === 'ready'
    && selectedSeriesStatus?.availability === 'available'
    && trainerDecisionReady,
  );
  const singleAvailabilityReady = !targetSlotChanged || calendarReady;
  const canSave = Boolean(
    !busy
    && effectiveSlot
    && trainerDecisionReady
    && (!isRecurringApproved || Boolean(scope))
    && (!isSeriesFlow || futureApprovedCount > 0)
    && (isSeriesFlow
      ? calendarReady && seriesReady
      : (!isRecurringApproved || scope === 'single' || scope === null)
        && singleAvailabilityReady
        && (targetSlotChanged || trainerChanged)),
  );

  const handleSubmit = async () => {
    if (busy) return;
    if (isRecurringApproved && !scope) {
      setError('Elige qué citas quieres modificar.');
      return;
    }
    if (!trainerDecisionReady) {
      setError(isSeriesFlow
        ? 'Selecciona el entrenador del nuevo tramo o elige Sin asignar.'
        : 'Selecciona un entrenador activo o elige Sin asignar.');
      return;
    }
    if (!effectiveSlot) {
      setError('Elige una nueva fecha y hora.');
      return;
    }
    if ((isSeriesFlow || targetSlotChanged) && !calendarReady) return;
    if (isSeriesFlow && !seriesReady) {
      setError('Elige una fecha final disponible para la serie.');
      return;
    }
    if (!isSeriesFlow && !targetSlotChanged && !trainerChanged) return;

    setBusy(true);
    setError('');
    try {
      await onSave({
        slot: effectiveSlot,
        scope: isSeriesFlow ? 'series' : isRecurringApproved ? 'single' : null,
        assignedTrainer: selectedTrainerId,
        ...(isSeriesFlow ? { endDate } : {}),
      });
    } catch (saveError) {
      setError(getRecurringRescheduleErrorMessage(saveError, 'Error al modificar la franja.'));
    } finally {
      setBusy(false);
    }
  };

  const canShowCalendar = !isRecurringApproved
    || Boolean(scope && (!isSeriesFlow || seriesMetadataPhase === 'ready'));
  const seriesOptionDisabled = isRecurringApproved && futureApprovedCount === 0;
  const seriesMetadataMessage = seriesMetadataPhase === 'loading'
    ? 'Cargando la serie y el bono reservado...'
    : seriesMetadataPhase === 'error' || seriesMetadataPhase === 'unavailable' ? error : null;
  const trainerAssignmentMessage = trainerDecisionReady && (isSeriesFlow || trainerChanged)
    ? trainerSelection.kind === 'unassigned'
      ? isSeriesFlow
        ? 'El nuevo tramo quedará sin entrenador asignado.'
        : 'La sesión quedará sin entrenador asignado.'
      : isSeriesFlow
        ? `El nuevo tramo quedará asignado a ${selectedTrainerName}.`
        : `Se asignará a ${selectedTrainerName}.`
    : null;

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

            <section aria-labelledby="trainer-heading">
              <label id="trainer-heading" htmlFor="appointment-reschedule-trainer" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">Entrenador asignado</label>
              <PremiumSelect
                id="appointment-reschedule-trainer"
                ariaLabel="Entrenador asignado"
                value={trainerSelectionValue(trainerSelection)}
                disabled={busy || (isSeriesFlow && seriesMetadataPhase !== 'ready')}
                onChange={(value) => {
                  if (value === TRAINER_UNASSIGNED_VALUE) {
                    setTrainerSelection({ kind: 'unassigned' });
                  } else if (value !== TRAINER_PENDING_VALUE) {
                    setTrainerSelection({ kind: 'trainer', trainerId: value });
                  }
                  setError('');
                }}
                options={[
                  ...(trainerSelection.kind === 'pending'
                    ? [{
                      value: TRAINER_PENDING_VALUE,
                      label: isSeriesFlow
                        ? 'Selecciona el entrenador del nuevo tramo'
                        : 'Selecciona un entrenador activo',
                      disabled: true,
                    }]
                    : []),
                  { value: TRAINER_UNASSIGNED_VALUE, label: 'Sin asignar' },
                  ...visibleTrainers.map((trainer) => ({
                    value: trainer.id,
                    label: `${trainer.name}${trainer.active === false ? ' (inactivo)' : ''}`,
                    muted: trainer.active === false,
                  })),
                ]}
              />
              {trainerAssignmentMessage && (
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{trainerAssignmentMessage}</p>
              )}
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
                    const disabledOption = busy || (option.scope === 'series' && seriesOptionDisabled);
                    return (
                      <button
                        key={option.scope}
                        type="button"
                        disabled={disabledOption}
                        onClick={() => handleScopeChange(option.scope)}
                        aria-pressed={selected}
                        className={cn(
                          'relative min-h-32 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]',
                          disabledOption && 'cursor-not-allowed opacity-60',
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
                            {futureApprovedCount} {futureApprovedCount === 1 ? 'sesión futura' : 'sesiones futuras'}
                          </span>
                        )}
                        <span className="mt-2 block text-sm leading-relaxed text-[var(--color-text-secondary)]">{option.description}</span>
                        {option.scope === 'series' && seriesOptionDisabled && (
                          <span className="mt-2 block text-xs text-amber-400">No hay sesiones futuras aprobadas para modificar.</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {seriesMetadataMessage && isRecurringApproved && scope === 'series' && (
              <p role={seriesMetadataPhase === 'loading' ? 'status' : 'alert'} className="rounded-xl border border-border bg-white/[0.025] p-3 text-sm text-[var(--color-text-secondary)]">
                {seriesMetadataMessage}
              </p>
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
                    setHastaAvailabilityPhase('idle');
                    setHastaOptionStatuses([]);
                    setError('');
                  }}
                  onClearSlot={clearSelectedSlot}
                  selectedDate={selectedDate}
                  onSelectDate={(date) => {
                    setSelectedDate(date);
                    setSelectedSlot(null);
                    setEndDate('');
                    setHastaAvailabilityPhase('idle');
                    setHastaOptionStatuses([]);
                    setError('');
                  }}
                  selectedDuration={duration}
                  userBookedSlotKeys={calendarContext.userBookedSlotKeys}
                  occupancyCreditsByKey={calendarContext.occupancyCreditsByKey}
                  allowPastDates={!isSeriesFlow}
                  disabled={busy}
                  showSelectedSlotSummary={false}
                  availabilityLabelMode="occupancy"
                  onAvailabilityStateChange={handleAvailabilityStateChange}
                />
              </motion.section>
            )}

            {isSeriesFlow && recurrence && seriesMetadataPhase === 'ready' && (
              <section aria-labelledby="series-schedule-heading" className="space-y-4">
                <div className="rounded-2xl border border-border bg-white/[0.025] p-4 sm:p-5">
                  <p id="series-schedule-heading" className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">Programación de la serie</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">Cada {recurrence.intervalDays} días</p>
                  {selectedSlot && recurringHasta.options.some((option) => option.endDate === endDate) && (
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      {formatRecurringSeriesPreview(
                        recurringHasta.options.find((option) => option.endDate === endDate)?.occurrenceCount ?? 0,
                        duration,
                      )}
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]">Hasta</label>
                  <RecurringHastaSelect
                    options={recurringHasta.options}
                    value={endDate}
                    onChange={setEndDate}
                    emptyReason={recurringHasta.emptyReason}
                    optionStatuses={hastaAvailabilityPhase === 'ready' ? hastaOptionStatuses : undefined}
                    availabilityLoading={hastaAvailabilityPhase === 'loading'}
                    availabilityError={hastaAvailabilityPhase === 'error'}
                  />
                </div>
              </section>
            )}

            {showHistoricalNotice && (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
                <p className="font-semibold text-amber-200">Corrección histórica</p>
                <p className="mt-1 text-sm text-amber-100/80">Los cambios solo afectan al registro de esta sesión.</p>
              </div>
            )}

            {selectedSlot && (!isSeriesFlow || seriesMetadataPhase === 'ready') && (
              <motion.section
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                aria-labelledby="selected-slot-heading"
              >
                <p id="selected-slot-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-val)]">
                  {isSeriesFlow ? 'Nueva programación' : 'Nueva franja'}
                </p>
                <div className="rounded-2xl border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-val)]/15">
                      <CalendarClock className="h-4 w-4 text-[var(--color-accent-val)]" />
                    </span>
                    <div className="min-w-0">
                      {isSeriesFlow && selectedEndOption ? (
                        <>
                          <p className="font-semibold text-[var(--color-text-primary)]">
                            {selectedEndOption.occurrenceCount} {selectedEndOption.occurrenceCount === 1 ? 'sesión' : 'sesiones'}
                          </p>
                          <p className="mt-1 text-sm capitalize text-[var(--color-text-secondary)]">
                            {formatCivilDate(selectedSlot.date)} → {formatCivilDate(selectedEndOption.endDate)}
                          </p>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                            {selectedSlot.time} · {duration} min · Cada {recurrence?.intervalDays ?? 0} días
                          </p>
                          {trainerDecisionReady && (
                            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                              {trainerSelection.kind === 'unassigned'
                                ? 'Sin entrenador asignado'
                                : selectedTrainerName}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="font-semibold capitalize text-[var(--color-text-primary)]">{formatCivilDate(selectedSlot.date)}</p>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{selectedSlot.time} · {duration} min</p>
                        </>
                      )}
                      {isRecurringApproved && scope === 'single' && (
                        <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">Se modificará únicamente esta sesión.</p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.section>
            )}

            {error && !(seriesMetadataMessage && isRecurringApproved && scope === 'series') && (
              <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
            )}
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
