import { addUtcDays } from "./recurringAppointments.js";
import type { SlotTimeSlot } from "./slotValidation.js";

/**
 * Pattern of one approved recurring series of the previous bono, taken from
 * its latest approved occurrence (which already reflects reschedules).
 */
export interface RenewalSourceSeries {
  seriesId: string;
  intervalDays: number;
  durationMinutes: number;
  serviceType: string;
  sessionType: string;
  trainerId: string | null;
  lastSlot: SlotTimeSlot;
}

/** One appointment the renewal would try to create. */
export interface RenewalCandidate {
  key: string;
  sourceSeriesId: string;
  originalSlot: SlotTimeSlot;
  slot: SlotTimeSlot;
  durationMinutes: number;
  trainerId: string | null;
  serviceType: string;
  sessionType: string;
}

const MAX_STEPS_PER_SERIES = 400;
export const MAX_RENEWAL_ITEMS = 60;

export function renewalItemKey(seriesId: string, originalDate: string): string {
  return `${seriesId}:${originalDate}`;
}

/**
 * Continues each series' cadence from its last occurrence (so weekly series
 * keep their weekday) and keeps the dates inside the new bono's period,
 * never before `firstAllowedDate` (tomorrow in Madrid). Sorted chronologically.
 */
export function planRenewalCandidates(
  series: RenewalSourceSeries[],
  periodStart: string,
  periodEnd: string,
  firstAllowedDate: string,
): RenewalCandidate[] {
  const from = periodStart > firstAllowedDate ? periodStart : firstAllowedDate;
  const candidates: RenewalCandidate[] = [];
  for (const source of series) {
    if (!Number.isInteger(source.intervalDays) || source.intervalDays < 1) continue;
    let date = source.lastSlot.date;
    for (let step = 0; step < MAX_STEPS_PER_SERIES; step += 1) {
      date = addUtcDays(date, source.intervalDays);
      if (date > periodEnd) break;
      if (date < from) continue;
      const slot = { date, time: source.lastSlot.time };
      candidates.push({
        key: renewalItemKey(source.seriesId, date),
        sourceSeriesId: source.seriesId,
        originalSlot: slot,
        slot,
        durationMinutes: source.durationMinutes,
        trainerId: source.trainerId,
        serviceType: source.serviceType,
        sessionType: source.sessionType,
      });
    }
  }
  return candidates.sort((a, b) => `${a.slot.date}T${a.slot.time}|${a.sourceSeriesId}`
    .localeCompare(`${b.slot.date}T${b.slot.time}|${b.sourceSeriesId}`));
}

export function slotsEqual(a: SlotTimeSlot | null | undefined, b: SlotTimeSlot | null | undefined): boolean {
  return Boolean(a && b && a.date === b.date && a.time === b.time);
}
