'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';
import type { Appointment, Trainer, UserProfile } from '@/types';
import { AppointmentReadOnlyModal, type AppointmentStatusVisual } from './AppointmentReadOnlyModal';
import {
  MAX_VISIBLE_DAY_EVENTS,
  WEEKDAY_LABELS,
  formatMonthTitle,
  getCurrentMonth,
  getMonthGrid,
  groupAppointmentsByDay,
  resolveAppointmentSchedule,
  shiftMonth,
} from './appointment-calendar-utils';

interface AppointmentsCalendarProps {
  appointments: Appointment[];
  getClientForAppointment: (appointment: Appointment) => UserProfile | undefined;
  trainers: Trainer[];
  statusConfig: Record<Appointment['status'], AppointmentStatusVisual>;
  serviceLabels: Record<string, string>;
  durationLabels: Record<string, string>;
}

function getTrainerName(appointment: Appointment, trainers: Trainer[]): string {
  if (!appointment.assignedTrainer) return '';
  return trainers.find((trainer) => trainer.id === appointment.assignedTrainer)?.name
    || appointment.assignedTrainer;
}

export function AppointmentsCalendar({
  appointments,
  getClientForAppointment,
  trainers,
  statusConfig,
  serviceLabels,
  durationLabels,
}: AppointmentsCalendarProps) {
  const [{ year, monthIndex }, setMonth] = useState(() => getCurrentMonth());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);

  const days = useMemo(() => getMonthGrid(year, monthIndex), [year, monthIndex]);
  const appointmentsByDay = useMemo(() => groupAppointmentsByDay(appointments), [appointments]);
  const selectedAppointment = selectedAppointmentId
    ? appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null
    : null;

  const goToToday = () => setMonth(getCurrentMonth());
  const goToPreviousMonth = () => setMonth((current) => shiftMonth(current.year, current.monthIndex, -1));
  const goToNextMonth = () => setMonth((current) => shiftMonth(current.year, current.monthIndex, 1));

  const toggleDayExpanded = (date: string) => {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  return (
    <>
      <GlassCard hover={false} className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPreviousMonth}
              aria-label="Mes anterior"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] transition-all hover:shadow-emerald-glow"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="min-w-[10.5rem] text-center text-lg font-bold tracking-wide text-[var(--color-text-primary)]">
              {formatMonthTitle(year, monthIndex)}
            </h2>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Mes siguiente"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] transition-all hover:shadow-emerald-glow"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Hoy
          </button>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] sm:min-w-0">
            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]"
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const dayAppointments = appointmentsByDay.get(day.date) ?? [];
                const expanded = expandedDays.has(day.date);
                const visibleAppointments = expanded
                  ? dayAppointments
                  : dayAppointments.slice(0, MAX_VISIBLE_DAY_EVENTS);
                const hiddenCount = dayAppointments.length - visibleAppointments.length;

                return (
                  <div
                    key={day.date}
                    className={cn(
                      'min-h-[7rem] rounded-xl border border-border/60 bg-muted/20 p-1.5 sm:min-h-[8.5rem] sm:p-2',
                      !day.inCurrentMonth && 'opacity-40',
                      day.isToday && 'ring-1 ring-[var(--color-accent-border)]',
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={cn(
                          'text-xs font-semibold text-[var(--color-text-primary)]',
                          day.isToday && 'text-[var(--color-accent-val)]',
                        )}
                      >
                        {day.day}
                      </span>
                    </div>

                    <div className={cn('space-y-1', expanded && 'max-h-40 overflow-y-auto')}>
                      {visibleAppointments.map((appointment) => {
                        const schedule = resolveAppointmentSchedule(appointment);
                        const client = getClientForAppointment(appointment);
                        const clientName = client?.name || appointment.name;
                        const trainerName = getTrainerName(appointment, trainers);
                        const statusVisual = statusConfig[appointment.status];
                        const durationMinutes = schedule?.durationMinutes;

                        return (
                          <button
                            key={appointment.id}
                            type="button"
                            onClick={() => setSelectedAppointmentId(appointment.id)}
                            className={cn(
                              'w-full rounded-md border px-1.5 py-1 text-left transition-colors hover:brightness-110',
                              statusVisual?.color,
                            )}
                          >
                            <span className="block truncate text-[11px] font-semibold leading-tight">
                              {schedule?.time ?? '—'} {clientName}
                              {appointment.recurrenceSeriesId ? (
                                <>
                                  {' '}
                                  <Repeat className="ml-0.5 inline h-3 w-3 align-text-top opacity-80" aria-hidden />
                                </>
                              ) : null}
                            </span>
                            <span className="mt-0.5 hidden truncate text-[10px] leading-tight opacity-80 sm:block">
                              {durationMinutes ? `${durationMinutes} min` : '—'}
                              {trainerName ? ` · ${trainerName}` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleDayExpanded(day.date)}
                        className="mt-1 w-full text-left text-[10px] font-medium text-[var(--color-accent-val)] hover:underline"
                      >
                        + {hiddenCount} más
                      </button>
                    )}
                    {expanded && dayAppointments.length > MAX_VISIBLE_DAY_EVENTS && (
                      <button
                        type="button"
                        onClick={() => toggleDayExpanded(day.date)}
                        className="mt-1 w-full text-left text-[10px] font-medium text-[var(--color-text-secondary)] hover:underline"
                      >
                        Ver menos
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </GlassCard>

      {selectedAppointment && (
        <AppointmentReadOnlyModal
          appointment={selectedAppointment}
          clientName={getClientForAppointment(selectedAppointment)?.name || selectedAppointment.name}
          trainerName={getTrainerName(selectedAppointment, trainers)}
          serviceLabels={serviceLabels}
          durationLabels={durationLabels}
          statusConfig={statusConfig}
          onClose={() => setSelectedAppointmentId(null)}
        />
      )}
    </>
  );
}
