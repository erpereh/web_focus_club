export const MAX_RECURRING_OCCURRENCES = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RecurringEndDateOption {
    endDate: string;
    occurrenceCount: number;
    totalMinutes: number;
}

function isIsoDate(value: string): boolean {
    if (!ISO_DATE_RE.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function addUtcDays(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
}

function civilDateFromExpiration(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (isIsoDate(value)) return value;
    const expiration = new Date(value);
    if (Number.isNaN(expiration.getTime())) return undefined;
    const utc = new Date(Date.UTC(expiration.getFullYear(), expiration.getMonth(), expiration.getDate()));
    return utc.toISOString().slice(0, 10);
}

export function generateRecurringOccurrenceDates(
    startDate: string,
    intervalDays: number,
    endDate: string,
): string[] {
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
    if (!Number.isInteger(intervalDays) || intervalDays < 1) return [];
    if (endDate < startDate) return [];

    const dates: string[] = [];
    let current = startDate;
    while (current <= endDate) {
        dates.push(current);
        current = addUtcDays(current, intervalDays);
    }
    return dates;
}

export function getRecurringEndDateOptions(input: {
    startDate: string;
    intervalDays: number;
    durationMinutes: number;
    remainingMinutes: number;
    bonoExpirationDate?: string | null;
    maxOccurrences?: number;
}): RecurringEndDateOption[] {
    if (!isIsoDate(input.startDate)) return [];
    if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1) return [];
    if (![30, 45, 60].includes(input.durationMinutes) || input.durationMinutes <= 0) return [];

    const maxByMinutes = Math.floor(Math.max(0, input.remainingMinutes) / input.durationMinutes);
    const maxOccurrences = Math.min(
        input.maxOccurrences ?? MAX_RECURRING_OCCURRENCES,
        MAX_RECURRING_OCCURRENCES,
        maxByMinutes,
    );
    if (maxOccurrences < 2) return [];

    const expirationDate = input.bonoExpirationDate ? civilDateFromExpiration(input.bonoExpirationDate) : undefined;
    const options: RecurringEndDateOption[] = [];
    let current = input.startDate;
    for (let index = 0; index < maxOccurrences; index += 1) {
        if (expirationDate && current > expirationDate) break;
        if (index >= 1) {
            options.push({
                endDate: current,
                occurrenceCount: index + 1,
                totalMinutes: (index + 1) * input.durationMinutes,
            });
        }
        current = addUtcDays(current, input.intervalDays);
    }
    return options;
}

export function formatRecurringSeriesPreview(occurrenceCount: number, durationMinutes: number): string {
    const totalMinutes = occurrenceCount * durationMinutes;
    return `${occurrenceCount} sesiones · ${durationMinutes} min · ${totalMinutes} min en total`;
}


export function formatRecurringHastaOptionLabel(option: RecurringEndDateOption): string {
    const [year, month, day] = option.endDate.split('-');
    return `${day}/${month}/${year} · ${option.occurrenceCount} sesiones · ${option.totalMinutes} min`;
}

export type RecurringHastaEmptyReason = 'no-start-date' | 'no-valid-end';

export function getRecurringHastaViewModel(input: {
    startDate?: string | null;
    intervalDays: number;
    durationMinutes: number;
    remainingMinutes: number;
    bonoExpirationDate?: string | null;
}): {
    startDate: string | null;
    options: RecurringEndDateOption[];
    emptyReason: RecurringHastaEmptyReason | null;
} {
    const startDate = input.startDate && isIsoDate(input.startDate) ? input.startDate : null;
    if (!startDate) {
        return { startDate: null, options: [], emptyReason: 'no-start-date' };
    }
    const options = getRecurringEndDateOptions({
        startDate,
        intervalDays: input.intervalDays,
        durationMinutes: input.durationMinutes,
        remainingMinutes: input.remainingMinutes,
        bonoExpirationDate: input.bonoExpirationDate,
    });
    return {
        startDate,
        options,
        emptyReason: options.length === 0 ? 'no-valid-end' : null,
    };
}

export function sanitizeRecurringEndDate(
    selectedEndDate: string | null | undefined,
    options: RecurringEndDateOption[],
): string {
    if (!selectedEndDate) return '';
    return options.some((option) => option.endDate === selectedEndDate) ? selectedEndDate : '';
}
