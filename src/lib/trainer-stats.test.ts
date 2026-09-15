import { describe, expect, it } from 'vitest';
import {
    calculateTrainerStats,
    formatTrainerDuration,
    type TrainerStatsAppointment,
} from './trainer-stats';

function appointment(
    overrides: Partial<TrainerStatsAppointment> = {},
): TrainerStatsAppointment {
    return {
        status: 'approved',
        assignedTrainer: 'trainer-1',
        userId: 'client-1',
        duration: '60',
        approvedSlot: { date: '2026-09-15', time: '11:00' },
        preferredSlots: [],
        ...overrides,
    };
}

describe('calculateTrainerStats', () => {
    it('counts only approved appointments assigned to the trainer that started before now', () => {
        const now = new Date('2026-09-15T10:00:00.000Z'); // 12:00 in Madrid (CEST)
        const appointments = [
            appointment(),
            appointment({ approvedSlot: { date: '2026-09-15', time: '12:00' } }),
            appointment({ status: 'pending' }),
            appointment({ assignedTrainer: 'trainer-2' }),
        ];

        expect(calculateTrainerStats(appointments, 'trainer-1', 'all', now)).toEqual({
            completedMinutes: 60,
            completedSessions: 1,
            uniqueClients: 1,
            upcomingSessions: 1,
            durationDistribution: { 30: 0, 45: 0, 60: 1 },
        });
    });

    it('uses Madrid calendar boundaries for the current month', () => {
        const now = new Date('2026-03-15T11:00:00.000Z'); // 12:00 CET

        const stats = calculateTrainerStats([
            appointment({ userId: 'march-start', approvedSlot: { date: '2026-03-01', time: '00:00' } }),
            appointment({ userId: 'february-end', approvedSlot: { date: '2026-02-28', time: '23:59' } }),
        ], 'trainer-1', 'current-month', now);

        expect(stats.completedSessions).toBe(1);
        expect(stats.uniqueClients).toBe(1);
    });

    it('uses the complete previous calendar month in Madrid across a year boundary', () => {
        const now = new Date('2026-01-15T11:00:00.000Z'); // 12:00 CET

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: { date: '2025-12-01', time: '00:00' } }),
            appointment({ approvedSlot: { date: '2025-12-31', time: '23:59' } }),
            appointment({ approvedSlot: { date: '2025-11-30', time: '23:59' } }),
            appointment({ approvedSlot: { date: '2026-01-01', time: '00:00' } }),
        ], 'trainer-1', 'previous-month', now);

        expect(stats.completedSessions).toBe(2);
    });

    it('starts the current year at midnight in Madrid', () => {
        const now = new Date('2026-09-15T10:00:00.000Z');

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: { date: '2026-01-01', time: '00:00' } }),
            appointment({ approvedSlot: { date: '2025-12-31', time: '23:59' } }),
        ], 'trainer-1', 'current-year', now);

        expect(stats.completedSessions).toBe(1);
    });

    it('keeps upcoming appointments independent from the selected period and uses an inclusive 168-hour window', () => {
        const now = new Date('2026-10-20T10:00:00.000Z'); // 12:00 CEST; DST ends inside the window

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: { date: '2026-10-27', time: '11:00' } }), // exactly +168 h, now CET
            appointment({ approvedSlot: { date: '2026-10-27', time: '11:01' } }),
        ], 'trainer-1', 'previous-month', now);

        expect(stats.completedSessions).toBe(0);
        expect(stats.upcomingSessions).toBe(1);
    });

    it('counts unique clients and the completed-session duration distribution', () => {
        const now = new Date('2026-09-15T10:00:00.000Z');

        const stats = calculateTrainerStats([
            appointment({ userId: 'client-1', duration: '30' }),
            appointment({ userId: 'client-1', duration: '45' }),
            appointment({ userId: 'client-2', duration: '60' }),
        ], 'trainer-1', 'all', now);

        expect(stats).toMatchObject({
            completedMinutes: 135,
            completedSessions: 3,
            uniqueClients: 2,
            durationDistribution: { 30: 1, 45: 1, 60: 1 },
        });
    });

    it('uses preferred and legacy slots when no approved slot exists', () => {
        const now = new Date('2026-09-15T10:00:00.000Z');

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: undefined, preferredSlots: [{ date: '2026-09-15', time: '10:00' }] }),
            appointment({
                approvedSlot: undefined,
                preferredSlots: [],
                date: '2026-09-15',
                time: '10:30',
            }),
            appointment({ approvedSlot: { date: 'not-a-date', time: '10:00' } }),
        ], 'trainer-1', 'all', now);

        expect(stats.completedSessions).toBe(2);
    });

    it('ignores nonexistent Madrid wall-clock times during the spring DST jump', () => {
        const now = new Date('2026-03-29T01:00:00.000Z'); // 03:00 CEST

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: { date: '2026-03-29', time: '01:59' } }),
            appointment({ approvedSlot: { date: '2026-03-29', time: '02:30' } }),
            appointment({ approvedSlot: { date: '2026-03-29', time: '03:00' } }),
        ], 'trainer-1', 'all', now);

        expect(stats.completedSessions).toBe(1);
        expect(stats.upcomingSessions).toBe(1);
    });

    it('chooses the first occurrence of a repeated Madrid time during the autumn DST change', () => {
        const now = new Date('2026-10-25T01:00:00.000Z'); // 02:00 CET, after the repeated-hour transition

        const stats = calculateTrainerStats([
            appointment({ approvedSlot: { date: '2026-10-25', time: '02:30' } }),
        ], 'trainer-1', 'all', now);

        expect(stats.completedSessions).toBe(1);
        expect(stats.upcomingSessions).toBe(0);
    });
});

describe('formatTrainerDuration', () => {
    it.each([
        [0, '0 h'],
        [45, '45 min'],
        [840, '14 h'],
        [1245, '20 h 45 min'],
        [1710, '28 h 30 min'],
    ])('formats %i minutes as %s', (minutes, expected) => {
        expect(formatTrainerDuration(minutes)).toBe(expected);
    });
});
