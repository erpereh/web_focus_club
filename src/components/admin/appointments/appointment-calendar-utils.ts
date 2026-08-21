export const WEEKDAY_LABELS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'] as const;

export const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export const MAX_VISIBLE_DAY_EVENTS = 3;

const DATE_KEY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME_PREFIX = /^(\d{1,2}):(\d{2})/;

export interface CalendarDay {
  date: string;
  day: number;
  year: number;
  monthIndex: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface MonthRef {
  year: number;
  monthIndex: number;
}

export interface AppointmentSlotLike {
  date?: unknown;
  time?: unknown;
}

export interface AppointmentScheduleSource {
  approvedSlot?: AppointmentSlotLike | null;
  preferredSlots?: ReadonlyArray<AppointmentSlotLike> | null;
  date?: unknown;
  time?: unknown;
  duration?: unknown;
}

export interface ResolvedAppointmentSchedule {
  date: string;
  time: string;
  durationMinutes: number | null;
  endTime: string | null;
}

export function formatDateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatMonthTitle(year: number, monthIndex: number): string {
  return `${MONTH_LABELS[monthIndex] ?? ''} ${year}`.trim();
}

export function getCurrentMonth(now: Date = new Date()): MonthRef {
  return { year: now.getFullYear(), monthIndex: now.getMonth() };
}

export function shiftMonth(year: number, monthIndex: number, delta: number): MonthRef {
  const next = new Date(year, monthIndex + delta, 1);
  return { year: next.getFullYear(), monthIndex: next.getMonth() };
}

export function parseLocalDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function formatLongDate(dateKey: string): string {
  const date = parseLocalDateKey(dateKey);
  if (!date) return '—';
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function getMonthGrid(
  year: number,
  monthIndex: number,
  today: Date = new Date(),
): CalendarDay[] {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const endOffset = (lastOfMonth.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - startOffset);
  const end = new Date(year, monthIndex, lastOfMonth.getDate() + (6 - endOffset));
  const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const days: CalendarDay[] = [];
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setDate(cursor.getDate() + 1)) {
    const cellYear = cursor.getFullYear();
    const cellMonthIndex = cursor.getMonth();
    const cellDay = cursor.getDate();
    const date = formatDateKey(cellYear, cellMonthIndex, cellDay);
    days.push({
      date,
      day: cellDay,
      year: cellYear,
      monthIndex: cellMonthIndex,
      inCurrentMonth: cellYear === year && cellMonthIndex === monthIndex,
      isToday: date === todayKey,
    });
  }

  return days;
}

export function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ymd = DATE_KEY_PREFIX.exec(trimmed);
  if (ymd) {
    const year = Number(ymd[1]);
    const monthIndex = Number(ymd[2]) - 1;
    const day = Number(ymd[3]);
    const date = new Date(year, monthIndex, day);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
      return null;
    }
    return formatDateKey(year, monthIndex, day);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateKey(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PREFIX.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseDurationMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function resolveCandidateSlot(candidate: AppointmentSlotLike | null | undefined): { date: string; time: string } | null {
  if (!candidate) return null;
  const date = normalizeDateKey(candidate.date);
  const time = normalizeTime(candidate.time);
  if (!date || !time) return null;
  return { date, time };
}

export function getAppointmentEndTime(startTime: string, durationMinutes: number): string | null {
  const time = normalizeTime(startTime);
  if (!time || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(total / 60) % 24;
  const endMinutes = total % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

export function resolveAppointmentSchedule(
  source: AppointmentScheduleSource,
): ResolvedAppointmentSchedule | null {
  const candidates: Array<AppointmentSlotLike | null | undefined> = [
    source.approvedSlot,
    source.preferredSlots?.[0],
    { date: source.date, time: source.time },
  ];

  for (const candidate of candidates) {
    const slot = resolveCandidateSlot(candidate);
    if (!slot) continue;
    const durationMinutes = parseDurationMinutes(source.duration);
    return {
      date: slot.date,
      time: slot.time,
      durationMinutes,
      endTime: durationMinutes ? getAppointmentEndTime(slot.time, durationMinutes) : null,
    };
  }

  return null;
}

export function groupAppointmentsByDay<T extends AppointmentScheduleSource>(
  appointments: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const appointment of appointments) {
    const schedule = resolveAppointmentSchedule(appointment);
    if (!schedule) continue;
    const bucket = grouped.get(schedule.date);
    if (bucket) bucket.push(appointment);
    else grouped.set(schedule.date, [appointment]);
  }

  for (const [date, items] of grouped) {
    items.sort((left, right) => {
      const timeA = resolveAppointmentSchedule(left)?.time ?? '';
      const timeB = resolveAppointmentSchedule(right)?.time ?? '';
      return timeA.localeCompare(timeB);
    });
    grouped.set(date, items);
  }

  return grouped;
}
