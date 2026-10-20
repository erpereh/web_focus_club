/**
 * Client side of the admin override flow (functions/src/adminBookingOverrides.ts).
 * The server lists every restriction of a booking in a `failed-precondition`
 * error with `details.reason === 'admin_override_required'`; the admin then
 * confirms them and the request is sent again with the same `requestId`.
 */

export type AdminOverridableReason =
    | 'slot_not_future'
    | 'same_day_booking_disabled'
    | 'booking_notice_too_short'
    | 'outside_schedule'
    | 'slot_blocked'
    | 'slot_full';

export interface AdminRestriction {
    date: string;
    time: string;
    reason: AdminOverridableReason;
    occupancy?: number;
    maxCapacity?: number;
}

export interface AdminOverridePrompt {
    restrictions: AdminRestriction[];
    fingerprint: string;
    requiresPastConfirmation: boolean;
    /** The admin had confirmed a different list: conditions changed meanwhile. */
    changed: boolean;
}

export interface AdminRestrictionGroup {
    date: string;
    time: string;
    restrictions: AdminRestriction[];
}

export const ADMIN_RESTRICTION_LABELS: Record<AdminOverridableReason, string> = {
    slot_not_future: 'Fecha y hora ya pasadas',
    same_day_booking_disabled: 'Reservas para el mismo día desactivadas',
    booking_notice_too_short: 'Antelación mínima insuficiente',
    outside_schedule: 'Fuera del horario configurado',
    slot_blocked: 'Franja bloqueada',
    slot_full: 'Aforo completo',
};

const REASONS = new Set<string>(Object.keys(ADMIN_RESTRICTION_LABELS));

function isRestriction(value: unknown): value is AdminRestriction {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.date === 'string'
        && typeof item.time === 'string'
        && typeof item.reason === 'string'
        && REASONS.has(item.reason);
}

/** Reads the confirmation request from a callable error's `details`, if it is one. */
export function parseAdminOverridePrompt(details: Record<string, unknown> | undefined): AdminOverridePrompt | undefined {
    if (details?.reason !== 'admin_override_required') return undefined;
    if (typeof details.fingerprint !== 'string' || !Array.isArray(details.restrictions)) return undefined;
    const restrictions = details.restrictions.filter(isRestriction);
    if (restrictions.length === 0) return undefined;
    return {
        restrictions,
        fingerprint: details.fingerprint,
        requiresPastConfirmation: details.requiresPastConfirmation === true,
        changed: details.changed === true,
    };
}

export function describeAdminRestriction(restriction: AdminRestriction): string {
    const label = ADMIN_RESTRICTION_LABELS[restriction.reason];
    if (restriction.reason === 'slot_full' && typeof restriction.occupancy === 'number' && typeof restriction.maxCapacity === 'number') {
        return `${label}: ${restriction.occupancy}/${restriction.maxCapacity} personas (quedaría en ${restriction.occupancy + 1}/${restriction.maxCapacity})`;
    }
    return label;
}

/** One entry per affected session, in date/time order. */
export function groupAdminRestrictions(restrictions: AdminRestriction[]): AdminRestrictionGroup[] {
    const groups = new Map<string, AdminRestrictionGroup>();
    restrictions.forEach((restriction) => {
        const key = `${restriction.date}T${restriction.time}`;
        const group = groups.get(key) ?? { date: restriction.date, time: restriction.time, restrictions: [] };
        group.restrictions.push(restriction);
        groups.set(key, group);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, group]) => group);
}

/** Idempotency key for one admin booking submission (kept across confirmations and retries). */
export function newAdminBookingRequestId(): string {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Quarter-hour start that ends by midnight: the same rule the server applies. */
export function isValidAdminSlotTime(time: string, durationMinutes: number): boolean {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) return false;
    const start = Number(match[1]) * 60 + Number(match[2]);
    return start % 15 === 0 && start + durationMinutes <= 24 * 60;
}
