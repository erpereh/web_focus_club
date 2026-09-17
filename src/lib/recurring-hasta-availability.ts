import type { SiteConfig } from '@/types';
import { getSlotBlocks, slotOccupancyKey, doesSessionFitWithinSchedule, generateTimeSlots } from '@/lib/appointment-slots';
import { generateRecurringOccurrenceDates, type RecurringEndDateOption } from '@/lib/recurring-appointments';
import { classifyMadridCivilSlot } from '@/lib/madrid-date';
import { normalizeSiteConfig } from '@/lib/site-config';

export type RecurringHastaAvailability =
    | 'available'
    | 'blocked'
    | 'full'
    | 'conflict'
    | 'outside_schedule'
    | 'past';

export type RecurringHastaAvailabilityPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface RecurringHastaOptionStatus {
    option: RecurringEndDateOption;
    availability: RecurringHastaAvailability;
    problemDate?: string;
    problemTime?: string;
    message?: string;
}

function formatDateShort(isoDate: string): string {
    const [, month, day] = isoDate.split('-');
    return `${day}/${month}`;
}

function formatDateEs(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
}

function evaluateOccurrence(input: {
    date: string;
    startTime: string;
    durationMinutes: number;
    occupancy: Record<string, number>;
    occupancyCreditsByKey: Map<string, number>;
    blockedKeys: Set<string>;
    userBookedSlotKeys: Set<string>;
    siteConfig: SiteConfig;
    now: Date;
}): Omit<RecurringHastaOptionStatus, 'option'> | null {
    const config = normalizeSiteConfig(input.siteConfig);
    const maxCapacity = config.maxCapacity;
    const dateShort = formatDateShort(input.date);
    const dateEs = formatDateEs(input.date);

    if (!classifyMadridCivilSlot({ date: input.date, time: input.startTime }, input.now).isFuture) {
        return {
            availability: 'past',
            problemDate: input.date,
            problemTime: input.startTime,
            message: `La franja del ${dateShort} a las ${input.startTime} ya no está disponible.`,
        };
    }

    const validTimes = new Set(generateTimeSlots(config));
    if (!validTimes.has(input.startTime) || !doesSessionFitWithinSchedule(config, input.startTime, input.durationMinutes)) {
        return {
            availability: 'outside_schedule',
            problemDate: input.date,
            problemTime: input.startTime,
            message: `La franja del ${dateShort} no es válida para el horario configurado.`,
        };
    }

    const keys = getSlotBlocks(input.startTime, input.durationMinutes).map(
        (time) => slotOccupancyKey(input.date, time),
    );

    if (keys.some((key) => input.blockedKeys.has(key))) {
        return {
            availability: 'blocked',
            problemDate: input.date,
            problemTime: input.startTime,
            message: `La sesión del ${dateShort} está bloqueada.`,
        };
    }

    const effectiveCounts = keys.map((key) => Math.max(
        0,
        (input.occupancy[key] ?? 0) - (input.occupancyCreditsByKey.get(key) ?? 0),
    ));
    if (effectiveCounts.some((count) => count >= maxCapacity)) {
        return {
            availability: 'full',
            problemDate: input.date,
            problemTime: input.startTime,
            message: `Franja completa el ${dateShort}`,
        };
    }

    if (keys.some((key) => input.userBookedSlotKeys.has(key))) {
        return {
            availability: 'conflict',
            problemDate: input.date,
            problemTime: input.startTime,
            message: `Ya tienes una sesión que se solapa el ${dateEs}.`,
        };
    }

    return null;
}

export function evaluateRecurringHastaOptions(input: {
    startDate: string;
    startTime: string;
    intervalDays: number;
    durationMinutes: number;
    options: RecurringEndDateOption[];
    occupancy: Record<string, number>;
    occupancyCreditsByKey?: Map<string, number>;
    blockedKeys: Set<string>;
    userBookedSlotKeys: Set<string>;
    siteConfig: SiteConfig;
    now: Date;
}): RecurringHastaOptionStatus[] {
    let firstProblem: Omit<RecurringHastaOptionStatus, 'option'> | null = null;
    const checkedDates = new Set<string>();

    return input.options.map((option) => {
        if (!firstProblem) {
            const dates = generateRecurringOccurrenceDates(input.startDate, input.intervalDays, option.endDate);
            for (const date of dates) {
                if (checkedDates.has(date)) continue;
                checkedDates.add(date);
                firstProblem = evaluateOccurrence({
                    date,
                    startTime: input.startTime,
                    durationMinutes: input.durationMinutes,
                    occupancy: input.occupancy,
                    occupancyCreditsByKey: input.occupancyCreditsByKey ?? new Map(),
                    blockedKeys: input.blockedKeys,
                    userBookedSlotKeys: input.userBookedSlotKeys,
                    siteConfig: input.siteConfig,
                    now: input.now,
                });
                if (firstProblem) break;
            }
        }

        if (!firstProblem) {
            return { option, availability: 'available' };
        }
        return { option, ...firstProblem };
    });
}

export function sanitizeRecurringEndDateByAvailability(
    selectedEndDate: string,
    statuses: RecurringHastaOptionStatus[] | undefined,
    phase: RecurringHastaAvailabilityPhase,
): string {
    if (!selectedEndDate) return '';
    if (phase !== 'ready' || !statuses) return selectedEndDate;
    const status = statuses.find((item) => item.option.endDate === selectedEndDate);
    if (!status || status.availability !== 'available') return '';
    return selectedEndDate;
}
