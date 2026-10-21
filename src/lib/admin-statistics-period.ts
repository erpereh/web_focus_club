import { getMadridDateKey, madridSlotToTimestamp } from './madrid-date';

/**
 * Periods of the statistics page, in Europe/Madrid civil dates
 * (`YYYY-MM-DD`, both ends inclusive). Civil date arithmetic runs on UTC
 * dates, so daylight-saving changes never move a day; instants are only
 * computed at the edges with `madridSlotToTimestamp`.
 */
export type StatsPeriodKind = 'week' | 'month' | 'year' | 'custom';
export type StatsGranularity = 'day' | 'week' | 'month';

export interface StatsPeriod {
    kind: StatsPeriodKind;
    startKey: string;
    endKey: string;
}

export interface StatsBucket {
    key: string;
    label: string;
    startKey: string;
    endKey: string;
}

/** Longest custom period allowed: keeps the reads bounded. */
export const MAX_CUSTOM_PERIOD_DAYS = 731;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcDate(key: string): Date {
    const match = DATE_KEY.exec(key);
    if (!match) throw new Error(`Fecha no válida: ${key}`);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function fromUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function isDateKey(value: string): boolean {
    const match = DATE_KEY.exec(value);
    if (!match) return false;
    return fromUtcDate(toUtcDate(value)) === value;
}

export function addDays(key: string, days: number): string {
    const date = toUtcDate(key);
    date.setUTCDate(date.getUTCDate() + days);
    return fromUtcDate(date);
}

/** Whole days from `from` to `to` (0 when equal). */
export function daysBetween(from: string, to: string): number {
    return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(key: string): number {
    return (toUtcDate(key).getUTCDay() + 6) % 7;
}

function startOfWeek(key: string): string {
    return addDays(key, -weekdayIndex(key));
}

function startOfMonth(key: string): string {
    return `${key.slice(0, 7)}-01`;
}

function endOfMonth(key: string): string {
    const date = toUtcDate(startOfMonth(key));
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    return fromUtcDate(date);
}

function shiftMonths(key: string, months: number): string {
    const date = toUtcDate(startOfMonth(key));
    date.setUTCMonth(date.getUTCMonth() + months);
    return fromUtcDate(date);
}

/** The period of `kind` that contains `anchorKey` (custom periods are given explicitly). */
export function resolvePeriod(kind: Exclude<StatsPeriodKind, 'custom'>, anchorKey: string): StatsPeriod {
    if (kind === 'week') {
        const startKey = startOfWeek(anchorKey);
        return { kind, startKey, endKey: addDays(startKey, 6) };
    }
    if (kind === 'month') return { kind, startKey: startOfMonth(anchorKey), endKey: endOfMonth(anchorKey) };
    const year = anchorKey.slice(0, 4);
    return { kind, startKey: `${year}-01-01`, endKey: `${year}-12-31` };
}

export function currentPeriod(kind: Exclude<StatsPeriodKind, 'custom'>, now: Date): StatsPeriod {
    return resolvePeriod(kind, getMadridDateKey(now));
}

/** Validates and orders a custom range; `null` when it is not usable. */
export function customPeriod(startKey: string, endKey: string): StatsPeriod | null {
    if (!isDateKey(startKey) || !isDateKey(endKey)) return null;
    const [from, to] = startKey <= endKey ? [startKey, endKey] : [endKey, startKey];
    if (daysBetween(from, to) + 1 > MAX_CUSTOM_PERIOD_DAYS) return null;
    return { kind: 'custom', startKey: from, endKey: to };
}

export function periodLengthDays(period: StatsPeriod): number {
    return daysBetween(period.startKey, period.endKey) + 1;
}

/** Next or previous period of the same kind (custom periods move by their own length). */
export function shiftPeriod(period: StatsPeriod, direction: -1 | 1): StatsPeriod {
    if (period.kind === 'week') return resolvePeriod('week', addDays(period.startKey, 7 * direction));
    if (period.kind === 'month') return resolvePeriod('month', shiftMonths(period.startKey, direction));
    if (period.kind === 'year') return resolvePeriod('year', `${Number(period.startKey.slice(0, 4)) + direction}-01-01`);
    const length = periodLengthDays(period);
    return { kind: 'custom', startKey: addDays(period.startKey, length * direction), endKey: addDays(period.endKey, length * direction) };
}

/** The equivalent period right before (same calendar unit, or same number of days for custom). */
export function previousPeriod(period: StatsPeriod): StatsPeriod {
    return shiftPeriod(period, -1);
}

export function granularityFor(period: StatsPeriod): StatsGranularity {
    if (period.kind === 'week' || period.kind === 'month') return 'day';
    if (period.kind === 'year') return 'month';
    const days = periodLengthDays(period);
    if (days <= 45) return 'day';
    if (days <= 200) return 'week';
    return 'month';
}

export function bucketKeyOf(dateKey: string, granularity: StatsGranularity): string {
    if (granularity === 'day') return dateKey;
    if (granularity === 'week') return startOfWeek(dateKey);
    return dateKey.slice(0, 7);
}

const dayLabel = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const longMonth = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatDateKey(key: string): string {
    return longDay.format(toUtcDate(key));
}

export function formatShortDateKey(key: string): string {
    return dayLabel.format(toUtcDate(key));
}

/** Every bucket of the period, including empty ones, clipped to the period edges. */
export function bucketsFor(period: StatsPeriod, granularity: StatsGranularity): StatsBucket[] {
    const buckets: StatsBucket[] = [];
    let cursor = period.startKey;
    while (cursor <= period.endKey) {
        const key = bucketKeyOf(cursor, granularity);
        const naturalEnd = granularity === 'day'
            ? cursor
            : granularity === 'week' ? addDays(startOfWeek(cursor), 6) : endOfMonth(cursor);
        const endKey = naturalEnd > period.endKey ? period.endKey : naturalEnd;
        const label = granularity === 'month'
            ? monthLabel.format(toUtcDate(`${key}-01`))
            : dayLabel.format(toUtcDate(granularity === 'week' ? cursor : key));
        buckets.push({ key, label, startKey: cursor, endKey });
        cursor = addDays(endKey, 1);
    }
    return buckets;
}

export function periodLabel(period: StatsPeriod): string {
    if (period.kind === 'month') {
        const label = longMonth.format(toUtcDate(period.startKey));
        return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (period.kind === 'year') return period.startKey.slice(0, 4);
    const prefix = period.kind === 'week' ? 'Semana del ' : '';
    return `${prefix}${formatShortDateKey(period.startKey)} – ${formatDateKey(period.endKey)}`;
}

/** Half-open instant range `[start, end)` covering the whole period in Madrid. */
export function periodInstantRange(period: StatsPeriod): { start: number; end: number } {
    const start = madridSlotToTimestamp({ date: period.startKey, time: '00:00' });
    const end = madridSlotToTimestamp({ date: addDays(period.endKey, 1), time: '00:00' });
    if (start === undefined || end === undefined) throw new Error('No se ha podido calcular el período en Europe/Madrid.');
    return { start, end };
}

export function isDateInPeriod(dateKey: string | undefined, period: StatsPeriod): boolean {
    return Boolean(dateKey) && dateKey! >= period.startKey && dateKey! <= period.endKey;
}

/** Merges overlapping or adjacent inclusive date ranges so no document is read twice. */
export function mergeDateRanges(ranges: readonly { from: string; to: string }[]): { from: string; to: string }[] {
    const sorted = [...ranges].sort((left, right) => left.from.localeCompare(right.from));
    const merged: { from: string; to: string }[] = [];
    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (last && (last.to === '9999-12-31' || range.from <= addDays(last.to, 1))) {
            if (range.to > last.to) last.to = range.to;
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}
