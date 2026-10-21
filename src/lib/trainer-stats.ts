import type { Appointment, TimeSlot } from '@/types';
import {
    getAppointmentEffectiveSlot,
    getMadridDateTimeParts,
    madridMidnightTimestamp,
    madridSlotToTimestamp,
} from './madrid-date';

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

/** Half-open range `[start, end)` of UTC timestamps. */
export interface TrainerStatsRange {
    start: number;
    end: number;
}

/**
 * "Horas contabilizadas": approved sessions of the trainer whose start is
 * already past and inside `range`. There is no attendance confirmation, and
 * cancellations (with or without charge) are never `approved`, so a charged
 * cancellation never counts as a session or an hour. Upcoming sessions are
 * counted regardless of the range.
 */
export function calculateTrainerStatsInRange(
    appointments: readonly TrainerStatsAppointment[],
    trainerId: string,
    range: TrainerStatsRange,
    now: Date,
): TrainerStats {
    const nowTimestamp = now.getTime();
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
            && appointmentTimestamp >= range.start
            && appointmentTimestamp < range.end
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

export function calculateTrainerStats(
    appointments: readonly TrainerStatsAppointment[],
    trainerId: string,
    period: TrainerStatsPeriod,
    now: Date,
): TrainerStats {
    return calculateTrainerStatsInRange(appointments, trainerId, getCompletedPeriodRange(period, now), now);
}
