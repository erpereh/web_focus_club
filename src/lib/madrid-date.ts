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
