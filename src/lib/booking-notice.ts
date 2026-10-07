import { MADRID_TIME_ZONE, type AppointmentSlotLike } from '@/lib/madrid-date';

/** Fixed lock the customer already has when modifying an appointment. */
export const CUSTOMER_MODIFICATION_LOCK_HOURS = 24;
export const MAX_MIN_BOOKING_NOTICE_HOURS = 720;
export const BOOKING_NOTICE_TOO_SHORT = 'booking_notice_too_short';

/** Integer hours >= 0. Missing or invalid values mean "no notice" (legacy behaviour). */
export function normalizeMinBookingNoticeHours(value: unknown): number {
    if (value == null || value === '') return 0;
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(MAX_MIN_BOOKING_NOTICE_HOURS, Math.trunc(parsed));
}

interface CivilParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const madridFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

function madridParts(instant: Date): CivilParts {
    const parts = madridFormatter.formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute'),
        second: value('second'),
    };
}

function madridOffsetMilliseconds(instant: Date): number {
    const parts = madridParts(instant);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime();
}

/**
 * Real instant of a Europe/Madrid civil slot, independent of the browser
 * timezone. Same algorithm as the Cloud Functions (DST-safe).
 */
export function madridCivilSlotToInstant(slot: AppointmentSlotLike): Date | undefined {
    const date = slot.date ?? '';
    const time = slot.time ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const civilAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
    const offsets = new Set<number>();
    [-48, -24, 0, 24, 48].forEach((hours) => {
        offsets.add(madridOffsetMilliseconds(new Date(civilAsUtc + hours * 60 * 60 * 1000)));
    });
    return [...offsets]
        .map((offset) => new Date(civilAsUtc - offset))
        .filter((candidate) => {
            const parts = madridParts(candidate);
            return parts.year === year && parts.month === month && parts.day === day
                && parts.hour === hour && parts.minute === minute && parts.second === 0;
        })
        .sort((left, right) => left.getTime() - right.getTime())[0];
}

/**
 * True when a customer may not book `slot` because it starts before
 * now + `hours` real hours. 0 hours never blocks. Invalid slots fail closed.
 */
export function isInsideBookingNotice(slot: AppointmentSlotLike, now: Date, hours: number): boolean {
    if (!Number.isFinite(hours) || hours <= 0) return false;
    const start = madridCivilSlotToInstant(slot);
    return !start || start.getTime() < now.getTime() + hours * 60 * 60 * 1000;
}

export type BookingNoticeMode = 'booking' | 'modification';

/**
 * Notice the customer calendars apply. New bookings use the configured
 * value; modifications only add it when it exceeds the existing fixed 24h
 * lock (so the target respects max(24h, notice)).
 */
export function effectiveBookingNoticeHours(configured: number, mode: BookingNoticeMode | undefined): number {
    const hours = normalizeMinBookingNoticeHours(configured);
    if (mode === 'booking') return hours;
    if (mode === 'modification') return hours > CUSTOMER_MODIFICATION_LOCK_HOURS ? hours : 0;
    return 0;
}

export function bookingNoticeMessage(hours: number): string {
    return `Las reservas deben hacerse con al menos ${hours} ${hours === 1 ? 'hora' : 'horas'} de antelación.`;
}
