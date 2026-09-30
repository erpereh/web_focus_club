export interface EmailAddress {
  email: string;
  name?: string;
}

export type EmailCategory =
  | "appointment_customer"
  | "appointment_admin"
  | "welcome"
  | "contact"
  | "customer_suggestion";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMessage extends RenderedEmail {
  category: EmailCategory;
  to: EmailAddress[];
  replyTo?: EmailAddress;
  tags?: string[];
}

export interface SendOptions {
  /** Deterministic key reused across every retry of the same logical send. */
  idempotencyKey: string;
}

export interface SendResult {
  messageId: string;
}

export interface EmailClient {
  send(message: EmailMessage, options: SendOptions): Promise<SendResult>;
}

export type EmailDispatchStatus = "sending" | "sent" | "failed";

export interface EmailDispatchContext {
  /** Domain id the email relates to (appointmentId, uid, suggestionId...). */
  relatedId?: string;
  recipientType?: "customer" | "admin";
}

export type EmailDispatchOutcome =
  | { status: "sent"; messageId: string; dispatchId: string }
  | { status: "skipped"; reason: "already_sent" | "in_progress"; dispatchId: string };
