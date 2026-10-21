import { describe, expect, it } from 'vitest';
import type { Appointment, Bono, SiteConfig, Trainer, UserProfile } from '@/types';
import {
    calculateStatistics,
    cancellationsCsv,
    relativeChange,
    type StatisticsInput,
    trainersCsv,
} from './admin-statistics';
import { customPeriod, previousPeriod, resolvePeriod } from './admin-statistics-period';
import { calculateTrainerStats } from './trainer-stats';

// Wednesday 21 Oct 2026, 12:00 in Madrid.
const NOW = new Date('2026-10-21T10:00:00.000Z');
const OCTOBER = resolvePeriod('month', '2026-10-01');

const trainers: Trainer[] = [
    { id: 't1', uid: 'coach-1', name: 'Ana', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 't2', uid: 'coach-2', name: 'Bea', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
];

const clients: UserProfile[] = [
    { uid: 'u1', name: 'Lucía', email: 'u1@example.com', role: 'user', createdAt: '2026-10-05T09:00:00.000Z' },
    { uid: 'u2', name: 'Pablo', email: 'u2@example.com', role: 'user', createdAt: '2026-09-10T09:00:00.000Z' },
    { uid: 'u3', name: 'Marta', email: 'u3@example.com', role: 'user', createdAt: '2026-01-01T09:00:00.000Z' },
    { uid: 'u4', name: 'Óscar', email: 'u4@example.com', role: 'user', createdAt: '2026-01-01T09:00:00.000Z' },
];

const siteConfig: SiteConfig = {
    startHour: 8, endHour: 20, slotInterval: 15, bonoExpirationMonths: 1, maxCapacity: 2,
    bonoSizesMinutes: [240], minBookingNoticeHours: 0, blockSameDayBooking: true,
};

let sequence = 0;
function appt(overrides: Partial<Appointment> & { slot?: { date: string; time: string } }): Appointment {
    const { slot, ...rest } = overrides;
    sequence += 1;
    const effective = slot ?? { date: '2026-10-05', time: '10:00' };
    return {
        id: `a${sequence}`,
        userId: 'u1',
        name: 'Cliente',
        email: '',
        phone: '',
        serviceType: 'Bono',
        duration: '60',
        preferredSlots: [effective],
        reason: '',
        status: 'approved',
        approvedSlot: effective,
        date: effective.date,
        time: effective.time,
        createdAt: '2026-09-01T00:00:00.000Z',
        ...rest,
    } as Appointment;
}

const deducted = (amount: number) => ({
    bonoId: 'b1', minutesDeducted: true, minutesDeductedAmount: amount, minutesDeductedAt: '2026-09-01T00:00:00.000Z',
});

function bono(overrides: Partial<Bono>): Bono {
    return {
        id: 'bono', userId: 'u1', tamano: 240, minutosTotales: 240, minutosRestantes: 120,
        fechaAsignacion: '2026-10-01T00:00:00.000Z', fechaExpiracion: '2026-12-31T22:59:59.000Z',
        estado: 'activo', historial: [], asignadoPor: 'admin', createdAt: '2026-10-01T00:00:00.000Z',
        ...overrides,
    };
}

function fixture(): StatisticsInput {
    sequence = 0;
    const appointments: Appointment[] = [
        appt({ assignedTrainer: 't1', userId: 'u1', slot: { date: '2026-10-05', time: '10:00' }, ...deducted(60) }),
        appt({ assignedTrainer: 't1', userId: 'u2', duration: '45', slot: { date: '2026-10-20', time: '18:00' }, ...deducted(45) }),
        appt({ assignedTrainer: 't2', userId: 'u3', duration: '30', slot: { date: '2026-10-28', time: '10:00' }, ...deducted(30) }),
        appt({
            assignedTrainer: 't1', userId: 'u1', status: 'cancelled', slot: { date: '2026-10-14', time: '18:00' }, ...deducted(60),
            cancelledBy: 'admin', cancelledAt: '2026-10-14T08:00:00.000Z', cancellationCharge: 'charged', cancellationChargedMinutes: 60,
        }),
        appt({
            assignedTrainer: 't2', userId: 'u2', status: 'cancelled', slot: { date: '2026-10-15', time: '09:00' }, ...deducted(60),
            minutesRefundedAt: '2026-10-10T00:00:00.000Z', cancelledBy: 'customer', cancellationCharge: 'not_charged', cancellationChargedMinutes: 0,
        }),
        // Historical cancellation: never classified after the fact.
        appt({ userId: 'u3', status: 'cancelled', slot: { date: '2026-10-02', time: '11:00' }, cancelledBy: 'admin' }),
        // Customer request: only preferredSlots (no top-level date until approved).
        { ...appt({ userId: 'u1', status: 'pending', slot: { date: '2026-10-25', time: '12:00' }, ...deducted(60) }), approvedSlot: undefined, date: undefined, time: undefined },
        appt({ userId: 'u2', status: 'rejected', slot: { date: '2026-10-03', time: '12:00' } }),
        // Previous month.
        appt({ assignedTrainer: 't1', userId: 'u2', slot: { date: '2026-09-10', time: '10:00' }, ...deducted(60) }),
        appt({
            assignedTrainer: 't1', userId: 'u2', status: 'cancelled', slot: { date: '2026-09-12', time: '10:00' }, ...deducted(60),
            cancellationCharge: 'charged', cancellationChargedMinutes: 60,
        }),
        appt({ assignedTrainer: 't2', userId: 'u4', slot: { date: '2026-09-01', time: '10:00' }, ...deducted(60) }),
        // Legacy approved session without minute markers.
        appt({ assignedTrainer: 't2', userId: 'u3', slot: { date: '2026-10-06', time: '10:00' } }),
        // Nutrition: counted for the professional, never minutes.
        appt({ assignedTrainer: 't2', userId: 'u1', appointmentType: 'nutrition', duration: '30', slot: { date: '2026-10-07', time: '10:00' } }),
        // Future approved without trainer.
        appt({ userId: 'u2', slot: { date: '2026-10-30', time: '18:00' } }),
    ];
    return {
        period: OCTOBER,
        previous: previousPeriod(OCTOBER),
        now: NOW,
        trainerId: null,
        appointments,
        trainers,
        clients,
        activeBonos: [
            bono({ id: 'b1', userId: 'u1', minutosRestantes: 20, fechaExpiracion: '2026-10-30T22:59:59.000Z' }),
            bono({ id: 'b2', userId: 'u2', minutosRestantes: 300, minutosTotales: 480, tamano: 480 }),
            bono({ id: 'b3', userId: 'u2', minutosRestantes: 100 }),
        ],
        bonoHistory: [
            bono({ id: 'b0', userId: 'u3', estado: 'expirado', fechaAsignacion: '2026-09-10T00:00:00.000Z', fechaExpiracion: '2026-10-10T21:59:59.000Z' }),
            bono({ id: 'bOld', userId: 'u1', estado: 'agotado', fechaAsignacion: '2026-09-01T00:00:00.000Z', replacedByBonoId: 'b1', replacedAt: '2026-10-04T10:00:00.000Z' }),
        ],
        siteConfig,
        blockedSlots: [],
        upcomingOccupancy: [
            { date: '2026-10-28', time: '10:00', count: 1 },
            { date: '2026-10-28', time: '10:15', count: 2 },
            ...['18:00', '18:15', '18:30', '18:45'].map((time) => ({ date: '2026-10-30', time, count: 1 })),
        ],
        pendingApprovalCount: 1,
    };
}

describe('calculateStatistics', () => {
    it('counts only approved sessions already started as "contabilizadas", with the previous period', () => {
        const { summary } = calculateStatistics(fixture());
        expect(summary.countedSessions).toEqual({ current: 4, previous: 2 });
        expect(summary.countedMinutes).toEqual({ current: 60 + 45 + 60 + 30, previous: 120 });
        expect(summary.activeClients).toEqual({ current: 3, previous: 2 });
    });

    it('compares a running period with the same elapsed stretch of the previous one', () => {
        const input = fixture();
        const late = { ...input.appointments[8], id: 'late-september', approvedSlot: { date: '2026-09-25', time: '10:00' }, preferredSlots: [{ date: '2026-09-25', time: '10:00' }], date: '2026-09-25' };
        const running = calculateStatistics({ ...input, appointments: [...input.appointments, late] });
        expect(running.comparison).toEqual({ startKey: '2026-09-01', endKey: '2026-09-21', partial: true });
        expect(running.occupancyUntilKey).toBe('2026-10-21');
        expect(running.summary.countedSessions.previous).toBe(2);

        const closed = calculateStatistics({ ...input, appointments: [...input.appointments, late], now: new Date('2026-11-05T10:00:00.000Z') });
        expect(closed.comparison).toEqual({ startKey: '2026-09-01', endKey: '2026-09-30', partial: false });
        expect(closed.summary.countedSessions.previous).toBe(3);
    });

    it('classifies cancellations by recorded modality and keeps charged minutes apart', () => {
        const { summary, cancellations } = calculateStatistics(fixture());
        expect(summary.chargedCancellations).toEqual({ current: 1, previous: 1 });
        expect(summary.notChargedCancellations).toEqual({ current: 1, previous: 0 });
        expect(summary.unclassifiedCancellations).toEqual({ current: 1, previous: 0 });
        expect(summary.chargedMinutes).toEqual({ current: 60, previous: 60 });
        expect(cancellations.totals).toEqual({ charged: 1, not_charged: 1, unclassified: 1 });
        expect(cancellations.byTrainer.find((row) => row.trainerId === 't1')).toMatchObject({ charged: 1, chargedMinutes: 60 });
        expect(cancellations.byTrainer.find((row) => row.trainerId === null)).toMatchObject({ unclassified: 1, name: 'Sin asignar' });
        expect(cancellations.records.map((record) => record.category)).toEqual(['not_charged', 'charged', 'unclassified']);
        const bucket = cancellations.buckets.find((item) => item.key === '2026-10-14');
        expect(bucket).toMatchObject({ charged: 1, chargedMinutes: 60 });
    });

    it('never counts a charged cancellation as a session or a trainer hour (same numbers as the Equipo tab)', () => {
        const input = fixture();
        const { trainers: rows } = calculateStatistics(input);
        const ana = rows.find((row) => row.trainerId === 't1')!;
        expect(ana).toMatchObject({ countedMinutes: 105, countedSessions: 2, uniqueClients: 2, chargedCancellations: 1, chargedMinutes: 60, previousCountedMinutes: 60 });
        const equipo = calculateTrainerStats(input.appointments, 't1', 'current-month', NOW);
        expect(ana.countedMinutes).toBe(equipo.completedMinutes);
        expect(ana.countedSessions).toBe(equipo.completedSessions);
        const unassigned = rows.find((row) => row.trainerId === null)!;
        expect(unassigned.upcomingSessions).toBe(1);
    });

    it('applies the trainer filter to appointment metrics only', () => {
        const result = calculateStatistics({ ...fixture(), trainerId: 't1' });
        expect(result.summary.countedSessions.current).toBe(2);
        expect(result.summary.chargedCancellations.current).toBe(1);
        expect(result.summary.notChargedCancellations.current).toBe(0);
        expect(result.trainers.map((row) => row.trainerId)).toEqual(['t1']);
        // Occupancy and bonos describe the whole centre.
        expect(result.occupancy.averageRate).toBe(calculateStatistics(fixture()).occupancy.averageRate);
        expect(result.clients.activeBonos).toBe(3);
    });

    it('splits the training evolution by status and distributions by duration and type', () => {
        const { training } = calculateStatistics(fixture());
        expect(training.granularity).toBe('day');
        expect(training.buckets).toHaveLength(31);
        expect(training.totals).toEqual({ counted: 4, upcoming: 2, pending: 1, cancelled: 3, rejected: 1 });
        expect(training.buckets.find((bucket) => bucket.key === '2026-10-25')?.pending).toBe(1);
        expect(training.durationDistribution).toEqual([
            { label: '30 min', sessions: 2 }, { label: '45 min', sessions: 1 }, { label: '60 min', sessions: 3 },
        ]);
        expect(training.typeDistribution).toEqual(expect.arrayContaining([
            { label: 'Nutrición', sessions: 1, minutes: 30 },
            { label: 'Entrenamiento', sessions: 5, minutes: 255 },
        ]));
    });

    it('reports minutes only where the data is reliable', () => {
        const { clients } = calculateStatistics(fixture());
        expect(clients.minutes).toEqual({
            counted: 105,
            charged: 60,
            reserved: 30 + 60,
            sessionsWithoutData: 1,
            coverage: 2 / 3,
        });
        expect(clients.remainingActiveMinutes).toBe(20 + 300 + 100);
    });

    it('summarises clients and bonos', () => {
        const { clients } = calculateStatistics(fixture());
        expect(clients.newClients).toEqual({ current: 1, previous: 1 });
        expect(clients.totalClients).toBe(4);
        expect(clients.clientsWithActiveBono).toBe(2);
        expect(clients.activeBonos).toBe(3);
        expect(clients.expiredInPeriod).toBe(1);
        expect(clients.expiringSoon.map((item) => item.bonoId)).toEqual(['b1']);
        expect(clients.lowMinutes.map((item) => item.bonoId)).toEqual(['b1']);
        expect(clients.multipleActiveBonos).toEqual([{ userId: 'u2', name: 'Pablo', count: 2 }]);
        expect(clients.renewal.ended).toBe(2);
        expect(clients.renewal.renewed).toBe(1);
        expect(clients.renewal.clients[0]).toMatchObject({ userId: 'u3', renewed: false, reason: 'expired' });
    });

    it('lists clients at risk: trained recently, inactive 21+ days and nothing booked ahead', () => {
        const { clients } = calculateStatistics(fixture());
        expect(clients.retention).toEqual([
            { userId: 'u4', name: 'Óscar', email: 'u4@example.com', lastSessionDate: '2026-09-01', daysSinceLastSession: 50, activeBonoMinutes: null },
        ]);
    });

    it('computes occupancy from approved seats per 15-min block over open, unblocked capacity', () => {
        const day = customPeriod('2026-10-05', '2026-10-05')!;
        const input = { ...fixture(), period: day, previous: previousPeriod(day) };
        const { occupancy, summary } = calculateStatistics(input);
        // 12 open hours × 4 blocks × 2 seats = 96; one 60-min session = 4 seats.
        expect(summary.averageOccupancy.current).toBeCloseTo(4 / 96);
        const monday10 = occupancy.heatmap.find((cell) => cell.weekday === 0 && cell.hour === 10)!;
        expect(monday10).toEqual({ weekday: 0, hour: 10, rate: 4 / 8, sessions: 1 });
        expect(occupancy.byHour.find((hour) => hour.hour === 10)).toMatchObject({ rate: 0.5, reservedSeats: 1 });

        const blocked = calculateStatistics({
            ...input,
            blockedSlots: ['10:00', '10:15', '10:30', '10:45'].map((time) => ({ id: time, date: '2026-10-05', time, createdBy: 'admin', createdAt: '' })),
        });
        expect(blocked.occupancy.heatmap.find((cell) => cell.weekday === 0 && cell.hour === 10)?.rate).toBeNull();
        expect(blocked.summary.averageOccupancy.current).toBeCloseTo(0);
    });

    it('separates reserved and cancelled seat-hours and ranks demand', () => {
        const { occupancy } = calculateStatistics(fixture());
        const oct14 = occupancy.buckets.find((bucket) => bucket.key === '2026-10-14')!;
        expect(oct14).toMatchObject({ reservedSeatHours: 0, cancelledSeatHours: 1 });
        const oct20 = occupancy.buckets.find((bucket) => bucket.key === '2026-10-20')!;
        expect(oct20.reservedSeatHours).toBeCloseTo(0.75);
        expect(occupancy.topDemand[0].requests).toBeGreaterThanOrEqual(1);
        expect(occupancy.topDemand.every((item) => item.requests > 0)).toBe(true);
    });

    it('detects capacity counters that disagree with approved appointments in the next days', () => {
        const { occupancyDrift, review } = calculateStatistics(fixture());
        expect(occupancyDrift).toEqual([{ date: '2026-10-28', time: '10:15', recorded: 2, expected: 1 }]);
        expect(review.map((item) => item.id)).toEqual([
            'pending-approval', 'unassigned', 'occupancy-drift', 'expiring', 'low-minutes', 'multiple-bonos', 'retention',
        ]);
        expect(review.find((item) => item.id === 'pending-approval')).toMatchObject({ count: 1, link: { tab: 'appointments', status: 'pending' } });
    });

    it('excludes appointments without a usable slot and reports them', () => {
        const input = fixture();
        const broken = { ...input.appointments[0], id: 'broken', approvedSlot: undefined, preferredSlots: [], date: undefined, time: undefined } as Appointment;
        const result = calculateStatistics({ ...input, appointments: [...input.appointments, broken] });
        expect(result.excludedWithoutSlot).toBe(1);
        expect(result.summary.countedSessions.current).toBe(4);
    });
});

describe('helpers', () => {
    it('computes relative change only with a base', () => {
        expect(relativeChange({ current: 15, previous: 10 })).toBeCloseTo(0.5);
        expect(relativeChange({ current: 0, previous: 0 })).toBe(0);
        expect(relativeChange({ current: 3, previous: 0 })).toBeNull();
        expect(relativeChange({ current: null, previous: 2 })).toBeNull();
    });

    it('exports CSV for Excel in Spanish (BOM, semicolons, quoted values)', () => {
        const { trainers: rows, cancellations } = calculateStatistics(fixture());
        const csv = trainersCsv(rows);
        expect(csv.startsWith('﻿Entrenador;Horas contabilizadas;')).toBe(true);
        expect(csv).toContain('Ana;1,75;105;2;2;0;1;60');
        expect(csv).not.toMatch(/[0-9]+\.[0-9]+;/);
        const cancellationsFile = cancellationsCsv(cancellations.records);
        expect(cancellationsFile).toContain('Con cargo;60');
        expect(cancellationsCsv([{ ...cancellations.records[0], clientName: 'Ana; "la jefa"' }])).toContain('"Ana; ""la jefa"""');
    });
});
