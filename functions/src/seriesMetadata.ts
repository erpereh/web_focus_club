import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import {
  calculateActiveSeriesMetadata,
  type ReplacementAppointmentData,
} from "./recurringScheduleReplacement.js";

/**
 * Keeps `appointment_recurrences` metadata (`occurrenceCount`, `totalMinutes`,
 * `future*`) equal to the active occurrences after one occurrence leaves the
 * series individually (cancelled or deleted). Series status is not changed.
 */

export interface SeriesOccurrenceSnapshot {
  id: string;
  data: ReplacementAppointmentData;
}

export interface SeriesReadResult {
  seriesRef: DocumentReference;
  exists: boolean;
  occurrences: SeriesOccurrenceSnapshot[];
}

/** Read phase: the series document and all its occurrences. */
export async function readSeriesForOccurrence(
  transaction: Transaction,
  db: Firestore,
  seriesId: string,
): Promise<SeriesReadResult> {
  const seriesRef = db.collection("appointment_recurrences").doc(seriesId);
  const [seriesSnap, occurrencesSnap] = await Promise.all([
    transaction.get(seriesRef),
    transaction.get(db.collection("appointments").where("recurrenceSeriesId", "==", seriesId)),
  ]);
  return {
    seriesRef,
    exists: seriesSnap.exists,
    occurrences: occurrencesSnap.docs.map((snap) => ({ id: snap.id, data: snap.data() as ReplacementAppointmentData })),
  };
}

/**
 * Patch for the series after `changes` (id → new status, or null = deleted).
 * Returns undefined when the metadata cannot be computed (invalid data); the
 * caller then leaves the series untouched rather than writing wrong numbers.
 */
export function seriesMetadataPatch(
  occurrences: SeriesOccurrenceSnapshot[],
  changes: Map<string, string | null>,
  now: Date,
  deleteField: () => unknown,
): Record<string, unknown> | undefined {
  const remaining = occurrences
    .filter((occurrence) => changes.get(occurrence.id) !== null)
    .map((occurrence) => ({
      data: occurrence.data,
      ...(changes.has(occurrence.id) ? { statusOverride: changes.get(occurrence.id) as string } : {}),
    }));
  const metadata = calculateActiveSeriesMetadata(remaining, now);
  if (!metadata) return undefined;
  return {
    occurrenceCount: metadata.occurrenceCount,
    totalMinutes: metadata.totalMinutes,
    futureOccurrenceCount: metadata.futureOccurrenceCount,
    futureStartDate: metadata.futureStartDate ?? deleteField(),
    futureStartTime: metadata.futureStartTime ?? deleteField(),
    futureEndDate: metadata.futureEndDate ?? deleteField(),
    updatedAt: now.toISOString(),
  };
}
