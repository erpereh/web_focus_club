export const MAX_RECURRING_OCCURRENCES = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export function generateWeeklyOccurrenceDates(
    startDate: string,
    intervalWeeks: number,
    endDate: string,
): string[] {
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1) return [];
    if (endDate < startDate) return [];

    const dates: string[] = [];
    let current = startDate;
    while (current <= endDate) {
        dates.push(current);
        current = addUtcDays(current, intervalWeeks * 7);
    }
    return dates;
}

export function formatRecurringSeriesPreview(occurrenceCount: number, durationMinutes: number): string {
    const totalMinutes = occurrenceCount * durationMinutes;
    return `${occurrenceCount} sesiones · ${durationMinutes} min · ${totalMinutes} min en total`;
}
