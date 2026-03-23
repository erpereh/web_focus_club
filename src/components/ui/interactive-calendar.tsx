'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Clock, Users, Lock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMonthAvailability, getSiteConfig, generateTimeSlots } from '@/lib/firestore';
import type { BlockedSlot, TimeSlot, SiteConfig } from '@/types';

// ============================================
// TIPOS
// ============================================

interface SlotStatus {
  occupancy: number;       // 0, 1, o 2
  isBlocked: boolean;
  blockReason?: string;
}

interface InteractiveCalendarProps {
  /** La franja seleccionada actualmente, o null si no hay ninguna */
  selectedSlot: TimeSlot | null;
  /** Se llama cuando el usuario selecciona una franja */
  onSelectSlot: (slot: TimeSlot) => void;
  /** Se llama cuando el usuario deselecciona la franja actual */
  onClearSlot: () => void;
}

// ============================================
// CONSTANTES
// ============================================

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MAX_CAPACITY = 2;

// ============================================
// HELPERS
// ============================================

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Día de la semana (0=lun, 6=dom) para el primer día del mes */
function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(year, month - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isToday(year: number, month: number, day: number): boolean {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day;
}

function isPastDay(year: number, month: number, day: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(year, month - 1, day);
  return date < today;
}

function isPastTime(year: number, month: number, day: number, time: string): boolean {
  if (!isToday(year, month, day)) return false;
  const now = new Date();
  const [hours] = time.split(':').map(Number);
  return hours <= now.getHours();
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export function InteractiveCalendar({
  selectedSlot,
  onSelectSlot,
  onClearSlot,
}: InteractiveCalendarProps) {
  const now = new Date();
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [fullMessage, setFullMessage] = useState<string | null>(null);
  const [timeSlots, setTimeSlots] = useState<string[]>([]);

  // Set de franjas bloqueadas para lookup rápido
  const blockedSet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(blockedSlots)) {
      blockedSlots.forEach((s) => set.add(`${s.date}_${s.time}`));
    }
    return set;
  }, [blockedSlots]);

  // Cargar disponibilidad al montar y al cambiar de mes
  const loadAvailability = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMonthAvailability(currentYear, currentMonth);
      setOccupancy(data.occupancy);
      setBlockedSlots(data.blockedSlots);
    } catch (err) {
      console.error('Error cargando disponibilidad:', err);
    } finally {
      setLoading(false);
    }
  }, [currentYear, currentMonth]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  // Cargar configuración de franjas una vez al montar
  useEffect(() => {
    getSiteConfig().then((config) => {
      setTimeSlots(generateTimeSlots(config));
    });
  }, []);

  // Reset día seleccionado al cambiar de mes
  useEffect(() => {
    setSelectedDay(null);
  }, [currentMonth, currentYear]);

  // Auto-dismiss del mensaje de "sesión completa"
  useEffect(() => {
    if (fullMessage) {
      const timer = setTimeout(() => setFullMessage(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [fullMessage]);

  // Navegación de meses
  const canGoBack = currentYear > now.getFullYear() ||
    (currentYear === now.getFullYear() && currentMonth > now.getMonth() + 1);

  const goNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goPrevMonth = () => {
    if (!canGoBack) return;
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  // Datos del mes
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfWeek = getFirstDayOfWeek(currentYear, currentMonth);

  // Estado de una franja horaria específica
  function getSlotStatus(day: number, time: string): SlotStatus {
    const dateKey = formatDateKey(currentYear, currentMonth, day);
    const slotKey = `${dateKey}_${time}`;
    return {
      occupancy: occupancy[slotKey] || 0,
      isBlocked: blockedSet.has(slotKey),
    };
  }

  // Verificar si un día tiene al menos una franja disponible
  function dayHasAvailability(day: number): boolean {
    if (isPastDay(currentYear, currentMonth, day)) return false;
    return timeSlots.some((time) => {
      if (isPastTime(currentYear, currentMonth, day, time)) return false;
      const status = getSlotStatus(day, time);
      return !status.isBlocked && status.occupancy < MAX_CAPACITY;
    });
  }

  // Contar franjas con alguna reserva para el día (para indicador en la cuadrícula)
  function getDayOccupancySummary(day: number): { hasPartial: boolean; hasFull: boolean } {
    const dateKey = formatDateKey(currentYear, currentMonth, day);
    let hasPartial = false;
    let hasFull = false;
    timeSlots.forEach((time) => {
      const key = `${dateKey}_${time}`;
      const count = occupancy[key] || 0;
      if (count === 1) hasPartial = true;
      if (count >= MAX_CAPACITY) hasFull = true;
    });
    return { hasPartial, hasFull };
  }

  // Verificar si un slot es el actualmente seleccionado
  function isSlotSelected(day: number, time: string): boolean {
    if (!selectedSlot) return false;
    const dateStr = formatDateKey(currentYear, currentMonth, day);
    return selectedSlot.date === dateStr && selectedSlot.time === time;
  }

  // Manejar clic en una franja — selección única
  function handleSlotClick(time: string) {
    if (!selectedDay) return;
    const dateStr = formatDateKey(currentYear, currentMonth, selectedDay);
    const status = getSlotStatus(selectedDay, time);

    // Si está seleccionada, deseleccionar
    if (selectedSlot && selectedSlot.date === dateStr && selectedSlot.time === time) {
      onClearSlot();
      return;
    }

    // Si está llena, mostrar mensaje y no seleccionar
    if (status.occupancy >= MAX_CAPACITY) {
      setFullMessage('Esta sesión está completa');
      return;
    }

    // Si está bloqueada, no hacer nada
    if (status.isBlocked) return;

    // Seleccionar (reemplaza la anterior automáticamente)
    onSelectSlot({ date: dateStr, time });
  }

  return (
    <div className="space-y-6">
      {/* ── CALENDARIO ── */}
      <div className="glass-card rounded-2xl p-5 sm:p-6">
        {/* Cabecera: Mes/Año + Navegación */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={goPrevMonth}
            disabled={!canGoBack}
            className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
              canGoBack
                ? 'bg-emerald/10 text-ivory hover:bg-emerald/20 hover:shadow-emerald-glow'
                : 'text-muted-foreground/30 cursor-not-allowed'
            )}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <h3 className="text-lg font-bold text-ivory tracking-wide">
            {MONTH_NAMES[currentMonth - 1]} {currentYear}
          </h3>

          <button
            onClick={goNextMonth}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald/10 text-ivory hover:bg-emerald/20 hover:shadow-emerald-glow transition-all duration-200"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Nombres de días */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {DAY_NAMES.map((name) => (
            <div key={name} className="text-center text-xs font-semibold text-muted-foreground py-2 uppercase tracking-wider">
              {name}
            </div>
          ))}
        </div>

        {/* Cuadrícula de días */}
        <div className="grid grid-cols-7 gap-1">
          {/* Espacios vacíos antes del primer día */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {/* Días del mes */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const past = isPastDay(currentYear, currentMonth, day);
            const today = isToday(currentYear, currentMonth, day);
            const isSelected = selectedDay === day;
            const hasAvail = !past && dayHasAvailability(day);
            const { hasPartial, hasFull } = getDayOccupancySummary(day);

            return (
              <button
                key={day}
                disabled={past || loading}
                onClick={() => setSelectedDay(isSelected ? null : day)}
                className={cn(
                  'aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all duration-200 text-sm font-medium',
                  past && 'opacity-30 cursor-not-allowed text-muted-foreground',
                  today && !isSelected && !past && 'ring-1 ring-accent/50',
                  isSelected && 'bg-emerald/30 border border-accent text-ivory shadow-emerald-glow scale-105',
                  !past && !isSelected && hasAvail && 'text-ivory hover:bg-emerald/15 hover:scale-105 cursor-pointer',
                  !past && !isSelected && !hasAvail && 'text-muted-foreground/50 cursor-not-allowed',
                )}
              >
                <span>{day}</span>
                {!past && !loading && (hasPartial || hasFull) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {hasPartial && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    )}
                    {hasFull && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-border/50 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald/40 border border-emerald/60" />
            Disponible
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            Casi lleno
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            Completo
          </span>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Cargando disponibilidad...
          </div>
        )}
      </div>

      {/* ── MENSAJE DE SESIÓN COMPLETA ── */}
      <AnimatePresence>
        {fullMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {fullMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FRANJAS HORARIAS DEL DÍA SELECCIONADO ── */}
      <AnimatePresence mode="wait">
        {selectedDay && !isPastDay(currentYear, currentMonth, selectedDay) && (
          <motion.div
            key={`slots-${currentYear}-${currentMonth}-${selectedDay}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="glass-card rounded-2xl p-5 sm:p-6"
          >
            <div className="flex items-center gap-3 mb-5">
              <Clock className="w-5 h-5 text-accent" />
              <h4 className="font-bold text-ivory">
                {new Date(currentYear, currentMonth - 1, selectedDay).toLocaleDateString('es-ES', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </h4>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
              {timeSlots.map((time) => {
                const past = isPastTime(currentYear, currentMonth, selectedDay, time);
                const status = getSlotStatus(selectedDay, time);
                const selected = isSlotSelected(selectedDay, time);
                const isFull = status.occupancy >= MAX_CAPACITY;
                const isPartial = status.occupancy === 1;
                const disabled = past || status.isBlocked;

                return (
                  <button
                    key={time}
                    disabled={disabled}
                    onClick={() => handleSlotClick(time)}
                    className={cn(
                      'relative py-3 px-2 rounded-xl text-sm font-medium transition-all duration-200 border',
                      // Pasado
                      past && 'opacity-25 cursor-not-allowed border-transparent text-muted-foreground',
                      // Bloqueado por admin
                      !past && status.isBlocked && 'bg-muted/20 border-border/50 text-muted-foreground/50 cursor-not-allowed',
                      // Lleno (2/2) — clicable para mostrar mensaje, pero estilizado como lleno
                      !past && !status.isBlocked && isFull && !selected && 'bg-red-500/10 border-red-500/30 text-red-400/70 cursor-pointer',
                      // Parcial (1/2) — disponible
                      !past && !status.isBlocked && isPartial && !selected &&
                        'bg-amber-400/10 border-amber-400/30 text-amber-300 hover:bg-amber-400/20 hover:border-amber-400/50 hover:shadow-[0_0_10px_rgba(251,191,36,0.15)]',
                      // Libre (0/2) — disponible
                      !past && !status.isBlocked && !isFull && !isPartial && !selected &&
                        'bg-emerald/5 border-border/60 text-ivory hover:bg-emerald/15 hover:border-accent/50 hover:shadow-emerald-glow',
                      // Seleccionado por el usuario
                      selected && 'bg-accent/25 border-accent text-ivory shadow-emerald-glow ring-1 ring-accent/30',
                    )}
                  >
                    <span className="block">{time}</span>

                    {/* Indicadores de estado */}
                    {!past && status.isBlocked && (
                      <Lock className="w-3 h-3 mx-auto mt-1 text-muted-foreground/40" />
                    )}
                    {!past && !status.isBlocked && isFull && !selected && (
                      <span className="block text-[10px] mt-0.5 text-red-400/60">Completo</span>
                    )}
                    {!past && !status.isBlocked && isPartial && !selected && (
                      <span className="flex items-center justify-center gap-0.5 text-[10px] mt-0.5 text-amber-400/80">
                        <Users className="w-2.5 h-2.5" />
                        1 plaza
                      </span>
                    )}
                    {selected && (
                      <span className="block text-[10px] mt-0.5 text-accent font-semibold">Elegida</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FRANJA SELECCIONADA ── */}
      <AnimatePresence>
        {selectedSlot && (
          <motion.div
            key={`${selectedSlot.date}_${selectedSlot.time}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            className="flex items-center justify-between p-3.5 rounded-xl bg-emerald/10 border border-emerald/20"
          >
            <span className="text-ivory font-medium text-sm">
              {new Date(selectedSlot.date + 'T00:00:00').toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })} a las {selectedSlot.time}
            </span>
            <button
              onClick={onClearSlot}
              className="w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <span className="text-lg leading-none">&times;</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
