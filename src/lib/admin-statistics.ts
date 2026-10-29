import { resolveMaxCapacity, type CapacityByDate } from '@/lib/capacity-exceptions';
import {
    type Appointment,
    type BlockedSlot,
    type Bono,
    type SiteConfig,
    type SlotOccupancy,
    type Trainer,
    type UserProfile,
    getAppointmentType,
    getBonoMinutosRestantes,
} from '@/types';
import { getCanonicalSlotBlocks, INTERNAL_SLOT_MINUTES, slotOccupancyKey } from './appointment-slots';
import { type CancellationCategory, getCancellationCategory, getChargedMinutes } from './appointment-cancellation';
import { bonoExpiryInstant } from './bono-expiration';
import { getAppointmentEffectiveSlot, getMadridDateKey, madridSlotToTimestamp } from './madrid-date';
import {
    addDays,
    bucketKeyOf,
    bucketsFor,
    daysBetween,
    granularityFor,
    isDateInPeriod,
    periodInstantRange,
    type StatsBucket,
    type StatsGranularity,
    type StatsPeriod,
    weekdayIndex,
} from './admin-statistics-period';
import { calculateTrainerStatsInRange } from './trainer-stats';

/**
 * Statistics of the admin "Estadísticas" page. Pure functions over documents
 * already read (bounded by period), so every number is reproducible in tests.
 *
 * Rules shared by every section:
 * - An appointment belongs to the period of its effective session date
 *   (`getAppointmentEffectiveSlot`, Europe/Madrid civil date).
 * - "Contabilizada" = approved and already started. There is no attendance
 *   confirmation, so nothing claims attendance.
 * - Cancellations (with or without charge) are never sessions or trainer
 *   hours. Charged ones count as consumed minutes only.
 * - Cancellations without a recorded modality are "Sin clasificar".
 */

export const EXPIRING_SOON_DAYS = 14;
export const LOW_MINUTES_THRESHOLD = 30;
export const RETENTION_INACTIVE_DAYS = 21;
export const RETENTION_LOOKBACK_DAYS = 180;
export const UPCOMING_OCCUPANCY_CHECK_DAYS = 14;

export const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export interface StatisticsInput {
    period: StatsPeriod;
    previous: StatsPeriod;
    now: Date;
    /** Trainer filter (`assignedTrainer` doc id). Applies to appointment-based metrics only. */
    trainerId: string | null;
    /** Deduplicated appointments: the period, the previous period, recent history and the future. */
    appointments: readonly Appointment[];
    trainers: readonly Trainer[];
    /** Customers (`role == 'user'`). */
    clients: readonly UserProfile[];
    activeBonos: readonly Bono[];
    /** Bonos that ended (expired or replaced) in the current or previous period, plus every newer bono. */
    bonoHistory: readonly Bono[];
    siteConfig: SiteConfig;
    /** Capacity exceptions of the periods (aforo por fecha); other days use siteConfig.maxCapacity. */
    capacityByDate?: CapacityByDate;
    blockedSlots: readonly BlockedSlot[];
    /** Counters of the next days, to detect drift against approved appointments. */
    upcomingOccupancy: readonly SlotOccupancy[];
    /** Server count of every pending request (any date). */
    pendingApprovalCount: number | null;
}

export interface Comparison {
    current: number;
    previous: number;
}

export interface SummaryStats {
    countedSessions: Comparison;
    countedMinutes: Comparison;
    chargedCancellations: Comparison;
    notChargedCancellations: Comparison;
    unclassifiedCancellations: Comparison;
    chargedMinutes: Comparison;
    activeClients: Comparison;
    /** 0–1, or null without capacity data. */
    averageOccupancy: { current: number | null; previous: number | null };
}

export interface TrainingBucket {
    key: string;
    label: string;
    countedSessions: number;
    countedMinutes: number;
    upcoming: number;
    pending: number;
    cancelled: number;
    rejected: number;
}

export interface TrainingStats {
    granularity: StatsGranularity;
    buckets: TrainingBucket[];
    totals: { counted: number; upcoming: number; pending: number; cancelled: number; rejected: number };
    durationDistribution: { label: string; sessions: number }[];
    typeDistribution: { label: string; sessions: number; minutes: number }[];
}

export interface TrainerRow {
    trainerId: string | null;
    name: string;
    active: boolean;
    countedMinutes: number;
    previousCountedMinutes: number;
    countedSessions: number;
    uniqueClients: number;
    upcomingSessions: number;
    chargedCancellations: number;
    chargedMinutes: number;
}

export interface CancellationRecord {
    appointmentId: string;
    date: string;
    time: string;
    clientName: string;
    trainerName: string;
    category: CancellationCategory;
    chargedMinutes: number;
    duration: number;
    cancelledBy: string;
    cancelledAt: string;
}

export interface CancellationStats {
    totals: Record<CancellationCategory, number>;
    chargedMinutes: number;
    buckets: { key: string; label: string; charged: number; notCharged: number; unclassified: number; chargedMinutes: number }[];
    byTrainer: { trainerId: string | null; name: string; charged: number; notCharged: number; unclassified: number; chargedMinutes: number }[];
    records: CancellationRecord[];
}

export interface RetentionClient {
    userId: string;
    name: string;
    email: string;
    lastSessionDate: string;
    daysSinceLastSession: number;
    activeBonoMinutes: number | null;
}

export interface RenewalClient {
    userId: string;
    name: string;
    endedAt: string;
    reason: 'expired' | 'replaced';
    renewed: boolean;
}

export interface ClientsAndBonosStats {
    activeClients: Comparison;
    newClients: Comparison;
    totalClients: number;
    clientsWithActiveBono: number;
    activeBonos: number;
    expiredInPeriod: number;
    expiringSoon: { bonoId: string; userId: string; name: string; expiresAt: string; minutesLeft: number }[];
    lowMinutes: { bonoId: string; userId: string; name: string; minutesLeft: number }[];
    /** Minutes debited and not refunded for sessions of the period, split by what they paid for. */
    minutes: {
        counted: number;
        charged: number;
        reserved: number;
        /** Approved past training sessions without deduction markers (legacy): not counted above. */
        sessionsWithoutData: number;
        /** Share of counted training sessions with reliable minute data (1 = all). */
        coverage: number | null;
    };
    remainingActiveMinutes: number;
    retention: RetentionClient[];
    renewal: { ended: number; renewed: number; clients: RenewalClient[] };
    multipleActiveBonos: { userId: string; name: string; count: number }[];
}

export interface OccupancyCell {
    weekday: number;
    hour: number;
    /** 0–1, or null when the hour is closed. */
    rate: number | null;
    sessions: number;
}

export interface OccupancyStats {
    capacity: number;
    averageRate: number | null;
    heatmap: OccupancyCell[];
    hours: number[];
    byHour: { hour: number; label: string; rate: number | null; reservedSeats: number }[];
    buckets: { key: string; label: string; reservedSeatHours: number; cancelledSeatHours: number; rate: number | null }[];
    topDemand: { weekday: number; time: string; requests: number }[];
}

export type ReviewSeverity = 'info' | 'warning' | 'critical';

export interface ReviewItem {
    id: string;
    severity: ReviewSeverity;
    title: string;
    description: string;
    count: number;
    link: { tab: 'appointments' | 'clients' | 'team' | 'availability'; status?: Appointment['status'] };
}

export interface OccupancyDrift {
    date: string;
    time: string;
    recorded: number;
    expected: number;
}

export interface StatisticsResult {
    /**
     * What the "previous" numbers cover. While the selected period is still
     * running, the previous period is cut to the same elapsed days
     * (1–21 Sep against 1–21 Oct), never compared whole.
     */
    comparison: { startKey: string; endKey: string; partial: boolean };
    /** Days of the current period used by the summary occupancy (up to today while it is running). */
    occupancyUntilKey: string;
    summary: SummaryStats;
    training: TrainingStats;
    trainers: TrainerRow[];
    cancellations: CancellationStats;
    clients: ClientsAndBonosStats;
    occupancy: OccupancyStats;
    review: ReviewItem[];
    occupancyDrift: OccupancyDrift[];
    /** Appointments with no usable slot (corrupt legacy data), excluded everywhere. */
    excludedWithoutSlot: number;
}

// ------------------------------------------------------------------ helpers

interface Located {
    appointment: Appointment;
    date: string;
    time: string;
    start: number;
    duration: number;
}

function sessionMinutes(appointment: Appointment): number {
    const minutes = Number(appointment.duration);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function locate(appointments: readonly Appointment[]): { located: Located[]; withoutSlot: number } {
    const located: Located[] = [];
    let withoutSlot = 0;
    for (const appointment of appointments) {
        const slot = getAppointmentEffectiveSlot(appointment);
        const start = slot ? madridSlotToTimestamp(slot) : undefined;
        if (!slot || start === undefined) {
            withoutSlot += 1;
            continue;
        }
        located.push({ appointment, date: slot.date, time: slot.time, start, duration: sessionMinutes(appointment) });
    }
    return { located, withoutSlot };
}

function inPeriod(items: readonly Located[], period: StatsPeriod): Located[] {
    return items.filter((item) => isDateInPeriod(item.date, period));
}

function matchesTrainer(item: Located, trainerId: string | null): boolean {
    return trainerId === null || item.appointment.assignedTrainer === trainerId;
}

function isCounted(item: Located, nowMs: number): boolean {
    return item.appointment.status === 'approved' && item.start < nowMs;
}

/** Minutes debited for this appointment and still not refunded. */
function consumedMinutes(appointment: Appointment): number {
    if (getAppointmentType(appointment) === 'nutrition') return 0;
    if (appointment.minutesDeducted !== true || !appointment.minutesDeductedAt || appointment.minutesRefundedAt) return 0;
    const amount = Number(appointment.minutesDeductedAmount ?? 0);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function countCancellations(items: readonly Located[]): Record<CancellationCategory, number> & { chargedMinutes: number } {
    const totals = { charged: 0, not_charged: 0, unclassified: 0, chargedMinutes: 0 };
    for (const item of items) {
        const category = getCancellationCategory(item.appointment);
        if (!category) continue;
        totals[category] += 1;
        totals.chargedMinutes += getChargedMinutes(item.appointment);
    }
    return totals;
}

function activeClientIds(items: readonly Located[]): Set<string> {
    return new Set(items.filter((item) => item.appointment.status === 'approved' && item.appointment.userId).map((item) => item.appointment.userId));
}

function trainerName(trainers: readonly Trainer[], trainerId: string | undefined | null): string {
    if (!trainerId) return 'Sin asignar';
    return trainers.find((trainer) => trainer.id === trainerId)?.name ?? 'Entrenador eliminado';
}

function clientName(clients: ReadonlyMap<string, UserProfile>, userId: string, fallback?: string): string {
    return clients.get(userId)?.name || fallback || 'Cliente';
}

function isOverdue(bono: Bono, now: Date): boolean {
    const expiry = bonoExpiryInstant(bono.fechaExpiracion);
    return Boolean(expiry && expiry.getTime() <= now.getTime());
}

// ------------------------------------------------------------------ occupancy

interface OccupancyFrame {
    /** Global capacity, shown as the reference value. */
    capacity: number;
    /** Effective capacity of each day: its exception or the global value. */
    capacityFor: (date: string) => number;
    hours: number[];
    /** Open 15-min blocks per day of the period, minus blocked ones. */
    openBlocksByDate: Map<string, Set<string>>;
}

function occupancyFrame(
    period: StatsPeriod,
    config: SiteConfig,
    blockedSlots: readonly BlockedSlot[],
    capacityByDate?: CapacityByDate,
): OccupancyFrame {
    const capacity = Math.max(0, Math.trunc(Number(config.maxCapacity) || 0));
    const capacityFor = (date: string) => Math.max(0, Math.trunc(Number(resolveMaxCapacity({ maxCapacity: capacity }, capacityByDate, date)) || 0));
    const hours: number[] = [];
    for (let hour = config.startHour; hour < config.endHour; hour += 1) hours.push(hour);
    const blocked = new Set(blockedSlots.map((slot) => slotOccupancyKey(slot.date, slot.time)));
    const openBlocksByDate = new Map<string, Set<string>>();
    for (let date = period.startKey; date <= period.endKey; date = addDays(date, 1)) {
        const open = new Set<string>();
        for (const hour of hours) {
            for (let minute = 0; minute < 60; minute += INTERNAL_SLOT_MINUTES) {
                const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                if (!blocked.has(slotOccupancyKey(date, time))) open.add(time);
            }
        }
        openBlocksByDate.set(date, open);
    }
    return { capacity, capacityFor, hours, openBlocksByDate };
}

/** Seats taken per 15-min block by the given appointments (approved only). */
function seatsByBlock(items: readonly Located[]): Map<string, number> {
    const seats = new Map<string, number>();
    for (const item of items) {
        if (item.appointment.status !== 'approved' || !item.duration) continue;
        for (const time of getCanonicalSlotBlocks(item.time, item.duration)) {
            const key = slotOccupancyKey(item.date, time);
            seats.set(key, (seats.get(key) ?? 0) + 1);
        }
    }
    return seats;
}

function occupancyRate(items: readonly Located[], frame: OccupancyFrame, dates?: (date: string) => boolean): number | null {
    if (frame.capacity <= 0) return null;
    const seats = seatsByBlock(items);
    let available = 0;
    let used = 0;
    for (const [date, open] of frame.openBlocksByDate) {
        if (dates && !dates(date)) continue;
        const dayCapacity = frame.capacityFor(date);
        available += open.size * dayCapacity;
        for (const time of open) used += Math.min(dayCapacity, seats.get(slotOccupancyKey(date, time)) ?? 0);
    }
    return available > 0 ? used / available : null;
}

// ------------------------------------------------------------------ main

export function calculateStatistics(input: StatisticsInput): StatisticsResult {
    const { period, previous, now, trainerId, trainers } = input;
    const nowMs = now.getTime();
    const todayKey = getMadridDateKey(now);
    const clientsById = new Map(input.clients.map((client) => [client.uid, client]));
    const { located, withoutSlot } = locate(input.appointments);

    // A running period is compared with the same elapsed stretch of the previous one.
    const elapsedDays = isDateInPeriod(todayKey, period) ? daysBetween(period.startKey, todayKey) : null;
    const comparable: StatsPeriod = elapsedDays === null
        ? previous
        : { ...previous, endKey: [previous.endKey, addDays(previous.startKey, elapsedDays)].sort()[0] };
    const occupancyUntilKey = elapsedDays === null ? period.endKey : todayKey;

    const current = inPeriod(located, period);
    const before = inPeriod(located, comparable);
    const currentFiltered = current.filter((item) => matchesTrainer(item, trainerId));
    const beforeFiltered = before.filter((item) => matchesTrainer(item, trainerId));

    const frame = occupancyFrame(period, input.siteConfig, input.blockedSlots, input.capacityByDate);
    const previousFrame = occupancyFrame(comparable, input.siteConfig, input.blockedSlots, input.capacityByDate);

    // ---------------- summary
    const counted = currentFiltered.filter((item) => isCounted(item, nowMs));
    const countedBefore = beforeFiltered.filter((item) => isCounted(item, nowMs));
    const cancellationsNow = countCancellations(currentFiltered);
    const cancellationsBefore = countCancellations(beforeFiltered);
    const summary: SummaryStats = {
        countedSessions: { current: counted.length, previous: countedBefore.length },
        countedMinutes: {
            current: counted.reduce((sum, item) => sum + item.duration, 0),
            previous: countedBefore.reduce((sum, item) => sum + item.duration, 0),
        },
        chargedCancellations: { current: cancellationsNow.charged, previous: cancellationsBefore.charged },
        notChargedCancellations: { current: cancellationsNow.not_charged, previous: cancellationsBefore.not_charged },
        unclassifiedCancellations: { current: cancellationsNow.unclassified, previous: cancellationsBefore.unclassified },
        chargedMinutes: { current: cancellationsNow.chargedMinutes, previous: cancellationsBefore.chargedMinutes },
        activeClients: { current: activeClientIds(currentFiltered).size, previous: activeClientIds(beforeFiltered).size },
        averageOccupancy: {
            current: occupancyRate(current, frame, (date) => date <= occupancyUntilKey),
            previous: occupancyRate(before, previousFrame),
        },
    };

    // ---------------- training
    const granularity = granularityFor(period);
    const buckets = bucketsFor(period, granularity);
    const emptyTraining = (bucket: StatsBucket): TrainingBucket => ({
        key: bucket.key, label: bucket.label, countedSessions: 0, countedMinutes: 0, upcoming: 0, pending: 0, cancelled: 0, rejected: 0,
    });
    const trainingByKey = new Map(buckets.map((bucket) => [bucket.key, emptyTraining(bucket)]));
    const totals = { counted: 0, upcoming: 0, pending: 0, cancelled: 0, rejected: 0 };
    const durations = new Map<string, number>();
    const types = new Map<string, { sessions: number; minutes: number }>();
    for (const item of currentFiltered) {
        const bucket = trainingByKey.get(bucketKeyOf(item.date, granularity));
        if (!bucket) continue;
        const status = item.appointment.status;
        if (status === 'approved') {
            if (item.start < nowMs) {
                bucket.countedSessions += 1;
                bucket.countedMinutes += item.duration;
                totals.counted += 1;
            } else {
                bucket.upcoming += 1;
                totals.upcoming += 1;
            }
            const durationLabel = item.duration ? `${item.duration} min` : 'Sin duración';
            durations.set(durationLabel, (durations.get(durationLabel) ?? 0) + 1);
            const typeLabel = getAppointmentType(item.appointment) === 'nutrition' ? 'Nutrición' : 'Entrenamiento';
            const type = types.get(typeLabel) ?? { sessions: 0, minutes: 0 };
            type.sessions += 1;
            type.minutes += item.duration;
            types.set(typeLabel, type);
        } else if (status === 'pending') {
            bucket.pending += 1;
            totals.pending += 1;
        } else if (status === 'cancelled') {
            bucket.cancelled += 1;
            totals.cancelled += 1;
        } else if (status === 'rejected') {
            bucket.rejected += 1;
            totals.rejected += 1;
        }
    }
    const training: TrainingStats = {
        granularity,
        buckets: [...trainingByKey.values()],
        totals,
        durationDistribution: [...durations.entries()]
            .sort(([left], [right]) => parseInt(left, 10) - parseInt(right, 10))
            .map(([label, sessions]) => ({ label, sessions })),
        typeDistribution: [...types.entries()].map(([label, value]) => ({ label, ...value })),
    };

    // ---------------- trainers (same calculation as the Equipo tab)
    const range = periodInstantRange(period);
    const previousRange = periodInstantRange(comparable);
    const trainerAppointments = input.appointments;
    const trainerIds: (string | null)[] = trainerId
        ? [trainerId]
        : [...trainers.map((trainer) => trainer.id), null];
    const trainerRows: TrainerRow[] = trainerIds.map((id) => {
        const charged = current.filter((item) => (item.appointment.assignedTrainer ?? null) === id
            && getCancellationCategory(item.appointment) === 'charged');
        if (id === null) {
            const unassigned = current.filter((item) => !item.appointment.assignedTrainer && isCounted(item, nowMs));
            const unassignedBefore = before.filter((item) => !item.appointment.assignedTrainer && isCounted(item, nowMs));
            return {
                trainerId: null,
                name: 'Sin asignar',
                active: true,
                countedMinutes: unassigned.reduce((sum, item) => sum + item.duration, 0),
                previousCountedMinutes: unassignedBefore.reduce((sum, item) => sum + item.duration, 0),
                countedSessions: unassigned.length,
                uniqueClients: new Set(unassigned.map((item) => item.appointment.userId)).size,
                upcomingSessions: located.filter((item) => !item.appointment.assignedTrainer
                    && item.appointment.status === 'approved' && item.start >= nowMs).length,
                chargedCancellations: charged.length,
                chargedMinutes: charged.reduce((sum, item) => sum + getChargedMinutes(item.appointment), 0),
            };
        }
        const stats = calculateTrainerStatsInRange(trainerAppointments, id, range, now);
        const previousStats = calculateTrainerStatsInRange(trainerAppointments, id, previousRange, now);
        const trainer = trainers.find((candidate) => candidate.id === id);
        return {
            trainerId: id,
            name: trainer?.name ?? 'Entrenador eliminado',
            active: trainer?.active !== false,
            countedMinutes: stats.completedMinutes,
            previousCountedMinutes: previousStats.completedMinutes,
            countedSessions: stats.completedSessions,
            uniqueClients: stats.uniqueClients,
            upcomingSessions: stats.upcomingSessions,
            chargedCancellations: charged.length,
            chargedMinutes: charged.reduce((sum, item) => sum + getChargedMinutes(item.appointment), 0),
        };
    }).filter((row) => row.trainerId !== null || row.countedSessions > 0 || row.chargedCancellations > 0 || row.upcomingSessions > 0);

    // ---------------- cancellations
    const cancelledNow = currentFiltered.filter((item) => item.appointment.status === 'cancelled');
    const cancellationBuckets = new Map(buckets.map((bucket) => [bucket.key, {
        key: bucket.key, label: bucket.label, charged: 0, notCharged: 0, unclassified: 0, chargedMinutes: 0,
    }]));
    const byTrainer = new Map<string, CancellationStats['byTrainer'][number]>();
    const records: CancellationRecord[] = [];
    for (const item of cancelledNow) {
        const category = getCancellationCategory(item.appointment) ?? 'unclassified';
        const minutes = getChargedMinutes(item.appointment);
        const bucket = cancellationBuckets.get(bucketKeyOf(item.date, granularity));
        if (bucket) {
            if (category === 'charged') bucket.charged += 1;
            else if (category === 'not_charged') bucket.notCharged += 1;
            else bucket.unclassified += 1;
            bucket.chargedMinutes += minutes;
        }
        const trainerKey = item.appointment.assignedTrainer ?? '';
        const row = byTrainer.get(trainerKey) ?? {
            trainerId: item.appointment.assignedTrainer ?? null,
            name: trainerName(trainers, item.appointment.assignedTrainer),
            charged: 0, notCharged: 0, unclassified: 0, chargedMinutes: 0,
        };
        if (category === 'charged') row.charged += 1;
        else if (category === 'not_charged') row.notCharged += 1;
        else row.unclassified += 1;
        row.chargedMinutes += minutes;
        byTrainer.set(trainerKey, row);
        records.push({
            appointmentId: item.appointment.id,
            date: item.date,
            time: item.time,
            clientName: clientName(clientsById, item.appointment.userId, item.appointment.name),
            trainerName: trainerName(trainers, item.appointment.assignedTrainer),
            category,
            chargedMinutes: minutes,
            duration: item.duration,
            cancelledBy: item.appointment.cancelledBy === 'admin' || item.appointment.cancellationChargeDecidedBy === 'admin'
                ? 'Admin'
                : item.appointment.cancelledBy ? 'Cliente' : '—',
            cancelledAt: item.appointment.cancelledAt ?? '',
        });
    }
    records.sort((left, right) => `${right.date}T${right.time}`.localeCompare(`${left.date}T${left.time}`));
    const cancellations: CancellationStats = {
        totals: { charged: cancellationsNow.charged, not_charged: cancellationsNow.not_charged, unclassified: cancellationsNow.unclassified },
        chargedMinutes: cancellationsNow.chargedMinutes,
        buckets: [...cancellationBuckets.values()],
        byTrainer: [...byTrainer.values()].sort((left, right) => right.charged - left.charged || left.name.localeCompare(right.name, 'es')),
        records,
    };

    // ---------------- clients and bonos
    const activeBonos = input.activeBonos.filter((bono) => bono.estado === 'activo');
    const validActiveBonos = activeBonos.filter((bono) => !isOverdue(bono, now));
    const bonoByUser = new Map<string, Bono[]>();
    for (const bono of validActiveBonos) bonoByUser.set(bono.userId, [...(bonoByUser.get(bono.userId) ?? []), bono]);
    const soonLimit = nowMs + EXPIRING_SOON_DAYS * 86_400_000;
    const expiringSoon = validActiveBonos
        .map((bono) => ({ bono, expiry: bonoExpiryInstant(bono.fechaExpiracion)?.getTime() }))
        .filter(({ expiry }) => expiry !== undefined && expiry > nowMs && expiry <= soonLimit)
        .sort((left, right) => (left.expiry ?? 0) - (right.expiry ?? 0))
        .map(({ bono }) => ({
            bonoId: bono.id, userId: bono.userId, name: clientName(clientsById, bono.userId),
            expiresAt: bono.fechaExpiracion, minutesLeft: getBonoMinutosRestantes(bono),
        }));
    const lowMinutes = validActiveBonos
        .filter((bono) => getBonoMinutosRestantes(bono) <= LOW_MINUTES_THRESHOLD)
        .map((bono) => ({ bonoId: bono.id, userId: bono.userId, name: clientName(clientsById, bono.userId), minutesLeft: getBonoMinutosRestantes(bono) }))
        .sort((left, right) => left.minutesLeft - right.minutesLeft);

    const allBonos = new Map<string, Bono>();
    for (const bono of [...input.bonoHistory, ...input.activeBonos]) allBonos.set(bono.id, bono);
    const expiredInPeriod = [...allBonos.values()].filter((bono) => {
        const expiry = bonoExpiryInstant(bono.fechaExpiracion);
        if (!expiry || expiry.getTime() > nowMs) return false;
        if (bono.estado !== 'expirado' && bono.estado !== 'activo') return false;
        return expiry.getTime() >= range.start && expiry.getTime() < range.end;
    }).length;

    // Minutes of the period's sessions (training only; trainer filter applies).
    let countedConsumed = 0;
    let chargedConsumed = 0;
    let reservedConsumed = 0;
    let countedTraining = 0;
    let withoutData = 0;
    for (const item of currentFiltered) {
        const isTraining = getAppointmentType(item.appointment) !== 'nutrition';
        const minutes = consumedMinutes(item.appointment);
        if (item.appointment.status === 'approved' && item.start < nowMs) {
            if (!isTraining) continue;
            countedTraining += 1;
            if (minutes > 0) countedConsumed += minutes;
            else withoutData += 1;
        } else if (getCancellationCategory(item.appointment) === 'charged') {
            chargedConsumed += minutes;
        } else if (item.appointment.status === 'approved' || item.appointment.status === 'pending') {
            reservedConsumed += minutes;
        }
    }

    const newClients = (target: StatsPeriod) => input.clients.filter((client) => {
        if (!client.createdAt) return false;
        const created = new Date(client.createdAt);
        if (Number.isNaN(created.getTime())) return false;
        return isDateInPeriod(getMadridDateKey(created), target);
    }).length;

    // Retention: customers who trained in the lookback window, have not trained for
    // RETENTION_INACTIVE_DAYS and have nothing booked (approved or requested) ahead.
    const lookbackStart = addDays(todayKey, -RETENTION_LOOKBACK_DAYS);
    const lastSession = new Map<string, string>();
    const hasFuture = new Set<string>();
    for (const item of located) {
        const { appointment } = item;
        if (!appointment.userId || !clientsById.has(appointment.userId)) continue;
        if (item.start >= nowMs && (appointment.status === 'approved' || appointment.status === 'pending')) {
            hasFuture.add(appointment.userId);
        } else if (appointment.status === 'approved' && item.start < nowMs && item.date >= lookbackStart) {
            const last = lastSession.get(appointment.userId);
            if (!last || item.date > last) lastSession.set(appointment.userId, item.date);
        }
    }
    const retention: RetentionClient[] = [...lastSession.entries()]
        .filter(([userId, date]) => !hasFuture.has(userId) && daysBetween(date, todayKey) >= RETENTION_INACTIVE_DAYS)
        .map(([userId, date]) => {
            const client = clientsById.get(userId);
            const bonos = bonoByUser.get(userId);
            return {
                userId,
                name: client?.name || 'Cliente',
                email: client?.email ?? '',
                lastSessionDate: date,
                daysSinceLastSession: daysBetween(date, todayKey),
                activeBonoMinutes: bonos ? bonos.reduce((sum, bono) => sum + getBonoMinutosRestantes(bono), 0) : null,
            };
        })
        .sort((left, right) => left.daysSinceLastSession - right.daysSinceLastSession);

    // Renewal: bonos that ended in the period (expired, or replaced by a new one).
    const renewalClients: RenewalClient[] = [];
    const bonosByUser = new Map<string, Bono[]>();
    for (const bono of allBonos.values()) bonosByUser.set(bono.userId, [...(bonosByUser.get(bono.userId) ?? []), bono]);
    for (const bono of allBonos.values()) {
        if (bono.estado === 'eliminado') continue;
        const replacedAt = bono.replacedByBonoId && bono.replacedAt ? new Date(bono.replacedAt).getTime() : undefined;
        const expiry = bonoExpiryInstant(bono.fechaExpiracion)?.getTime();
        let endedAt: number | undefined;
        let reason: RenewalClient['reason'] = 'expired';
        if (replacedAt !== undefined && Number.isFinite(replacedAt)) {
            endedAt = replacedAt;
            reason = 'replaced';
        } else if (expiry !== undefined && expiry <= nowMs && bono.estado !== 'agotado') {
            endedAt = expiry;
        }
        if (endedAt === undefined || endedAt < range.start || endedAt >= range.end) continue;
        const renewed = reason === 'replaced' || (bonosByUser.get(bono.userId) ?? []).some((other) => other.id !== bono.id
            && other.estado !== 'eliminado'
            && (other.fechaAsignacion ?? other.createdAt ?? '') > (bono.fechaAsignacion ?? bono.createdAt ?? ''));
        renewalClients.push({
            userId: bono.userId,
            name: clientName(clientsById, bono.userId),
            endedAt: new Date(endedAt).toISOString(),
            reason,
            renewed,
        });
    }
    renewalClients.sort((left, right) => Number(left.renewed) - Number(right.renewed) || right.endedAt.localeCompare(left.endedAt));

    const multipleActiveBonos = [...activeBonos.reduce((map, bono) => map.set(bono.userId, (map.get(bono.userId) ?? 0) + 1), new Map<string, number>())]
        .filter(([, count]) => count > 1)
        .map(([userId, count]) => ({ userId, name: clientName(clientsById, userId), count }));

    const clients: ClientsAndBonosStats = {
        activeClients: summary.activeClients,
        newClients: { current: newClients(period), previous: newClients(comparable) },
        totalClients: input.clients.length,
        clientsWithActiveBono: bonoByUser.size,
        activeBonos: validActiveBonos.length,
        expiredInPeriod,
        expiringSoon,
        lowMinutes,
        minutes: {
            counted: countedConsumed,
            charged: chargedConsumed,
            reserved: reservedConsumed,
            sessionsWithoutData: withoutData,
            coverage: countedTraining > 0 ? (countedTraining - withoutData) / countedTraining : null,
        },
        remainingActiveMinutes: validActiveBonos.reduce((sum, bono) => sum + getBonoMinutosRestantes(bono), 0),
        retention,
        renewal: {
            ended: renewalClients.length,
            renewed: renewalClients.filter((client) => client.renewed).length,
            clients: renewalClients,
        },
        multipleActiveBonos,
    };

    // ---------------- occupancy (whole centre: the trainer filter does not apply)
    const seats = seatsByBlock(current);
    const heatmap: OccupancyCell[] = [];
    const byHour: OccupancyStats['byHour'] = [];
    const sessionsStarting = new Map<string, number>();
    for (const item of current) {
        if (item.appointment.status !== 'approved') continue;
        const key = `${weekdayIndex(item.date)}|${Number(item.time.slice(0, 2))}`;
        sessionsStarting.set(key, (sessionsStarting.get(key) ?? 0) + 1);
    }
    // One pass over the open blocks of the period, accumulated per weekday × hour.
    const cellTotals = new Map<string, { available: number; used: number; seats: number }>();
    for (const [date, open] of frame.openBlocksByDate) {
        const weekday = weekdayIndex(date);
        const dayCapacity = frame.capacityFor(date);
        for (const time of open) {
            const key = `${weekday}|${Number(time.slice(0, 2))}`;
            const taken = seats.get(slotOccupancyKey(date, time)) ?? 0;
            const cell = cellTotals.get(key) ?? { available: 0, used: 0, seats: 0 };
            cell.available += dayCapacity;
            cell.used += Math.min(dayCapacity, taken);
            cell.seats += taken;
            cellTotals.set(key, cell);
        }
    }
    for (const hour of frame.hours) {
        let hourAvailable = 0;
        let hourUsed = 0;
        let hourSeats = 0;
        for (let weekday = 0; weekday < 7; weekday += 1) {
            const cell = cellTotals.get(`${weekday}|${hour}`) ?? { available: 0, used: 0, seats: 0 };
            hourAvailable += cell.available;
            hourUsed += cell.used;
            hourSeats += cell.seats;
            heatmap.push({
                weekday,
                hour,
                rate: cell.available > 0 ? cell.used / cell.available : null,
                sessions: sessionsStarting.get(`${weekday}|${hour}`) ?? 0,
            });
        }
        byHour.push({
            hour,
            label: `${String(hour).padStart(2, '0')}:00`,
            rate: hourAvailable > 0 ? hourUsed / hourAvailable : null,
            reservedSeats: hourSeats / (60 / INTERNAL_SLOT_MINUTES),
        });
    }
    const occupancyBuckets = buckets.map((bucket) => {
        const inBucket = (date: string) => date >= bucket.startKey && date <= bucket.endKey;
        const items = current.filter((item) => inBucket(item.date));
        return {
            key: bucket.key,
            label: bucket.label,
            reservedSeatHours: items.filter((item) => item.appointment.status === 'approved').reduce((sum, item) => sum + item.duration, 0) / 60,
            cancelledSeatHours: items.filter((item) => item.appointment.status === 'cancelled').reduce((sum, item) => sum + item.duration, 0) / 60,
            rate: occupancyRate(items, frame, inBucket),
        };
    });
    const demand = new Map<string, number>();
    for (const item of current) {
        if (item.appointment.status === 'rejected') continue;
        const key = `${weekdayIndex(item.date)}|${item.time}`;
        demand.set(key, (demand.get(key) ?? 0) + 1);
    }
    const occupancy: OccupancyStats = {
        capacity: frame.capacity,
        averageRate: summary.averageOccupancy.current,
        heatmap,
        hours: frame.hours,
        byHour,
        buckets: occupancyBuckets,
        topDemand: [...demand.entries()]
            .map(([key, requests]) => {
                const [weekday, time] = key.split('|');
                return { weekday: Number(weekday), time, requests };
            })
            .sort((left, right) => right.requests - left.requests || left.weekday - right.weekday || left.time.localeCompare(right.time))
            .slice(0, 6),
    };

    // ---------------- occupancy drift in the next days (counters vs approved appointments)
    const driftEnd = addDays(todayKey, UPCOMING_OCCUPANCY_CHECK_DAYS);
    const upcomingApproved = located.filter((item) => item.date >= todayKey && item.date <= driftEnd);
    const expectedSeats = seatsByBlock(upcomingApproved);
    const recorded = new Map(input.upcomingOccupancy
        .filter((slot) => slot.date >= todayKey && slot.date <= driftEnd)
        .map((slot) => [slotOccupancyKey(slot.date, slot.time), slot]));
    const driftKeys = new Set([...expectedSeats.keys(), ...recorded.keys()]);
    const occupancyDrift: OccupancyDrift[] = [...driftKeys]
        .map((key) => {
            const slot = recorded.get(key);
            const [date, time] = slot ? [slot.date, slot.time] : [key.slice(0, 10), key.slice(11)];
            return { date, time, recorded: Number(slot?.count ?? 0), expected: expectedSeats.get(key) ?? 0 };
        })
        .filter((drift) => drift.recorded !== drift.expected)
        .sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`));

    // ---------------- review
    const review: ReviewItem[] = [];
    const futureUnassigned = located.filter((item) => item.appointment.status === 'approved'
        && item.start >= nowMs && !item.appointment.assignedTrainer);
    const pendingRefundReview = located.filter((item) => item.appointment.minutesRefundPendingReview === true);
    const skippedDeductions = current.filter((item) => item.appointment.status === 'approved' && item.appointment.minutesDeductionSkippedReason);
    const pendingCount = input.pendingApprovalCount
        ?? located.filter((item) => item.appointment.status === 'pending').length;
    const add = (item: ReviewItem) => { if (item.count > 0) review.push(item); };
    add({
        id: 'pending-approval', severity: 'warning', count: pendingCount,
        title: 'Citas pendientes de aprobación',
        description: 'Solicitudes de clientes o del panel que todavía no tienen respuesta.',
        link: { tab: 'appointments', status: 'pending' },
    });
    add({
        id: 'unassigned', severity: 'warning', count: futureUnassigned.length,
        title: 'Citas aprobadas sin entrenador',
        description: 'Sesiones futuras aprobadas que no tienen profesional asignado.',
        link: { tab: 'appointments', status: 'approved' },
    });
    add({
        id: 'occupancy-drift', severity: 'critical', count: occupancyDrift.length,
        title: 'Descuadres de aforo',
        description: `Franjas de los próximos ${UPCOMING_OCCUPANCY_CHECK_DAYS} días cuyo contador no coincide con las citas aprobadas.`,
        link: { tab: 'availability' },
    });
    add({
        id: 'expiring', severity: 'info', count: expiringSoon.length,
        title: 'Bonos próximos a caducar',
        description: `Bonos activos que caducan en ${EXPIRING_SOON_DAYS} días o menos.`,
        link: { tab: 'clients' },
    });
    add({
        id: 'low-minutes', severity: 'info', count: lowMinutes.length,
        title: 'Bonos casi agotados',
        description: `Bonos activos con ${LOW_MINUTES_THRESHOLD} min o menos.`,
        link: { tab: 'clients' },
    });
    add({
        id: 'pending-refunds', severity: 'critical', count: pendingRefundReview.length,
        title: 'Minutos pendientes de revisión manual',
        description: 'Devoluciones que no se pudieron abonar automáticamente.',
        link: { tab: 'appointments' },
    });
    add({
        id: 'skipped-deductions', severity: 'warning', count: skippedDeductions.length,
        title: 'Sesiones aprobadas sin descuento de minutos',
        description: 'El sistema no pudo descontar minutos al aprobarlas (sin bono válido o varios activos).',
        link: { tab: 'appointments', status: 'approved' },
    });
    add({
        id: 'multiple-bonos', severity: 'warning', count: multipleActiveBonos.length,
        title: 'Clientes con más de un bono activo',
        description: 'Impide que reserven desde la app hasta que quede un único bono activo.',
        link: { tab: 'clients' },
    });
    add({
        id: 'retention', severity: 'info', count: retention.length,
        title: 'Clientes sin actividad reciente',
        description: `Sin sesión en ${RETENTION_INACTIVE_DAYS} días o más y sin ninguna cita futura.`,
        link: { tab: 'clients' },
    });

    return {
        summary,
        training,
        trainers: trainerRows,
        cancellations,
        clients,
        occupancy,
        review,
        occupancyDrift,
        excludedWithoutSlot: withoutSlot,
        comparison: { startKey: comparable.startKey, endKey: comparable.endKey, partial: elapsedDays !== null },
        occupancyUntilKey,
    };
}

/** Relative change, or null when there is no base to compare with. */
export function relativeChange(comparison: { current: number | null; previous: number | null }): number | null {
    if (comparison.current === null || comparison.previous === null) return null;
    if (comparison.previous === 0) return comparison.current === 0 ? 0 : null;
    return (comparison.current - comparison.previous) / comparison.previous;
}

// ------------------------------------------------------------------ CSV

function csvCell(value: string | number): string {
    const text = String(value);
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `;`-separated with a BOM so Excel in Spanish opens accents and columns correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
    return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

export function trainersCsv(rows: readonly TrainerRow[]): string {
    return toCsv(
        ['Entrenador', 'Horas contabilizadas', 'Minutos contabilizados', 'Sesiones contabilizadas', 'Clientes atendidos', 'Próximas sesiones', 'Cancelaciones con cargo', 'Minutos cobrados sin entrenamiento'],
        rows.map((row) => [
            row.name,
            (row.countedMinutes / 60).toFixed(2).replace('.', ','),
            row.countedMinutes,
            row.countedSessions,
            row.uniqueClients,
            row.upcomingSessions,
            row.chargedCancellations,
            row.chargedMinutes,
        ]),
    );
}

const CSV_CATEGORY: Record<CancellationCategory, string> = {
    charged: 'Con cargo',
    not_charged: 'Sin cargo',
    unclassified: 'Sin clasificar',
};

export function cancellationsCsv(records: readonly CancellationRecord[]): string {
    return toCsv(
        ['Fecha', 'Hora', 'Cliente', 'Entrenador', 'Duración (min)', 'Modalidad', 'Minutos cobrados', 'Cancelada por', 'Cancelada el'],
        records.map((record) => [
            record.date, record.time, record.clientName, record.trainerName, record.duration,
            CSV_CATEGORY[record.category], record.chargedMinutes, record.cancelledBy, record.cancelledAt,
        ]),
    );
}
