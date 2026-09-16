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

/** Canonical appointment date/time: approvedSlot, else first preferred slot, else legacy date/time. */
export function getAppointmentEffectiveSlot(
    appointment: AppointmentEffectiveDateSource,
): EffectiveAppointmentSlot | undefined {
    const legacy = appointment.date && appointment.time
        ? { date: appointment.date, time: appointment.time }
        : undefined;
    const slot = appointment.approvedSlot ?? appointment.preferredSlots?.[0] ?? legacy;
    return isEffectiveSlot(slot) ? { date: slot.date, time: slot.time } : undefined;
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
