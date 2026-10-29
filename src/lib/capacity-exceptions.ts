import type { SiteConfig } from '@/types';
import { normalizeMaxCapacity } from '@/lib/site-config';

/**
 * Aforo por fecha. Mirror of functions/src/capacityExceptions.ts: a document
 * `capacity_exceptions/{YYYY-MM-DD}` replaces the global `maxCapacity` for
 * every slot of that Madrid civil day. The server always decides; the web
 * only shows the same value.
 */

export const CAPACITY_EXCEPTIONS_COLLECTION = 'capacity_exceptions';
export const MAX_CAPACITY_EXCEPTION_DATES = 62;

/** Effective capacity per date that has an exception. Dates without one use the global value. */
export type CapacityByDate = Readonly<Record<string, number>>;

export interface CapacityException {
    date: string;
    maxCapacity: number;
    updatedAt?: string;
    updatedByEmail?: string;
}

/** Stored capacity, or undefined when the document is unusable (the date falls back to global). */
export function parseCapacityExceptionCapacity(data: unknown): number | undefined {
    const raw = (data as { maxCapacity?: unknown } | undefined)?.maxCapacity;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? normalizeMaxCapacity(parsed) : undefined;
}

export function parseCapacityException(id: string, data: unknown): CapacityException | undefined {
    const maxCapacity = parseCapacityExceptionCapacity(data);
    if (maxCapacity === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return undefined;
    const record = data as { updatedAt?: unknown; updatedByEmail?: unknown };
    return {
        date: id,
        maxCapacity,
        ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
        ...(typeof record.updatedByEmail === 'string' ? { updatedByEmail: record.updatedByEmail } : {}),
    };
}

export function resolveMaxCapacity(
    config: Pick<SiteConfig, 'maxCapacity'>,
    capacityByDate: CapacityByDate | undefined,
    date: string,
): number {
    return capacityByDate?.[date] ?? config.maxCapacity;
}

export function capacityByDateFrom(exceptions: CapacityException[]): Record<string, number> {
    return Object.fromEntries(exceptions.map((item) => [item.date, item.maxCapacity]));
}
