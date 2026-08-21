'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { cn } from '@/lib/utils';
import type { Appointment } from '@/types';
import { formatLongDate, resolveAppointmentSchedule } from './appointment-calendar-utils';

const EMPTY = '—';

export interface AppointmentStatusVisual {
  label: string;
  color: string;
}

interface AppointmentReadOnlyModalProps {
  appointment: Appointment;
  clientName: string;
  trainerName: string;
  serviceLabels: Record<string, string>;
  durationLabels: Record<string, string>;
  statusConfig: Record<Appointment['status'], AppointmentStatusVisual>;
  onClose: () => void;
}

function displayText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <dt className="text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="break-words text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

export function AppointmentReadOnlyModal({
  appointment,
  clientName,
  trainerName,
  serviceLabels,
  durationLabels,
  statusConfig,
  onClose,
}: AppointmentReadOnlyModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const schedule = resolveAppointmentSchedule(appointment);
  const statusVisual = statusConfig[appointment.status];
  const timeRange = schedule
    ? schedule.endTime
      ? `${schedule.time} - ${schedule.endTime}`
      : schedule.time
    : EMPTY;
  const durationLabel = durationLabels[appointment.duration]
    ?? (schedule?.durationMinutes ? `${schedule.durationMinutes} minutos` : EMPTY);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <GlassCard hover={false} className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl font-bold text-[var(--color-text-primary)]">
              Detalle de la cita
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-muted/20 hover:text-[var(--color-text-primary)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-[var(--color-text-primary)]">
                {displayText(clientName || appointment.name)}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {displayText(serviceLabels[appointment.serviceType] || appointment.serviceType)}
              </p>
            </div>
            <span className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', statusVisual?.color)}>
              {statusVisual?.label || appointment.status || EMPTY}
            </span>
          </div>

          <dl className="space-y-3">
            <DetailRow label="Fecha" value={schedule ? formatLongDate(schedule.date) : EMPTY} />
            <DetailRow label="Hora" value={timeRange} />
            <DetailRow label="Duración" value={durationLabel} />
            <DetailRow label="Cliente" value={displayText(clientName || appointment.name)} />
            <DetailRow label="Email" value={displayText(appointment.email)} />
            <DetailRow label="Teléfono" value={displayText(appointment.phone)} />
            <DetailRow label="Entrenador" value={displayText(trainerName)} />
            <DetailRow label="Tipo" value={displayText(appointment.sessionType || appointment.serviceType)} />
          </dl>

          <div className="mt-5">
            <p className="mb-1 text-sm text-[var(--color-text-secondary)]">Comentario</p>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-sm text-[var(--color-text-primary)]">
              {displayText(appointment.reason)}
            </p>
          </div>

          <div className="mt-5">
            <p className="mb-1 text-sm text-[var(--color-text-secondary)]">ID de cita</p>
            <p className="break-all font-mono text-xs text-[var(--color-text-secondary)]">
              {displayText(appointment.id)}
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <PremiumButton type="button" variant="ghost" size="sm" onClick={onClose}>
              Cerrar
            </PremiumButton>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
