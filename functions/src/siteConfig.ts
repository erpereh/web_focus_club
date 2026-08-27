export const DEFAULT_MAX_CAPACITY = 2;
export const MIN_MAX_CAPACITY = 1;
export const MAX_MAX_CAPACITY = 10;

export interface SiteConfig {
  startHour: number;
  endHour: number;
  slotInterval: number;
  bonoExpirationMonths: number;
  maxCapacity: number;
  maintenanceMode?: boolean;
  sessionDuration?: number;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  startHour: 8,
  endHour: 20,
  slotInterval: 30,
  bonoExpirationMonths: 1,
  maintenanceMode: false,
  maxCapacity: DEFAULT_MAX_CAPACITY,
};

function normalizeSlotInterval(value: unknown): number {
  return value === 30 || value === 45 || value === 60 ? value : DEFAULT_SITE_CONFIG.slotInterval;
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
