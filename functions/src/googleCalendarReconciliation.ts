import { randomUUID } from "node:crypto";
import { FieldValue, type DocumentReference, type Firestore, type Timestamp } from "firebase-admin/firestore";
import type { calendar_v3 } from "googleapis/build/src/apis/calendar/v3.js";
import {
  buildCalendarEventPayload, buildCalendarSyncHash, calendarEventAppointmentIds,
  CALENDAR_APPOINTMENT_PROPERTY, CALENDAR_SYNC_HASH_PROPERTY, normalizeAppointmentStatus,
  stableCalendarEventId, type CalendarAppointmentLike, type CalendarEventBuildInput,
} from "./googleCalendarSync.js";

export const CALENDAR_SYNC_COLLECTION = "google_calendar_sync";
export const CALENDAR_SYNC_RUNTIME = { memory: "512MiB", cpu: "gcf_gen1", concurrency: 1, maxInstances: 5, timeoutSeconds: 60, retry: true } as const;
// Outlast the Function deadline, including an ambiguous Calendar write. Each
// Google request also has its own timeout and is checked against the lease.
const LEASE_MS = 90_000;
const REQUEST_TIMEOUT_MS = 8000;
const CUTOVER_CONTROL = "system_controls/google_calendar_v2";

export function createCalendarCutover(db: Firestore, now = Date.now): () => Promise<void> {
  let readyAt: number | undefined;
  return async () => {
    if (readyAt === undefined) readyAt = await db.runTransaction(async tx => {
      const ref = db.doc(CUTOVER_CONTROL);
      const stored = (await tx.get(ref)).get("readyAt");
      if (typeof stored === "number" && Number.isFinite(stored)) return stored;
      const until = now() + LEASE_MS;
      tx.set(ref, { readyAt: until });
      return until;
    });
    // An invocation of the old revision may still be finishing after traffic
    // switches. Eventarc can retry without holding a container open.
    if (now() < readyAt) throw new Error("Google Calendar está esperando el fin de las invocaciones de la revisión anterior.");
  };
}

export interface CalendarSyncAppointment extends CalendarAppointmentLike {
  googleCalendarEventId?: string;
  googleCalendarSyncStatus?: string;
  googleCalendarSyncHash?: string;
}

type RemoteEvent = calendar_v3.Schema$Event;

export interface CalendarSyncRemote {
  find(appointmentId: string): Promise<RemoteEvent[]>;
  get(eventId: string): Promise<RemoteEvent | undefined>;
  insert(eventId: string, body: RemoteEvent): Promise<void>;
  patch(eventId: string, etag: string, body: RemoteEvent): Promise<void>;
  delete(eventId: string, etag: string): Promise<void>;
}

function statusOf(error: unknown): number | undefined {
  const candidate = error as { response?: { status?: number }; code?: unknown; status?: unknown } | null;
  const code = candidate?.response?.status ?? candidate?.status ?? candidate?.code;
  return typeof code === "number" ? code : undefined;
}

function missing(error: unknown): boolean {
  return statusOf(error) === 404 || statusOf(error) === 410;
}

class ReviewRequired extends Error {}
class SyncContended extends Error {}

function retryable(error: unknown): boolean {
  if (error instanceof ReviewRequired) return false;
  const status = statusOf(error);
  if (status === 403) {
    const details = error as { errors?: { reason?: string }[]; response?: { data?: { error?: { errors?: { reason?: string }[] } } } };
    return (details.errors ?? details.response?.data?.error?.errors ?? [])
      .some(({ reason }) => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded");
  }
  return status === undefined || [4, 8, 10, 13, 14, 408, 409, 412, 429].includes(status) || status >= 500;
}

export function calendarSyncRemote(calendar: calendar_v3.Calendar, calendarId: string): CalendarSyncRemote {
  const options = { timeout: REQUEST_TIMEOUT_MS, retry: false };
  return {
    async find(appointmentId) {
      const matches: RemoteEvent[] = [];
      let pageToken: string | undefined;
      const tokens = new Set<string>();
      do {
        const { data } = await calendar.events.list({
          calendarId, q: appointmentId, maxResults: 50, pageToken, showDeleted: false,
          fields: "accessRole,nextPageToken,items(id,status,description,extendedProperties/private)",
        }, options);
        if (data.accessRole !== "writer" && data.accessRole !== "owner") {
          throw new ReviewRequired("El calendario compartido no permite verificar y modificar sus eventos.");
        }
        matches.push(...(data.items ?? []).filter(event => event.status !== "cancelled"
          && calendarEventAppointmentIds(event).includes(appointmentId)));
        pageToken = data.nextPageToken ?? undefined;
        if (pageToken) {
          if (tokens.has(pageToken) || tokens.size >= 2) throw new ReviewRequired("Búsqueda de eventos incompleta.");
          tokens.add(pageToken);
        }
      } while (pageToken && matches.length < 2);
      return matches;
    },
    async get(eventId) {
      try {
        return (await calendar.events.get({ calendarId, eventId }, options)).data;
      } catch (error) {
        if (!missing(error)) throw error;
        return undefined;
      }
    },
    async insert(eventId, requestBody) {
      const { data } = await calendar.events.insert({ calendarId, requestBody: { ...requestBody, id: eventId }, sendUpdates: "none" }, options);
      if (data.id !== eventId) throw new Error("Calendar no confirmó el ID solicitado.");
    },
    async patch(eventId, etag, requestBody) {
      await calendar.events.patch({ calendarId, eventId, requestBody, sendUpdates: "none" }, { ...options, headers: { "If-Match": etag } });
    },
    async delete(eventId, etag) {
      try {
        await calendar.events.delete({ calendarId, eventId, sendUpdates: "none" }, { ...options, headers: { "If-Match": etag } });
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
  };
}

function snapshotVersion(updateTime?: Timestamp): string {
  return updateTime ? `${updateTime.seconds}:${updateTime.nanoseconds}` : "missing";
}

function ownsEvent(event: RemoteEvent, appointmentId: string, eventId: string): boolean {
  const identities = calendarEventAppointmentIds(event);
  return identities.length === 1 && identities[0] === appointmentId
    || identities.length === 0 && event.status === "cancelled" && eventId === stableCalendarEventId(appointmentId);
}

export async function reconcileAppointmentCalendar<T extends CalendarSyncAppointment>(input: {
  db: Firestore;
  ref: DocumentReference;
  previousEventId?: string;
  mayHaveRecurringEvent?: boolean;
  remote: () => CalendarSyncRemote;
  resolveDetails: (appointment: T) => Promise<Pick<CalendarEventBuildInput, "client" | "trainerName">>;
  reportError: (reason: string, transient: boolean) => void;
  now?: () => number;
}): Promise<void> {
  const { db, ref, previousEventId } = input;
  const now = input.now ?? Date.now;
  const appointmentId = ref.id;
  const stableId = stableCalendarEventId(appointmentId);
  const stateRef = db.collection(CALENDAR_SYNC_COLLECTION).doc(appointmentId);
  const token = randomUUID();
  const leaseUntil = now() + LEASE_MS;
  const { appointment, version, boundId, dirty } = await db.runTransaction(async tx => {
    const [snapshot, state] = await Promise.all([tx.get(ref), tx.get(stateRef)]);
    if (state.get("leaseUntil") > now()) throw new SyncContended("Ya hay una sincronización en curso.");
    tx.set(stateRef, { token, leaseUntil }, { merge: true });
    return { appointment: snapshot.data() as T | undefined, version: snapshotVersion(snapshot.updateTime),
      boundId: state.get("eventId") as string | undefined, dirty: state.get("dirty") === true };
  });

  // Only the lease holder can bind an ID or publish projection fields, and only
  // while the source still has the exact version originally read.
  const transactCurrent = async (apply?: (tx: FirebaseFirestore.Transaction) => void): Promise<boolean> => db.runTransaction(async tx => {
    const [fresh, state] = await Promise.all([tx.get(ref), tx.get(stateRef)]);
    if (state.get("token") !== token || now() + REQUEST_TIMEOUT_MS >= leaseUntil || version !== snapshotVersion(fresh.updateTime)) return false;
    apply?.(tx);
    return true;
  });
  let ambiguousWrite = false;
  const mutateCalendar = async (operation: () => Promise<void>) => {
    // A Calendar write can succeed before a concurrent appointment edit makes
    // the projection stale. Force the next delivery to check the remote even
    // if the final appointment hash happens to match the old projection.
    if (!await transactCurrent(tx => tx.update(stateRef, { dirty: true }))) {
      throw new SyncContended("La cita cambió durante la sincronización.");
    }
    try { await operation(); }
    catch (error) {
      const status = statusOf(error);
      ambiguousWrite = status === undefined || status === 408 || status >= 500;
      throw error;
    }
  };

  try {
    const status = normalizeAppointmentStatus(appointment?.status);
    if (appointment && !status) throw new ReviewRequired("Estado de cita no compatible.");
    if (status === "pending" && appointment?.recurrenceSeriesId && !boundId && !previousEventId
      && !appointment.googleCalendarEventId && !input.mayHaveRecurringEvent) return;
    const visible = status === "approved" || (status === "pending" && !appointment?.recurrenceSeriesId);
    const build = visible && appointment ? { appointmentId, appointment, ...await input.resolveDetails(appointment) } : undefined;
    const payload = build && buildCalendarEventPayload(build);
    if (visible && !payload) throw new ReviewRequired("La cita carece de una franja válida.");
    const syncHash = build && buildCalendarSyncHash(build);
    if (!dirty && visible && boundId && appointment?.googleCalendarEventId === boundId
      && appointment.googleCalendarSyncStatus === "synced" && appointment.googleCalendarSyncHash === syncHash) return;
    if (!dirty && !visible && boundId && appointment?.googleCalendarSyncStatus === "deleted" && !appointment.googleCalendarEventId) return;

    const remote = input.remote();
    const link = appointment ? appointment.googleCalendarEventId : previousEventId;
    let eventId = boundId || link;
    if (!eventId) {
      // Legacy events could have been created before their Firestore link was
      // saved. The exact appointment ID is the only admissible adoption key.
      const candidates = await remote.find(appointmentId);
      if (candidates.length > 1 || (candidates.length === 1 && !candidates[0].id)) {
        throw new ReviewRequired("Hay varios eventos asociados o un evento sin ID.");
      }
      eventId = candidates[0]?.id ?? stableId;
    }
    if (!boundId && !await transactCurrent(tx => tx.set(stateRef, { eventId }, { merge: true }))) {
      throw new SyncContended("La cita cambió antes de reservar el ID de calendario.");
    }

    let event = await remote.get(eventId);
    const unmarkedTombstone = event?.status === "cancelled" && calendarEventAppointmentIds(event).length === 0;
    if (event && !unmarkedTombstone && !ownsEvent(event, appointmentId, eventId)) throw new ReviewRequired("El evento pertenece a otra cita o su origen no es verificable.");
    if (!event && !visible && (boundId || link) && (await remote.find(appointmentId)).length) {
      // A 404 can also be caused by a loss of Calendar access. The list must
      // confirm access and the absence of a surviving event before completion.
      throw new ReviewRequired("Falta el evento enlazado y queda otro evento asociado.");
    }
    if ((!event || unmarkedTombstone) && visible && eventId !== stableId) {
      // Use the deterministic ID only when the legacy ID is absent. First
      // check for another surviving legacy event so we cannot multiply it.
      if ((await remote.find(appointmentId)).length) throw new ReviewRequired("Hay un evento alternativo y el enlace anterior no existe.");
      eventId = stableId;
      if (!await transactCurrent(tx => tx.set(stateRef, { eventId }, { merge: true }))) throw new SyncContended("La cita cambió al recuperar su evento.");
      event = await remote.get(eventId);
      if (event && !ownsEvent(event, appointmentId, eventId)) throw new ReviewRequired("El ID estable está ocupado por otro evento.");
    }

    if (payload && syncHash) {
      const privateProperties = event?.extendedProperties?.private ?? {};
      const body: RemoteEvent = { ...payload, status: "confirmed", extendedProperties: { private: {
        ...privateProperties, [CALENDAR_APPOINTMENT_PROPERTY]: appointmentId, [CALENDAR_SYNC_HASH_PROPERTY]: syncHash,
      } } };
      if (!event) {
        try { await mutateCalendar(() => remote.insert(eventId, body)); }
        catch (error) {
          if (statusOf(error) !== 409) throw error;
          // If Google sees the ID but does not return the event, keep the same
          // ID and retry. An additional ID could create a second live event.
          event = await remote.get(eventId);
          if (!event) throw error;
          if (!ownsEvent(event, appointmentId, eventId)) throw new ReviewRequired("Conflicto con un evento de origen distinto.");
        }
      }
      if (event && (event.status === "cancelled" || event.extendedProperties?.private?.[CALENDAR_SYNC_HASH_PROPERTY] !== syncHash)) {
        const etag = event.etag;
        if (!etag) throw new ReviewRequired("El evento no tiene una versión verificable.");
        await mutateCalendar(() => remote.patch(eventId, etag, body));
      }
    } else if (event && event.status !== "cancelled") {
      const etag = event.etag;
      if (!etag) throw new ReviewRequired("El evento no tiene una versión verificable.");
      await mutateCalendar(() => remote.delete(eventId, etag));
    }

    if (!await transactCurrent(tx => {
      tx.update(stateRef, { dirty: FieldValue.delete(), lastError: FieldValue.delete() });
      if (appointment) tx.update(ref, {
        googleCalendarEventId: visible ? eventId : FieldValue.delete(),
        googleCalendarSyncedAt: new Date(now()).toISOString(),
        googleCalendarSyncStatus: visible ? "synced" : "deleted",
        googleCalendarSyncError: FieldValue.delete(),
        googleCalendarSyncHash: visible ? syncHash : FieldValue.delete(),
      });
    })) throw new SyncContended("La cita cambió antes de guardar la sincronización.");
  } catch (error) {
    if (error instanceof SyncContended) throw error;
    const transient = retryable(error);
    const status = statusOf(error);
    const reason = error instanceof ReviewRequired ? error.message
      : status ? `Google Calendar HTTP ${status}` : "No se pudo completar la sincronización con Google Calendar.";
    input.reportError(reason, transient);
    if (!await transactCurrent(tx => {
      tx.update(stateRef, { lastError: { reason, transient, sourceVersion: version, at: new Date(now()).toISOString() } });
      if (appointment) tx.update(ref, { googleCalendarSyncStatus: "error", googleCalendarSyncError: reason });
    })) throw new SyncContended("La cita cambió antes de guardar el fallo de calendario.");
    if (transient) throw new Error(reason);
  } finally {
    // A lost write response can precede a late Calendar commit. Give that
    // request time to settle before a different invocation reconciles it.
    if (!ambiguousWrite) await db.runTransaction(async tx => {
      if ((await tx.get(stateRef)).get("token") === token) tx.update(stateRef, { token: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    });
  }
}
