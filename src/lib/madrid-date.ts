export const MADRID_TIME_ZONE = 'Europe/Madrid';

export interface AppointmentSlotLike {
    date?: string;
    time?: string;
}

export interface EffectiveAppointmentSlot {
    date: string;
    time: string;
}

export interface AppointmentEffectiveDateSource {
    approvedSlot?: AppointmentSlotLike | null;
    preferredSlots?: AppointmentSlotLike[];
    date?: string;
    time?: string;
    status?: string;
    recurrenceSeriesId?: string;
}

/** Calendar day in Europe/Madrid. Formats `now` only; appointment dateKeys stay YYYY-MM-DD strings. */
export function getMadridDateKey(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: MADRID_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
        throw new Error('No se ha podido calcular la fecha en Europe/Madrid.');
    }
    return `${year}-${month}-${day}`;
}

export function isSameDayInMadrid(dateKey: string, now: Date): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey === getMadridDateKey(now);
}

export interface MadridCivilSlotState {
    isValid: boolean;
    isToday: boolean;
    isPast: boolean;
    isFuture: boolean;
}

function getMadridTimeKey(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: MADRID_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    if (!hour || !minute) throw new Error('No se ha podido calcular la hora en Europe/Madrid.');
    return `${hour}:${minute}`;
}

export function classifyMadridCivilSlot(slot: AppointmentSlotLike, now: Date): MadridCivilSlotState {
    const date = slot.date ?? '';
    const time = slot.time ?? '';
    const [year, month, day] = date.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
        && parsedDate.getUTCFullYear() === year
        && parsedDate.getUTCMonth() === month - 1
        && parsedDate.getUTCDate() === day;
    if (!validDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return { isValid: false, isToday: false, isPast: false, isFuture: false };
    }
    const today = getMadridDateKey(now);
    const isToday = isSameDayInMadrid(date, now);
    const isFuture = date > today || (isToday && time > getMadridTimeKey(now));
    return { isValid: true, isToday, isPast: !isFuture, isFuture };
}

function isEffectiveSlot(value: AppointmentSlotLike | null | undefined): value is EffectiveAppointmentSlot {
    return Boolean(
        value
        && typeof value.date === 'string'
        && typeof value.time === 'string'
        && value.date.length > 0
        && value.time.length > 0,
    );
}

/**
 * Canonical appointment date/time (same rule as the server and the app):
 * `pending` → first preferred slot, else legacy date/time, else a leftover
 * approvedSlot; any other status → approvedSlot, preferred slot, legacy.
 */
export function getAppointmentEffectiveSlot(
    appointment: AppointmentEffectiveDateSource,
): EffectiveAppointmentSlot | undefined {
    const legacy = appointment.date && appointment.time
        ? { date: appointment.date, time: appointment.time }
        : undefined;
    const preferred = appointment.preferredSlots?.[0];
    const candidates = appointment.status === 'pending'
        ? [preferred, legacy, appointment.approvedSlot]
        : [appointment.approvedSlot, preferred, legacy];
    const slot = candidates.find((candidate) => isEffectiveSlot(candidate));
    return slot && isEffectiveSlot(slot) ? { date: slot.date, time: slot.time } : undefined;
}

export function isSameDayAppointment(appointment: AppointmentEffectiveDateSource, now: Date): boolean {
    const slot = getAppointmentEffectiveSlot(appointment);
    return Boolean(slot && isSameDayInMadrid(slot.date, now));
}

export function pendingSeriesHasSameDayOccurrence(
    appointments: AppointmentEffectiveDateSource[],
    seriesId: string,
    now: Date,
): boolean {
    return appointments.some((item) =>
        item.recurrenceSeriesId === seriesId
        && item.status === 'pending'
        && isSameDayAppointment(item, now),
    );
}

// Wall-clock <-> instant conversions shared by the trainer stats and the statistics page.

export interface MadridDateTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const madridDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

export function getMadridDateTimeParts(date: Date): MadridDateTimeParts {
    const values = new Map(
        madridDateTimeFormatter
            .formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)]),
    );

    return {
        year: values.get('year') ?? Number.NaN,
        month: values.get('month') ?? Number.NaN,
        day: values.get('day') ?? Number.NaN,
        hour: values.get('hour') ?? Number.NaN,
        minute: values.get('minute') ?? Number.NaN,
        second: values.get('second') ?? Number.NaN,
    };
}

function sameDateTime(left: MadridDateTimeParts, right: MadridDateTimeParts): boolean {
    return left.year === right.year
        && left.month === right.month
        && left.day === right.day
        && left.hour === right.hour
        && left.minute === right.minute
        && left.second === right.second;
}

export function getMadridOffsetMilliseconds(timestamp: number): number {
    const instant = new Date(timestamp);
    const parts = getMadridDateTimeParts(instant);
    return Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
    ) - timestamp;
}

function parseMadridSlot(slot: EffectiveAppointmentSlot): MadridDateTimeParts | undefined {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.date);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(slot.time);
    if (!dateMatch || !timeMatch) return undefined;

    const parts: MadridDateTimeParts = {
        year: Number(dateMatch[1]),
        month: Number(dateMatch[2]),
        day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
        second: 0,
    };
    const validationDate = new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
    ));

    if (
        validationDate.getUTCFullYear() !== parts.year
        || validationDate.getUTCMonth() + 1 !== parts.month
        || validationDate.getUTCDate() !== parts.day
        || validationDate.getUTCHours() !== parts.hour
        || validationDate.getUTCMinutes() !== parts.minute
    ) {
        return undefined;
    }

    return parts;
}

/** Converts a Madrid wall-clock time to UTC, choosing the first instant when DST repeats an hour. */
export function madridSlotToTimestamp(slot: EffectiveAppointmentSlot): number | undefined {
    const target = parseMadridSlot(slot);
    if (!target) return undefined;

    const wallClockAsUtc = Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour,
        target.minute,
        target.second,
    );
    const sampleDistance = 36 * 60 * 60 * 1000;
    const offsets = new Set([
        getMadridOffsetMilliseconds(wallClockAsUtc - sampleDistance),
        getMadridOffsetMilliseconds(wallClockAsUtc),
        getMadridOffsetMilliseconds(wallClockAsUtc + sampleDistance),
    ]);

    const candidates = [...offsets]
        .map((offset) => wallClockAsUtc - offset)
        .filter((timestamp) => sameDateTime(getMadridDateTimeParts(new Date(timestamp)), target))
        .sort((left, right) => left - right);

    return candidates[0];
}

export function madridMidnightTimestamp(year: number, month: number, day = 1): number {
    const timestamp = madridSlotToTimestamp({
        date: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
        time: '00:00',
    });
    if (timestamp === undefined) {
        throw new Error('No se ha podido calcular un límite de calendario en Europe/Madrid.');
    }
    return timestamp;
}
