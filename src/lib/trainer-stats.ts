import type { Appointment, TimeSlot } from '@/types';
import { getAppointmentEffectiveSlot, MADRID_TIME_ZONE } from './madrid-date';

export type TrainerStatsPeriod = 'current-month' | 'previous-month' | 'current-year' | 'all';

export interface TrainerStatsAppointment {
    status: Appointment['status'];
    assignedTrainer?: string;
    userId: string;
    duration: Appointment['duration'];
    approvedSlot?: TimeSlot;
    preferredSlots?: TimeSlot[];
    date?: string;
    time?: string;
}

export interface TrainerStats {
    completedMinutes: number;
    completedSessions: number;
    uniqueClients: number;
    upcomingSessions: number;
    durationDistribution: Record<30 | 45 | 60, number>;
}

interface MadridDateTimeParts {
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

function getMadridDateTimeParts(date: Date): MadridDateTimeParts {
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

function getMadridOffsetMilliseconds(timestamp: number): number {
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

function parseMadridSlot(slot: TimeSlot): MadridDateTimeParts | undefined {
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
function madridSlotToTimestamp(slot: TimeSlot): number | undefined {
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

function madridMidnightTimestamp(year: number, month: number, day = 1): number {
    const timestamp = madridSlotToTimestamp({
        date: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
        time: '00:00',
    });
    if (timestamp === undefined) {
        throw new Error('No se ha podido calcular un límite de calendario en Europe/Madrid.');
    }
    return timestamp;
}

function getCompletedPeriodRange(
    period: TrainerStatsPeriod,
    now: Date,
): { start: number; end: number } {
    const nowTimestamp = now.getTime();
    if (period === 'all') return { start: Number.NEGATIVE_INFINITY, end: nowTimestamp };

    const nowInMadrid = getMadridDateTimeParts(now);
    const currentMonthStart = madridMidnightTimestamp(nowInMadrid.year, nowInMadrid.month);

    if (period === 'current-month') {
        return { start: currentMonthStart, end: nowTimestamp };
    }
    if (period === 'current-year') {
        return { start: madridMidnightTimestamp(nowInMadrid.year, 1), end: nowTimestamp };
    }

    const previousMonth = nowInMadrid.month === 1 ? 12 : nowInMadrid.month - 1;
    const previousMonthYear = nowInMadrid.month === 1 ? nowInMadrid.year - 1 : nowInMadrid.year;
    return {
        start: madridMidnightTimestamp(previousMonthYear, previousMonth),
        end: currentMonthStart,
    };
}

export function formatTrainerDuration(totalMinutes: number): string {
    const safeMinutes = Math.max(0, Math.trunc(totalMinutes));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;

    if (hours === 0 && minutes === 0) return '0 h';
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours} h`;
    return `${hours} h ${minutes} min`;
}

export function calculateTrainerStats(
    appointments: readonly TrainerStatsAppointment[],
    trainerId: string,
    period: TrainerStatsPeriod,
    now: Date,
): TrainerStats {
    const nowTimestamp = now.getTime();
    const completedPeriod = getCompletedPeriodRange(period, now);
    const completedClients = new Set<string>();
    const result: TrainerStats = {
        completedMinutes: 0,
        completedSessions: 0,
        uniqueClients: 0,
        upcomingSessions: 0,
        durationDistribution: { 30: 0, 45: 0, 60: 0 },
    };

    for (const appointment of appointments) {
        if (appointment.status !== 'approved' || appointment.assignedTrainer !== trainerId) continue;

        const slot = getAppointmentEffectiveSlot(appointment);
        if (!slot) continue;
        const appointmentTimestamp = madridSlotToTimestamp(slot);
        if (appointmentTimestamp === undefined) continue;

        if (
            appointmentTimestamp < nowTimestamp
            && appointmentTimestamp >= completedPeriod.start
            && appointmentTimestamp < completedPeriod.end
        ) {
            const duration = Number(appointment.duration) as 30 | 45 | 60;
            result.completedMinutes += duration;
            result.completedSessions += 1;
            result.durationDistribution[duration] += 1;
            if (appointment.userId) completedClients.add(appointment.userId);
        } else if (appointmentTimestamp >= nowTimestamp) {
            result.upcomingSessions += 1;
        }
    }

    result.uniqueClients = completedClients.size;
    return result;
}
