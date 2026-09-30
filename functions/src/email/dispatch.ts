import type { Firestore } from "firebase-admin/firestore";
import { claimLedger, dispatchIdFor, markLedgerFailed, markLedgerSent } from "../notifications/ledger.js";
import { sanitizeEmailError } from "./brevo.js";
import type {
  EmailClient,
  EmailDispatchContext,
  EmailDispatchOutcome,
  EmailMessage,
} from "./types.js";

export const EMAIL_DISPATCH_COLLECTION = "email_dispatches";
/** Must exceed the Brevo client's worst case (timeout x attempts + backoff). */
export const EMAIL_DISPATCH_LEASE_MS = 2 * 60 * 1000;

export interface SendEmailOnceInput {
  db: Firestore;
  client: EmailClient;
  dedupeKey: string;
  message: EmailMessage;
  context?: EmailDispatchContext;
  now?: () => number;
  leaseMs?: number;
}

export function emailDispatchId(dedupeKey: string): string {
  return dispatchIdFor(dedupeKey);
}

/** Deterministic UUID-shaped key derived from the dedupe key. */
export function emailIdempotencyKey(dedupeKey: string): string {
  const hex = emailDispatchId(dedupeKey);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Sends an email at most once per dedupe key. A Firestore ledger guards
 * against duplicate trigger deliveries; a `sending` claim is a temporary lease
 * that can be reclaimed once it expires. Brevo's idempotency key (identical on
 * every retry) covers requests Brevo accepted but whose response was lost.
 */
export async function sendEmailOnce({
  db,
  client,
  dedupeKey,
  message,
  context = {},
  now = () => Date.now(),
  leaseMs = EMAIL_DISPATCH_LEASE_MS,
}: SendEmailOnceInput): Promise<EmailDispatchOutcome> {
  const dispatchId = emailDispatchId(dedupeKey);
  const claim = await claimLedger(db, EMAIL_DISPATCH_COLLECTION, dispatchId, {
    category: message.category,
    recipientType: context.recipientType ?? null,
    relatedId: context.relatedId ?? null,
  }, now(), leaseMs);

  if (!claim.claimed) {
    console.log("[Email] Duplicate send skipped", {
      category: message.category,
      reason: claim.reason,
      dispatchId,
      relatedId: context.relatedId,
    });
    return { status: "skipped", reason: claim.reason, dispatchId };
  }

  let messageId: string;
  try {
    ({ messageId } = await client.send(message, { idempotencyKey: emailIdempotencyKey(dedupeKey) }));
  } catch (error) {
    const errorMessage = sanitizeEmailError(error);
    try {
      await markLedgerFailed(claim.ref, now(), errorMessage);
    } catch (writeError) {
      console.error("[Email] Failed to store dispatch failure", {
        dispatchId,
        error: sanitizeEmailError(writeError),
      });
    }
    throw new Error(errorMessage);
  }

  try {
    await markLedgerSent(claim.ref, now(), { messageId });
  } catch (writeError) {
    // The email went out; a later reclaim is still covered by Brevo's key.
    console.error("[Email] Failed to store dispatch success", {
      dispatchId,
      messageId,
      error: sanitizeEmailError(writeError),
    });
  }

  console.log("[Email] Sent", {
    category: message.category,
    recipientType: context.recipientType,
    relatedId: context.relatedId,
    dispatchId,
    messageId,
  });
  return { status: "sent", messageId, dispatchId };
}

/** Variant for background triggers: logs failures instead of throwing. */
export async function sendEmailOnceSafely(input: SendEmailOnceInput): Promise<EmailDispatchOutcome | undefined> {
  try {
    return await sendEmailOnce(input);
  } catch (error) {
    console.error("[Email] Failed to send", {
      category: input.message.category,
      recipientType: input.context?.recipientType,
      relatedId: input.context?.relatedId,
      error: sanitizeEmailError(error),
    });
    return undefined;
  }
}
