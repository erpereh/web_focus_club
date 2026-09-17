'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Clock, Lock, Users } from 'lucide-react';
import { getSlotAvailability, type SlotAvailabilityResult } from '@/lib/appointment-slots';
import { classifyMadridCivilSlot, getMadridDateKey } from '@/lib/madrid-date';
import {
  generateTimeSlots,
  subscribeMonthAvailability,
  subscribeSiteConfig,
} from '@/lib/firestore';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-config';
import { cn } from '@/lib/utils';
import type { BlockedSlot, SiteConfig, TimeSlot } from '@/types';

export type CalendarAvailabilityState =
  | { status: 'loading'; message: null }
  | { status: 'ready'; message: null }
  | { status: 'error'; message: string };

export interface InteractiveCalendarProps {
  selectedSlot: TimeSlot | null;
  onSelectSlot: (slot: TimeSlot) => void;
  onClearSlot: () => void;
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
  selectedDuration?: 30 | 45 | 60;
  userBookedSlotKeys?: Set<string>;
  minDate?: string;
  occupancyCreditsByKey?: Map<string, number>;
  /** Allows Admin historical corrections while keeping Portal defaults unchanged. */
  allowPastDates?: boolean;
  disabled?: boolean;
  showSelectedSlotSummary?: boolean;
  availabilityLabelMode?: 'remaining' | 'occupancy';
  onAvailabilityStateChange?: (state: CalendarAvailabilityState) => void;
}

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const AVAILABILITY_ERROR = 'No se pudo cargar la disponibilidad. Inténtalo de nuevo.';

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatCivilDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...options,
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function InteractiveCalendar({
  selectedSlot,
  onSelectSlot,
  onClearSlot,
  selectedDate,
  onSelectDate,
  selectedDuration = 60,
  userBookedSlotKeys,
  minDate,
  occupancyCreditsByKey,
  allowPastDates = false,
  disabled = false,
  showSelectedSlotSummary = true,
  availabilityLabelMode = 'remaining',
  onAvailabilityStateChange,
}: InteractiveCalendarProps) {
  const clearSlotRef = useRef(onClearSlot);
  const todayKey = getMadridDateKey(new Date());
  const [initialYear, initialMonth] = todayKey.split('-').map(Number);
  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const [monthAvailability, setMonthAvailability] = useState<{
    monthKey: string;
    occupancy: Record<string, number>;
    blockedSlots: BlockedSlot[];
    error: boolean;
  }>({ monthKey: '', occupancy: {}, blockedSlots: [], error: false });
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const monthLoading = monthAvailability.monthKey !== currentMonthKey;
  const monthError = !monthLoading && monthAvailability.error;
  const occupancy = monthLoading ? {} : monthAvailability.occupancy;
  const blockedSlots = monthLoading ? [] : monthAvailability.blockedSlots;

  const availabilityState: CalendarAvailabilityState = monthError || configError
    ? { status: 'error', message: AVAILABILITY_ERROR }
    : monthLoading || configLoading
      ? { status: 'loading', message: null }
      : { status: 'ready', message: null };

  const timeSlots = useMemo(
    () => generateTimeSlots(siteConfig, selectedDuration),
    [selectedDuration, siteConfig],
  );
  const blockedSlotKeys = useMemo(
    () => new Set(blockedSlots.map((slot) => `${slot.date}_${slot.time}`)),
    [blockedSlots],
  );

  useEffect(() => {
    clearSlotRef.current = onClearSlot;
  }, [onClearSlot]);

  useEffect(() => {
    return subscribeMonthAvailability(
      currentYear,
      currentMonth,
      (data) => {
        setMonthAvailability({
          monthKey: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
          occupancy: data.occupancy,
          blockedSlots: data.blockedSlots,
          error: false,
        });
      },
      (error) => {
        console.error('Error cargando disponibilidad:', error);
        setMonthAvailability({
          monthKey: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
          occupancy: {},
          blockedSlots: [],
          error: true,
        });
        clearSlotRef.current();
      },
    );
  }, [currentMonth, currentYear]);

  useEffect(() => subscribeSiteConfig(
    (config) => {
      setSiteConfig(config);
      setConfigLoading(false);
      setConfigError(false);
    },
    (error) => {
      console.error('Error cargando configuración de franjas:', error);
      setConfigLoading(false);
      setConfigError(true);
      clearSlotRef.current();
    },
  ), []);

  useEffect(() => {
    onAvailabilityStateChange?.(availabilityState);
  }, [availabilityState.status, onAvailabilityStateChange]);

  const clearSelection = () => {
    setSelectedDay(null);
    onSelectDate?.(null);
    onClearSlot();
  };

  const todayMonthKey = todayKey.slice(0, 7);
  const canGoBack = allowPastDates || currentMonthKey > todayMonthKey;
  const calendarDisabled = disabled || availabilityState.status !== 'ready';

  const goNextMonth = () => {
    clearSelection();
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((year) => year + 1);
      return;
    }
    setCurrentMonth((month) => month + 1);
  };

  const goPrevMonth = () => {
    if (!canGoBack) return;
    clearSelection();
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((year) => year - 1);
      return;
    }
    setCurrentMonth((month) => month - 1);
  };

  const getAvailability = (day: number, time: string): SlotAvailabilityResult => getSlotAvailability({
    slot: { date: formatDateKey(currentYear, currentMonth, day), time },
    durationMinutes: selectedDuration,
    occupancy,
    blockedSlotKeys,
    userBookedSlotKeys,
    occupancyCreditsByKey,
    maxCapacity: siteConfig.maxCapacity,
  });

  const isHistoricalSlot = (day: number, time: string): boolean => !classifyMadridCivilSlot({
    date: formatDateKey(currentYear, currentMonth, day),
    time,
  }, new Date()).isFuture;

  const getDisplayAvailability = (day: number, time: string): SlotAvailabilityResult => {
    const availability = getAvailability(day, time);
    if (allowPastDates && isHistoricalSlot(day, time)) {
      return { disabled: false, reason: null, occupancy: 0 };
    }
    return availability;
  };

  const isPastDay = (day: number): boolean => formatDateKey(currentYear, currentMonth, day) < todayKey;
  const isPastTime = (day: number, time: string): boolean => !classifyMadridCivilSlot({
    date: formatDateKey(currentYear, currentMonth, day),
    time,
  }, new Date()).isFuture;

  const dayHasAvailability = (day: number): boolean => {
    const dateKey = formatDateKey(currentYear, currentMonth, day);
    if ((!allowPastDates && dateKey < todayKey) || (minDate && dateKey < minDate) || availabilityState.status !== 'ready') return false;
    return timeSlots.some((time) => (allowPastDates || !isPastTime(day, time)) && !getDisplayAvailability(day, time).disabled);
  };

  const getDayOccupancySummary = (day: number): { hasPartial: boolean; hasFull: boolean } => {
    let hasPartial = false;
    let hasFull = false;
    timeSlots.forEach((time) => {
      const result = getDisplayAvailability(day, time);
      if (result.reason === 'slot_full') hasFull = true;
      if (!result.disabled && result.occupancy > 0) hasPartial = true;
    });
    return { hasPartial, hasFull };
  };

  const handleDateClick = (day: number, isSelected: boolean) => {
    const nextDay = isSelected ? null : day;
    if (selectedSlot) onClearSlot();
    setSelectedDay(nextDay);
    onSelectDate?.(nextDay ? formatDateKey(currentYear, currentMonth, nextDay) : null);
  };

  const handleSlotClick = (time: string) => {
    if (!selectedDay || calendarDisabled) return;
    const date = formatDateKey(currentYear, currentMonth, selectedDay);
    const result = getDisplayAvailability(selectedDay, time);
    if ((!allowPastDates && isPastTime(selectedDay, time)) || result.disabled) return;
    if (selectedSlot?.date === date && selectedSlot.time === time) {
      onClearSlot();
      return;
    }
    onSelectSlot({ date, time });
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfWeek = getFirstDayOfWeek(currentYear, currentMonth);

  return (
    <div className="space-y-5">
      <div className="glass-card rounded-2xl border border-white/5 p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={goPrevMonth}
            disabled={!canGoBack || disabled}
            aria-label="Mes anterior"
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]',
              canGoBack && !disabled
                ? 'bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] hover:shadow-emerald-glow'
                : 'cursor-not-allowed text-[var(--color-text-secondary)]/30',
            )}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--color-accent-val)]">Nueva fecha</p>
            <h3 className="mt-1 text-lg font-bold tracking-wide text-[var(--color-text-primary)]">
              {MONTH_NAMES[currentMonth - 1]} {currentYear}
            </h3>
          </div>

          <button
            type="button"
            onClick={goNextMonth}
            disabled={disabled}
            aria-label="Mes siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-dim)] text-[var(--color-text-primary)] transition hover:shadow-emerald-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1">
          {DAY_NAMES.map((name) => (
            <div key={name} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">{name}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfWeek }).map((_, index) => (
            <div key={`empty-${index}`} className="aspect-square" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, index) => {
            const day = index + 1;
            const dateKey = formatDateKey(currentYear, currentMonth, day);
            const past = (!allowPastDates && isPastDay(day)) || Boolean(minDate && dateKey < minDate);
            const isToday = dateKey === todayKey;
            const isSelected = selectedDate ? selectedDate === dateKey : selectedDay === day;
            const hasAvailability = !past && dayHasAvailability(day);
            const summary = getDayOccupancySummary(day);

            return (
              <button
                key={day}
                type="button"
                disabled={past || calendarDisabled}
                onClick={() => handleDateClick(day, isSelected)}
                aria-label={`${day} de ${MONTH_NAMES[currentMonth - 1]}${hasAvailability ? ', con disponibilidad' : ''}`}
                aria-pressed={isSelected}
                className={cn(
                  'relative flex aspect-square items-center justify-center rounded-xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]',
                  past && 'cursor-not-allowed text-[var(--color-text-secondary)] opacity-25',
                  calendarDisabled && !past && 'cursor-wait text-[var(--color-text-secondary)] opacity-35',
                  isToday && !isSelected && !past && 'ring-1 ring-[var(--color-accent-border)]',
                  isSelected && 'scale-105 border border-[var(--color-accent-border)] bg-[var(--color-accent-val)]/20 text-[var(--color-text-primary)] shadow-emerald-glow',
                  !past && !calendarDisabled && !isSelected && hasAvailability && 'text-[var(--color-text-primary)] hover:bg-[var(--color-accent-val)]/10',
                  !past && !calendarDisabled && !isSelected && !hasAvailability && 'text-[var(--color-text-secondary)]/60 hover:bg-white/5',
                )}
              >
                <span>{day}</span>
                {!past && availabilityState.status === 'ready' && (summary.hasPartial || summary.hasFull) && (
                  <span className="absolute bottom-1.5 flex gap-1" aria-hidden="true">
                    {summary.hasPartial && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
                    {summary.hasFull && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/50 pt-4 text-xs text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-[var(--color-accent-val)]/60 bg-[var(--color-accent-val)]/40" />Disponible</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Con ocupación</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Completo</span>
        </div>

        {availabilityState.status === 'loading' && (
          <div role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent-border)] border-t-[var(--color-accent-val)]" />
            Cargando disponibilidad...
          </div>
        )}
        {availabilityState.status === 'error' && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {availabilityState.message}
          </div>
        )}
      </div>

      {selectedDay && (allowPastDates || !isPastDay(selectedDay)) && availabilityState.status === 'ready' && (
          <motion.div
            key={`slots-${currentYear}-${currentMonth}-${selectedDay}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="glass-card rounded-2xl border border-white/5 p-4 sm:p-6"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-dim)]">
                <Clock className="h-4 w-4 text-[var(--color-accent-val)]" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">Horarios disponibles</p>
                <h4 className="mt-0.5 font-bold capitalize text-[var(--color-text-primary)]">
                  {formatCivilDate(formatDateKey(currentYear, currentMonth, selectedDay), { weekday: 'long' })}
                </h4>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {timeSlots.map((time) => {
                const past = isPastTime(selectedDay, time);
                const availability = getDisplayAvailability(selectedDay, time);
                const date = formatDateKey(currentYear, currentMonth, selectedDay);
                const selected = selectedSlot?.date === date && selectedSlot.time === time;
                const isBlocked = availability.reason === 'slot_blocked';
                const isConflict = availability.reason === 'appointment_conflict';
                const isFull = availability.reason === 'slot_full';
                const isPartial = !availability.disabled && availability.occupancy > 0;
                const unavailable = disabled || (!allowPastDates && past) || availability.disabled;
                const remaining = Math.max(0, siteConfig.maxCapacity - availability.occupancy);
                const availabilityLabel = (!allowPastDates && past) || isConflict
                  ? 'No disponible'
                  : isBlocked
                    ? 'Bloqueada'
                    : isFull
                      ? 'Completa'
                      : availability.occupancy === 0
                        ? 'Libre'
                        : availabilityLabelMode === 'occupancy'
                          ? `${availability.occupancy}/${siteConfig.maxCapacity} plazas`
                          : remaining === 1 ? '1 plaza' : `${remaining} plazas`;

                return (
                  <button
                    key={time}
                    type="button"
                    disabled={unavailable}
                    onClick={() => handleSlotClick(time)}
                    aria-label={`${time}, ${availabilityLabel}`}
                    aria-pressed={selected}
                    className={cn(
                      'relative min-h-16 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]',
                      unavailable && 'cursor-not-allowed opacity-45',
                      isBlocked && 'border-border/60 bg-muted/20 text-[var(--color-text-secondary)]',
                      isConflict && 'border-blue-500/30 bg-blue-500/10 text-blue-300',
                      isFull && 'border-red-500/30 bg-red-500/10 text-red-300',
                      isPartial && !selected && 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:border-amber-400/60 hover:bg-amber-400/15',
                      !unavailable && !isPartial && !selected && 'border-[var(--color-border-base)] bg-[var(--color-accent-val)]/5 text-[var(--color-text-primary)] hover:border-[var(--color-accent-border)] hover:bg-[var(--color-accent-val)]/10',
                      selected && 'border-[var(--color-accent-val)] bg-[var(--color-accent-val)]/20 text-[var(--color-text-primary)] shadow-emerald-glow ring-1 ring-[var(--color-accent-border)]',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-bold">
                      {time}
                      {selected && <Check className="h-4 w-4 text-[var(--color-accent-val)]" />}
                      {!selected && isBlocked && <Lock className="h-3.5 w-3.5" />}
                    </span>
                    <span className={cn('mt-1 flex items-center gap-1 text-[10px] font-semibold', selected ? 'text-[var(--color-accent-val)]' : 'opacity-80')}>
                      {isPartial && <Users className="h-3 w-3" />}
                      {selected ? 'Elegida' : availabilityLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
      )}

      <AnimatePresence>
        {showSelectedSlotSummary && selectedSlot && (
          <motion.div
            key={`${selectedSlot.date}_${selectedSlot.time}`}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="flex items-center justify-between rounded-xl border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] p-3.5"
          >
            <span className="text-sm font-medium capitalize text-[var(--color-text-primary)]">
              {formatCivilDate(selectedSlot.date, { weekday: 'long' })} a las {selectedSlot.time}
            </span>
            <button
              type="button"
              onClick={onClearSlot}
              disabled={disabled}
              aria-label="Quitar franja seleccionada"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-val)]"
            >
              <span aria-hidden="true" className="text-lg leading-none">&times;</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
