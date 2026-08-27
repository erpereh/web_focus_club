import type { SiteConfig } from '@/types';

export const DEFAULT_MAX_CAPACITY = 2;
export const MIN_MAX_CAPACITY = 1;
export const MAX_MAX_CAPACITY = 10;

export const DEFAULT_SITE_CONFIG: SiteConfig = {
    startHour: 8,
    endHour: 20,
    slotInterval: 30,
    bonoExpirationMonths: 1,
    maintenanceMode: false,
    maxCapacity: DEFAULT_MAX_CAPACITY,
};

const ALLOWED_SLOT_INTERVALS = [30, 45, 60] as const;

export function normalizeMaxCapacity(value: unknown): number {
    if (value == null || value === '') return DEFAULT_MAX_CAPACITY;

    const parsed = typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint'
        ? Number(value)
        : NaN;

    if (!Number.isFinite(parsed)) return DEFAULT_MAX_CAPACITY;

    return Math.min(MAX_MAX_CAPACITY, Math.max(MIN_MAX_CAPACITY, Math.trunc(parsed)));
}

export function normalizeSlotInterval(value: unknown): number {
    return ALLOWED_SLOT_INTERVALS.includes(value as 30 | 45 | 60) ? Number(value) : 30;
}

export function normalizeHour(value: unknown, fallback: number): number {
    const hour = Number(value);
    if (!Number.isFinite(hour)) return fallback;
    return Math.max(0, Math.min(23, Math.trunc(hour)));
}

export function normalizeSiteConfig(config: Partial<SiteConfig> = {}): SiteConfig {
    let startHour = normalizeHour(config.startHour, DEFAULT_SITE_CONFIG.startHour);
    let endHour = normalizeHour(config.endHour, DEFAULT_SITE_CONFIG.endHour);

    if (startHour >= endHour) {
        startHour = DEFAULT_SITE_CONFIG.startHour;
        endHour = DEFAULT_SITE_CONFIG.endHour;
    }

    const expirationMonths = Number(config.bonoExpirationMonths ?? DEFAULT_SITE_CONFIG.bonoExpirationMonths);

    return {
        ...DEFAULT_SITE_CONFIG,
        ...config,
        startHour,
        endHour,
        slotInterval: normalizeSlotInterval(config.slotInterval ?? config.sessionDuration),
        bonoExpirationMonths: Number.isFinite(expirationMonths) ? Math.max(1, Math.trunc(expirationMonths)) : 1,
        maintenanceMode: Boolean(config.maintenanceMode),
        maxCapacity: normalizeMaxCapacity(config.maxCapacity),
    };
}

export function sanitizeSiteConfigUpdate(data: Partial<SiteConfig>): Partial<SiteConfig> {
    const sanitized: Partial<SiteConfig> = {};

    if ('slotInterval' in data || 'sessionDuration' in data) {
        sanitized.slotInterval = normalizeSlotInterval(data.slotInterval ?? data.sessionDuration);
    }

    if ('startHour' in data) {
        sanitized.startHour = normalizeHour(data.startHour, DEFAULT_SITE_CONFIG.startHour);
    }

    if ('endHour' in data) {
        sanitized.endHour = normalizeHour(data.endHour, DEFAULT_SITE_CONFIG.endHour);
    }

    if ('bonoExpirationMonths' in data) {
        const expirationMonths = Number(data.bonoExpirationMonths ?? DEFAULT_SITE_CONFIG.bonoExpirationMonths);
        sanitized.bonoExpirationMonths = Number.isFinite(expirationMonths)
            ? Math.max(1, Math.trunc(expirationMonths))
            : DEFAULT_SITE_CONFIG.bonoExpirationMonths;
    }

    if ('maintenanceMode' in data) {
        sanitized.maintenanceMode = Boolean(data.maintenanceMode);
    }

    if ('maxCapacity' in data) {
        sanitized.maxCapacity = normalizeMaxCapacity(data.maxCapacity);
    }

    return sanitized;
}
