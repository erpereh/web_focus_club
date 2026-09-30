import type { Firestore } from "firebase-admin/firestore";
import type { CustomerSuggestionEmailEvent } from "../customerSuggestions.js";
import { sendEmailOnce, sendEmailOnceSafely } from "./dispatch.js";
import {
  appointmentAdminEmail,
  type AppointmentEmailData,
  appointmentCustomerEmail,
  contactEmail,
  type ContactEmailData,
  customerSuggestionEmail,
  welcomeEmail,
} from "./templates/index.js";
import type { EmailClient, EmailDispatchOutcome, EmailMessage } from "./types.js";

export const ADMIN_NOTIFICATION_EMAIL = "infofocusclub2026@gmail.com";
export const SUGGESTIONS_RECIPIENT_EMAIL = "info@focusclub.es";

export interface EmailDeps {
  db: Firestore;
  client: EmailClient;
  now?: () => number;
}

export type RecipientType = "customer" | "admin";

export function buildAppointmentEmailMessage(
  data: AppointmentEmailData,
  recipientType: RecipientType,
  recipientEmail: string,
): EmailMessage {
  const rendered = recipientType === "customer"
    ? appointmentCustomerEmail(data)
    : appointmentAdminEmail(data);
  return {
    ...rendered,
    category: recipientType === "customer" ? "appointment_customer" : "appointment_admin",
    to: [recipientType === "customer"
      ? { email: recipientEmail, name: data.customerName }
      : { email: recipientEmail }],
    // Admins can answer the customer straight from their inbox.
    ...(recipientType === "admin" && data.customerEmail
      ? { replyTo: { email: data.customerEmail, name: data.customerName } }
      : {}),
    tags: [`appointment_${data.action}`, `status_${data.status}`],
  };
}

/** Never throws: appointment emails must not break the triggering flow. */
export async function sendAppointmentEmailSafely(
  deps: EmailDeps,
  input: {
    dedupeKey: string;
    data: AppointmentEmailData;
    recipientType: RecipientType;
    recipientEmail: string;
  },
): Promise<EmailDispatchOutcome | undefined> {
  if (!input.recipientEmail) {
    console.warn("[Email] Appointment email skipped: missing recipient", {
      appointmentId: input.data.appointmentId,
      recipientType: input.recipientType,
    });
    return undefined;
  }
  return sendEmailOnceSafely({
    ...deps,
    dedupeKey: input.dedupeKey,
    message: buildAppointmentEmailMessage(input.data, input.recipientType, input.recipientEmail),
    context: { relatedId: input.data.appointmentId, recipientType: input.recipientType },
  });
}

export function buildWelcomeEmailMessage(customerName: string, customerEmail: string): EmailMessage {
  return {
    ...welcomeEmail({ customerName }),
    category: "welcome",
    to: [{ email: customerEmail, name: customerName }],
  };
}

export async function sendWelcomeEmail(
  deps: EmailDeps,
  input: { uid: string; customerName: string; customerEmail: string },
): Promise<EmailDispatchOutcome> {
  return sendEmailOnce({
    ...deps,
    dedupeKey: `welcome:${input.uid}`,
    message: buildWelcomeEmailMessage(input.customerName, input.customerEmail),
    context: { relatedId: input.uid, recipientType: "customer" },
  });
}

export function buildCustomerSuggestionEmailMessage(event: CustomerSuggestionEmailEvent): EmailMessage {
  return {
    ...customerSuggestionEmail(event),
    category: "customer_suggestion",
    to: [{ email: SUGGESTIONS_RECIPIENT_EMAIL, name: "Focus Club" }],
    replyTo: { email: event.userEmail, name: event.userName },
  };
}

export async function sendCustomerSuggestionEmail(
  deps: EmailDeps,
  event: CustomerSuggestionEmailEvent,
): Promise<EmailDispatchOutcome> {
  return sendEmailOnce({
    ...deps,
    dedupeKey: `customer-suggestion:${event.suggestionId}`,
    message: buildCustomerSuggestionEmailMessage(event),
    context: { relatedId: event.suggestionId, recipientType: "admin" },
  });
}

export function buildContactEmailMessage(data: ContactEmailData, recipientEmail: string): EmailMessage {
  return {
    ...contactEmail(data),
    category: "contact",
    to: [{ email: recipientEmail }],
    replyTo: { email: data.email, name: data.name },
  };
}

export async function sendContactEmail(
  deps: EmailDeps,
  input: { submissionId: string; data: ContactEmailData; recipientEmail: string },
): Promise<EmailDispatchOutcome> {
  return sendEmailOnce({
    ...deps,
    dedupeKey: `contact:${input.submissionId}`,
    message: buildContactEmailMessage(input.data, input.recipientEmail),
    context: { relatedId: input.submissionId, recipientType: "admin" },
  });
}
