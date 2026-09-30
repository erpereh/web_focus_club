import { defineSecret } from "firebase-functions/params";
import type { EmailAddress, EmailClient, EmailMessage, SendOptions, SendResult } from "./types.js";

export const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

export const BREVO_SMTP_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
export const DEFAULT_SENDER: EmailAddress = { name: "Focus Club", email: "info@focusclub.es" };

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class BrevoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable = false) {
    super(`Brevo API error ${status}${code ? ` (${code})` : ""}: ${message}`);
    this.name = "BrevoApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface BrevoClientOptions {
  apiKey: string;
  sender?: EmailAddress;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Removes anything that could leak secrets from an error before it is logged
 * or persisted: URLs, Brevo API keys and overly long payload echoes.
 */
export function sanitizeEmailError(error: unknown, fallback = "Unknown email error."): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return (raw || fallback)
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .replace(/xkeysib-[A-Za-z0-9-]+/g, "[redacted-key]")
    .replace(/xsmtpsib-[A-Za-z0-9-]+/g, "[redacted-key]")
    .slice(0, 180);
}

function toBrevoAddress(address: EmailAddress): { email: string; name?: string } {
  return address.name ? { email: address.email, name: address.name } : { email: address.email };
}

export function buildBrevoPayload(
  message: EmailMessage,
  sender: EmailAddress,
  idempotencyKey: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sender: toBrevoAddress(sender),
    to: message.to.map(toBrevoAddress),
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
    tags: [message.category, ...(message.tags ?? [])],
    // Brevo deduplicates transactional sends by this key for 30 minutes.
    headers: { idempotencyKey },
  };
  if (message.replyTo) payload.replyTo = toBrevoAddress(message.replyTo);
  return payload;
}

async function readErrorBody(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === "string" ? body.code : "",
      message: typeof body.message === "string" ? body.message : response.statusText,
    };
  } catch {
    return { code: "", message: response.statusText || "Unknown error" };
  }
}

export function createBrevoClient({
  apiKey,
  sender = DEFAULT_SENDER,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  maxRetries = 2,
  retryDelayMs = 500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: BrevoClientOptions): EmailClient {
  return {
    async send(message: EmailMessage, { idempotencyKey }: SendOptions): Promise<SendResult> {
      if (!apiKey || !apiKey.trim()) {
        throw new Error("BREVO_API_KEY is not configured.");
      }
      if (!idempotencyKey) {
        throw new Error("An idempotency key is required to send email.");
      }
      if (message.to.length === 0) {
        throw new Error("Email has no recipients.");
      }

      const body = JSON.stringify(buildBrevoPayload(message, sender, idempotencyKey));
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1));

        let response: Response;
        try {
          response = await fetchImpl(BREVO_SMTP_EMAIL_URL, {
            method: "POST",
            headers: {
              "accept": "application/json",
              "content-type": "application/json",
              "api-key": apiKey,
              "Idempotency-Key": idempotencyKey,
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          // Timeout or network failure: Brevo may or may not have accepted the
          // request, so retry with the same idempotency key.
          lastError = new Error(`Brevo request failed: ${sanitizeEmailError(error)}`);
          continue;
        }

        if (response.ok) {
          const data = await response.json().catch(() => ({})) as { messageId?: unknown };
          const messageId = typeof data.messageId === "string" ? data.messageId : "";
          return { messageId };
        }

        const { code, message: errorMessage } = await readErrorBody(response);
        const retryable = RETRYABLE_STATUS.has(response.status);
        lastError = new BrevoApiError(response.status, code, sanitizeEmailError(errorMessage), retryable);
        if (!retryable) throw lastError;
      }

      throw lastError instanceof Error ? lastError : new Error("Brevo request failed.");
    },
  };
}

/** Lazily builds a client from the Secret Manager value at call time. */
export function getBrevoClient(): EmailClient {
  return createBrevoClient({ apiKey: BREVO_API_KEY.value() });
}
