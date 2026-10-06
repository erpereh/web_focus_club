import type { EmailMessage } from "../email/types.js";

/**
 * Stable navigation category. Sent as FCM `data.type` and stored as `type` in
 * `users/{uid}/notifications`. Existing app builds already understand
 * `appointment_status` and `support_message`; never repurpose these values.
 */
export type NotificationCategory = "appointment_status" | "bono_status" | "support_message";

export const APPOINTMENT_EVENTS = [
  "appointment_requested",
  "appointment_confirmed",
  "appointment_rescheduled",
  "appointment_rejected",
  "appointment_cancelled",
  "appointment_deleted",
  "appointment_reminder",
  "appointment_proposed",
  "appointment_proposal_declined",
  "appointment_series_requested",
  "appointment_series_confirmed",
  "appointment_series_rejected",
  "appointment_series_cancelled",
  "appointment_series_rescheduled",
  "appointment_series_returned_to_pending",
  "appointment_series_renewal_pending",
] as const;

export const BONO_EVENTS = [
  "bono_assigned",
  "bono_renewed",
  "bono_exhausted",
  "bono_expired",
  "bono_validity_changed",
  "bono_expiring_7d",
  "bono_expiring_2d",
] as const;

export type AppointmentNotificationEvent = typeof APPOINTMENT_EVENTS[number];
export type BonoNotificationEvent = typeof BONO_EVENTS[number];
export type SeriesNotificationEvent = Extract<AppointmentNotificationEvent, `appointment_series_${string}`>;

/** Concrete event. Sent as FCM `data.event` and stored as `event`. */
export type NotificationEvent = AppointmentNotificationEvent | BonoNotificationEvent | "support_message";

export type NotificationRoute = "appointment" | "appointments" | "bono" | "chat";

export interface NotificationRelated {
  appointmentId?: string;
  bonoId?: string;
  conversationId?: string;
  seriesId?: string;
  appointmentIds?: string[];
  /** Appointment status after the change (appointment_status only). */
  status?: string;
}

export interface NotificationNavigation {
  route: NotificationRoute;
  params: Record<string, string>;
}

export interface CustomerNotification {
  uid: string;
  /** Stable key for the logical notice; drives history id and every ledger. */
  dedupeKey: string;
  category: NotificationCategory;
  event: NotificationEvent;
  title: string;
  body: string;
  related: NotificationRelated;
  navigation: NotificationNavigation;
  channels: {
    push: boolean;
    email?: EmailMessage;
  };
}

export type ChannelName = "history" | "push" | "email";
export type ChannelStatus = "pending" | "sent" | "skipped" | "failed";
export type DeliveryStatus = "pending" | "retrying" | "complete" | "failed";

export interface ChannelResult {
  status: ChannelStatus;
  error?: string;
  messageId?: string;
}

export interface DeliveryOutcome {
  notificationId: string;
  status: DeliveryStatus;
  channels: Partial<Record<ChannelName, ChannelResult>>;
}
