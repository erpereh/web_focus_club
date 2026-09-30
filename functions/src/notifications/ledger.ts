import { createHash } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

export type LedgerStatus = "sending" | "sent" | "failed";

export type LedgerClaim =
  | { claimed: true; ref: DocumentReference }
  | { claimed: false; reason: "already_sent" | "in_progress"; ref: DocumentReference };

interface LedgerDoc {
  status?: LedgerStatus;
  leaseUntilMillis?: number;
  attempts?: number;
}

export function dispatchIdFor(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey).digest("hex");
}

function iso(millis: number): string {
  return new Date(millis).toISOString();
}

/**
 * At-most-once claim on a ledger document. `sent` is final; `sending` is a
 * temporary lease that can be reclaimed once `leaseUntilMillis` has passed;
 * `failed` (or missing) can always be claimed again.
 */
export async function claimLedger(
  db: Firestore,
  collection: string,
  dispatchId: string,
  metadata: Record<string, unknown>,
  nowMillis: number,
  leaseMs: number,
): Promise<LedgerClaim> {
  const ref = db.collection(collection).doc(dispatchId);
  return db.runTransaction<LedgerClaim>(async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists ? snap.data() as LedgerDoc : undefined;

    if (existing?.status === "sent") return { claimed: false, reason: "already_sent", ref };
    if (existing?.status === "sending"
      && typeof existing.leaseUntilMillis === "number"
      && existing.leaseUntilMillis > nowMillis) {
      return { claimed: false, reason: "in_progress", ref };
    }

    transaction.set(ref, {
      ...metadata,
      status: "sending" satisfies LedgerStatus,
      sendingAt: iso(nowMillis),
      leaseUntilMillis: nowMillis + leaseMs,
      attempts: (existing?.attempts ?? 0) + 1,
      updatedAt: iso(nowMillis),
      ...(existing ? {} : { createdAt: iso(nowMillis) }),
    }, { merge: true });
    return { claimed: true, ref };
  });
}

export async function markLedgerSent(
  ref: DocumentReference,
  nowMillis: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await ref.set({
    ...extra,
    status: "sent" satisfies LedgerStatus,
    leaseUntilMillis: null,
    lastError: null,
    sentAt: iso(nowMillis),
    updatedAt: iso(nowMillis),
  }, { merge: true });
}

export async function markLedgerFailed(
  ref: DocumentReference,
  nowMillis: number,
  errorMessage: string,
): Promise<void> {
  await ref.set({
    status: "failed" satisfies LedgerStatus,
    leaseUntilMillis: null,
    lastError: errorMessage,
    failedAt: iso(nowMillis),
    updatedAt: iso(nowMillis),
  }, { merge: true });
}
