/** Display helpers for the admin availability tab. Dates are YYYY-MM-DD strings. */

interface Dated {
    date: string;
}

export function isUpcomingDate(date: string, todayKey: string): boolean {
    return date >= todayKey;
}

/** Blocked slots from today (inclusive) onwards. */
export function countUpcomingBlockedSlots(slots: Dated[], todayKey: string): number {
    return slots.filter((slot) => isUpcomingDate(slot.date, todayKey)).length;
}

/** Splits day keys into upcoming (ascending) and past (most recent first). */
export function splitBlockedDaysByToday(dayKeys: string[], todayKey: string): { upcoming: string[]; past: string[] } {
    const sorted = [...new Set(dayKeys)].sort();
    return {
        upcoming: sorted.filter((day) => isUpcomingDate(day, todayKey)),
        past: sorted.filter((day) => !isUpcomingDate(day, todayKey)).reverse(),
    };
}
