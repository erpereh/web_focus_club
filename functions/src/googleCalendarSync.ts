import { createHash } from "node:crypto";

export const GOOGLE_CALENDAR_SYNC_FIELDS = [
  "googleCalendarEventId",
  "googleCalendarSyncedAt",
  "googleCalendarSyncStatus",
  "googleCalendarSyncError",
  "googleCalendarSyncHash",
] as const;

export type CalendarAppointmentStatus = "pending" | "approved" | "rejected";

export interface TimeSlot {
  date: string;
  time: string;
}

export interface CalendarAppointmentLike {
  status?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  serviceType?: unknown;
  duration?: unknown;
  preferredSlots?: unknown;
  approvedSlot?: unknown;
  date?: unknown;
  time?: unknown;
  assignedTrainer?: unknown;
  sessionType?: unknown;
  reason?: unknown;
  comment?: unknown;
}

export interface CalendarClientInfo {
  name: string;
  email: string;
  phone: string;
}

export interface CalendarEventBuildInput {
  appointmentId: string;
  appointment: CalendarAppointmentLike;
  client: CalendarClientInfo;
  trainerName: string;
}

export interface CalendarEventPayload {
  summary: string;
  description: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  colorId: string;
}

const TIME_ZONE = "Europe/Madrid";
const FALLBACK_CLIENT_NAME = "Cliente";
const FALLBACK_DURATION_MINUTES = 30;
const VALID_DURATION_MINUTES = new Set([30, 45, 60]);
const STATUS_LABELS: Record<CalendarAppointmentStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!isRecord(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = normalizeForHash(value[key]);
      return result;
    }, {});
}

function isTimeSlot(value: unknown): value is TimeSlot {
  return isRecord(value)
    && typeof value.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && typeof value.time === "string"
    && /^\d{2}:\d{2}$/.test(value.time);
}

function firstPreferredSlot(appointment: CalendarAppointmentLike): TimeSlot | undefined {
  return Array.isArray(appointment.preferredSlots)
    ? appointment.preferredSlots.find(isTimeSlot)
    : undefined;
}

function legacyDateTimeSlot(appointment: CalendarAppointmentLike): TimeSlot | undefined {
  const date = asString(appointment.date);
  const time = asString(appointment.time);
  const slot = { date, time };
  return isTimeSlot(slot) ? slot : undefined;
}

function addMinutesToLocalDateTime(slot: TimeSlot, durationMinutes: number): string {
  const [hours, minutes] = slot.time.split(":").map(Number);
  const date = new Date(Date.UTC(
    Number(slot.date.slice(0, 4)),
    Number(slot.date.slice(5, 7)) - 1,
    Number(slot.date.slice(8, 10)),
    hours,
    minutes + durationMinutes,
  ));

  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const endHours = String(date.getUTCHours()).padStart(2, "0");
  const endMinutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${endHours}:${endMinutes}:00`;
}

export function normalizeAppointmentStatus(value: unknown): CalendarAppointmentStatus | undefined {
  const status = asString(value).toLowerCase();
  if (status === "pending" || status === "pendiente") return "pending";
  if (status === "approved" || status === "aprobada") return "approved";
  if (status === "rejected" || status === "rechazada") return "rejected";
  return undefined;
}

export function normalizeDurationMinutes(value: unknown): number {
  const duration = typeof value === "number" ? value : Number.parseInt(asString(value), 10);
  return VALID_DURATION_MINUTES.has(duration) ? duration : FALLBACK_DURATION_MINUTES;
}

export function resolveAppointmentSlot(appointment: CalendarAppointmentLike): TimeSlot | undefined {
  const status = normalizeAppointmentStatus(appointment.status);
  if (status === "approved") {
    return isTimeSlot(appointment.approvedSlot)
      ? appointment.approvedSlot
      : firstPreferredSlot(appointment) ?? legacyDateTimeSlot(appointment);
  }

  return firstPreferredSlot(appointment)
    ?? (isTimeSlot(appointment.approvedSlot) ? appointment.approvedSlot : undefined)
    ?? legacyDateTimeSlot(appointment);
}

export function buildCalendarSyncHash(input: CalendarEventBuildInput): string {
  const appointment = input.appointment;
  const slot = resolveAppointmentSlot(appointment);
  const status = normalizeAppointmentStatus(appointment.status);
  const payload = normalizeForHash({
    appointmentId: input.appointmentId,
    status,
    slot,
    durationMinutes: normalizeDurationMinutes(appointment.duration),
    client: input.client,
    serviceType: asString(appointment.serviceType),
    sessionType: asString(appointment.sessionType),
    assignedTrainer: asString(appointment.assignedTrainer),
    trainerName: input.trainerName,
    comment: asString(appointment.comment) || asString(appointment.reason),
  });

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildCalendarEventPayload(input: CalendarEventBuildInput): CalendarEventPayload | undefined {
  const status = normalizeAppointmentStatus(input.appointment.status);
  const slot = resolveAppointmentSlot(input.appointment);
  if (!status || status === "rejected" || !slot) return undefined;

  const durationMinutes = normalizeDurationMinutes(input.appointment.duration);
  const clientName = input.client.name || asString(input.appointment.name) || FALLBACK_CLIENT_NAME;
  const email = input.client.email || asString(input.appointment.email);
  const phone = input.client.phone || asString(input.appointment.phone);
  const serviceType = asString(input.appointment.serviceType);
  const sessionType = asString(input.appointment.sessionType);
  const trainerName = input.trainerName || asString(input.appointment.assignedTrainer);
  const comment = asString(input.appointment.comment) || asString(input.appointment.reason);
  const label = STATUS_LABELS[status];
  const startDateTime = `${slot.date}T${slot.time}:00`;
  const endDateTime = addMinutesToLocalDateTime(slot, durationMinutes);
  const schedule = `${slot.date} ${slot.time} - ${durationMinutes} min`;

  return {
    summary: `${label} - ${clientName} - ${serviceType || "Servicio"}`,
    description: [
      `Cliente: ${clientName}`,
      `Email: ${email}`,
      `Telefono: ${phone}`,
      "",
      `Servicio: ${serviceType}`,
      `Tipo de sesion: ${sessionType}`,
      `Estado: ${status}`,
      `Entrenador: ${trainerName}`,
      "",
      "Comentario:",
      comment,
      "",
      "ID cita:",
      input.appointmentId,
      "",
      "Horario:",
      schedule,
    ].join("\n"),
    start: {
      dateTime: startDateTime,
      timeZone: TIME_ZONE,
    },
    end: {
      dateTime: endDateTime,
      timeZone: TIME_ZONE,
    },
    colorId: status === "approved" ? "10" : "5",
  };
}

export function onlyGoogleCalendarSyncFieldsChanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const allowed = new Set<string>(GOOGLE_CALENDAR_SYNC_FIELDS);
  const changedKeys = new Set<string>();
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  keys.forEach((key) => {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedKeys.add(key);
    }
  });

  return changedKeys.size > 0 && Array.from(changedKeys).every((key) => allowed.has(key));
}
