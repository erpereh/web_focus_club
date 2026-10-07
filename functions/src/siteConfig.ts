export type SlotInterval = 15 | 30 | 45 | 60;

export const DEFAULT_MAX_CAPACITY = 2;
export const MIN_MAX_CAPACITY = 1;
export const MAX_MAX_CAPACITY = 10;

export interface SiteConfig {
  startHour: number;
  endHour: number;
  slotInterval: SlotInterval;
  bonoExpirationMonths: number;
  maxCapacity: number;
  /** Bono sizes offered when assigning a bono, in minutes, in display order. */
  bonoSizesMinutes: number[];
  /** Minimum hours between "now" and the start of a customer booking. 0 = no limit. */
  minBookingNoticeHours: number;
  maintenanceMode?: boolean;
  sessionDuration?: number;
}

export const DEFAULT_BONO_SIZES_MINUTES: readonly number[] = [240, 360, 480];
export const BONO_SIZE_STEP_MINUTES = 30;
export const MAX_BONO_SIZES = 20;
export const MAX_BONO_SIZE_MINUTES = 100 * 60;

/**
 * Keeps valid, unique sizes in their configured order. Anything unusable
 * falls back to the historical 4h / 6h / 8h so assigning a bono never breaks.
 */
export function normalizeBonoSizesMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_BONO_SIZES_MINUTES];
  const sizes: number[] = [];
  for (const entry of value) {
    const minutes = typeof entry === "number" ? entry : Number(entry);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_BONO_SIZE_MINUTES) continue;
    if (minutes % BONO_SIZE_STEP_MINUTES !== 0 || sizes.includes(minutes)) continue;
    sizes.push(minutes);
    if (sizes.length === MAX_BONO_SIZES) break;
  }
  return sizes.length ? sizes : [...DEFAULT_BONO_SIZES_MINUTES];
}

export const MAX_MIN_BOOKING_NOTICE_HOURS = 720;

/** Integer hours >= 0. Missing or invalid values mean "no notice" (legacy behaviour). */
export function normalizeMinBookingNoticeHours(value: unknown): number {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_MIN_BOOKING_NOTICE_HOURS, Math.trunc(parsed));
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  startHour: 8,
  endHour: 20,
  slotInterval: 30,
  bonoExpirationMonths: 1,
  maintenanceMode: false,
  maxCapacity: DEFAULT_MAX_CAPACITY,
  bonoSizesMinutes: [...DEFAULT_BONO_SIZES_MINUTES],
  minBookingNoticeHours: 0,
};

export function normalizeSlotInterval(value: unknown): SlotInterval {
  const parsed = Number(value);
  return parsed === 15 || parsed === 30 || parsed === 45 || parsed === 60
    ? parsed
    : DEFAULT_SITE_CONFIG.slotInterval;
}

function normalizeHour(value: unknown, fallback: number): number {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.max(0, Math.min(23, Math.trunc(hour)));
}

export function normalizeMaxCapacity(value: unknown): number {
  if (value == null || value === "") return DEFAULT_MAX_CAPACITY;

  const parsed = typeof value === "number" || typeof value === "string" || typeof value === "bigint"
    ? Number(value)
    : NaN;

  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CAPACITY;

  return Math.min(MAX_MAX_CAPACITY, Math.max(MIN_MAX_CAPACITY, Math.trunc(parsed)));
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
    bonoSizesMinutes: normalizeBonoSizesMinutes(config.bonoSizesMinutes),
    minBookingNoticeHours: normalizeMinBookingNoticeHours(config.minBookingNoticeHours),
  };
}

export function generateTimeSlots(config: Partial<SiteConfig> = {}): string[] {
  const normalizedConfig = normalizeSiteConfig(config);
  const slots: string[] = [];
  const startMinutes = normalizedConfig.startHour * 60;
  const endMinutes = normalizedConfig.endHour * 60;
  for (let minute = startMinutes; minute < endMinutes; minute += normalizedConfig.slotInterval) {
    const hour = Math.floor(minute / 60);
    const min = minute % 60;
    slots.push(`${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

export function doesSessionFitWithinSchedule(
  config: Partial<SiteConfig> = {},
  startTime: string,
  durationMinutes: number,
): boolean {
  const normalizedConfig = normalizeSiteConfig(config);
  const [hours, minutes] = startTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(durationMinutes)) return false;

  const startMinutes = hours * 60 + minutes;
  const scheduleStart = normalizedConfig.startHour * 60;
  const scheduleEnd = normalizedConfig.endHour * 60;

  return startMinutes >= scheduleStart && startMinutes + durationMinutes <= scheduleEnd;
}
