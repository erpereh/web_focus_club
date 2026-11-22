import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { info } from "firebase-functions/logger";

// The preparatory artifact changes only this constant, never the business code.
export const REQUIRE_OCCUPANCY_V2 = true;
export const RELEASE_CONTROL_PATH = "system_controls/release";
export const RELEASE_QUEUE_PATH = "system_controls/deferred";
const recovery = new AsyncLocalStorage<string>();
const READ_ONLY_CALLABLES = new Set([
  "auditMinuteRefundsFromAdmin", "getMinuteRefundsFromAdmin", "getMinuteRefundSummaryFromAdmin",
  "getMinuteRefundDetailFromAdmin", "previewBonoAppointmentRenewalFromAdmin",
]);
export interface ReleaseControl {
  phase?: "open" | "draining" | "frozen";
  releaseId?: string;
  occupancyVersion?: number;
  epoch?: number;
  occupancyVerifiedEpoch?: number | null;
  occupancyAuditHash?: string | null;
}

function occupancyReady(control: ReleaseControl | undefined): boolean {
  return control?.occupancyVersion === 2 && Boolean(control.occupancyAuditHash)
    && control.occupancyVerifiedEpoch === control.epoch;
}

function unavailable(reason = "maintenance"): never {
  throw new HttpsError("unavailable", "Estamos realizando tareas de mantenimiento. Inténtalo de nuevo en unos minutos.", { reason });
}

export async function assertMaintenanceTransaction(transaction: Transaction, db: Firestore): Promise<ReleaseControl | undefined> {
  const snap = await transaction.get(db.collection("system_controls").doc("release"));
  const control = snap.data() as ReleaseControl | undefined;
  if (control?.phase && control.phase !== "open" && recovery.getStore() !== control.releaseId) unavailable();
  return control;
}

/** Only the authorized server recovery dispatcher installs this process-local capability. */
export function withMaintenanceRecovery<T>(releaseId: string, action: () => Promise<T>): Promise<T> {
  return recovery.run(releaseId, action);
}

async function admit(db: Firestore, operation: string): Promise<string> {
  const id = randomUUID();
  await db.runTransaction(async (tx) => {
    const control = (await tx.get(db.collection("system_controls").doc("release"))).data() as ReleaseControl | undefined;
    if (control?.phase && control.phase !== "open") unavailable();
    if (REQUIRE_OCCUPANCY_V2 && !occupancyReady(control)) unavailable("occupancy_not_ready");
    tx.create(db.collection("release_operations").doc(id), {
      operation, state: "active", startedAt: new Date().toISOString(),
      // An expired operation is NOT assumed finished. The operator must inspect it.
      releaseId: control?.releaseId ?? "bootstrap", 
    });
  });
  return id;
}

async function complete(db: Firestore, id: string): Promise<void> {
  // Proof that all awaited business work ended, even if deleting the lease fails.
  info("Release operation finished", { releaseOperationId: id, releaseOperationState: "handler_finished" });
  await db.collection("release_operations").doc(id).delete();
}

export function guardCallable<TRequest, TResult>(
  db: Firestore, name: string, handler: (request: TRequest, ...args: never[]) => TResult | Promise<TResult>,
): (request: TRequest) => Promise<TResult> {
  return async (request) => {
    if (READ_ONLY_CALLABLES.has(name)) return handler(request);
    const id = await admit(db, name);
    try { return await handler(request); }
    finally { await complete(db, id); }
  };
}

type EventSnapshot = { exists?: boolean; ref?: { path?: string }; data(): unknown };
type RecoverableEvent = {
  id?: string; params?: Record<string, string>; time?: string;
  data?: EventSnapshot | { before?: EventSnapshot; after?: EventSnapshot };
  [key: string]: unknown;
};

/** Keep irrelevant balance/history events from creating maintenance work. */
function relevantEvent(name: string, event: RecoverableEvent): boolean {
  const change = event.data as { before?: EventSnapshot; after?: EventSnapshot } | undefined;
  const before = change?.before?.data() as Record<string, unknown> | undefined;
  const after = change?.after?.data() as Record<string, unknown> | undefined;
  if (name === "onMinuteRefundActivation") return before?.automaticMinuteRefundsEnabled !== true && after?.automaticMinuteRefundsEnabled === true;
  if (name === "onMinuteRefundAccountWritten") return Number(after?.pendingMinutes ?? 0) > 0 && before?.generation !== after?.generation;
  if (name === "onAppointmentApproved") return before?.status !== after?.status && ["approved", "rejected", "cancelled"].includes(String(after?.status));
  if (name === "onBonoRefundDestinationChanged") {
    if (before?.estado === "activo" && after?.estado === "agotado") return false;
    return !before || !after || ["userId", "estado", "fechaAsignacion", "fechaExpiracion", "replacedByBonoId"].some((key) => before[key] !== after[key]);
  }
  return true;
}

function serializeSnapshot(snapshot: EventSnapshot | undefined): unknown {
  return snapshot ? { exists: snapshot.exists !== false, path: snapshot.ref?.path ?? null, value: snapshot.data() ?? null } : null;
}

export function serializeReleaseEvent(event: RecoverableEvent): Record<string, unknown> {
  const data = event.data;
  if (data && "data" in data && typeof data.data === "function") {
    return { id: event.id ?? null, params: event.params ?? {}, time: event.time ?? null, snapshot: serializeSnapshot(data as EventSnapshot) };
  }
  if (data && ("before" in data || "after" in data)) {
    const change = data as { before?: EventSnapshot; after?: EventSnapshot };
    return { id: event.id ?? null, params: event.params ?? {}, time: event.time ?? null,
      before: serializeSnapshot(change.before), after: serializeSnapshot(change.after) };
  }
  return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
}

export function restoreReleaseEvent(stored: Record<string, unknown>, db: Firestore): RecoverableEvent {
  const snapshot = (raw: unknown): EventSnapshot | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as { exists: boolean; path: string | null; value: unknown };
    return { exists: value.exists, ref: value.path ? db.doc(value.path) : undefined, data: () => value.value };
  };
  if ("snapshot" in stored) return { ...stored, data: snapshot(stored.snapshot) } as RecoverableEvent;
  if ("before" in stored || "after" in stored) {
    return { ...stored, data: { before: snapshot(stored.before), after: snapshot(stored.after) } } as RecoverableEvent;
  }
  return stored as RecoverableEvent;
}

/** Persist before acknowledging a paused event. Duplicate deliveries create one job. */
export function guardBackground<TEvent, TResult>(
  db: Firestore, name: string, handler: (event: TEvent) => TResult | Promise<TResult>,
): (event: TEvent) => Promise<TResult | undefined> {
  return async (event) => {
    if (!relevantEvent(name, event as RecoverableEvent)) return undefined;
    const serialized = serializeReleaseEvent(event as RecoverableEvent);
    const identity = serialized.id ?? serialized.scheduleTime ?? JSON.stringify(serialized);
    const eventKey = createHash("sha256").update(`${name}:${identity}`).digest("hex");
    const operationId = randomUUID();
    const admission = {
      ...(typeof serialized.id === "string" ? { eventId: serialized.id } : {}),
      ...(process.env.K_REVISION ? { revision: process.env.K_REVISION } : {}),
      eventKey,
    };
    const admitted = await db.runTransaction(async (tx) => {
      const control = (await tx.get(db.collection("system_controls").doc("release"))).data() as ReleaseControl | undefined;
      const recovering = Boolean(control?.releaseId && recovery.getStore() === control.releaseId);
      const closed = control?.phase && control.phase !== "open";
      if (!recovering && (closed || (REQUIRE_OCCUPANCY_V2 && !occupancyReady(control)))) {
        const ref = db.collection("release_deferred_events").doc(eventKey);
        const [existing, queue] = await Promise.all([tx.get(ref), tx.get(db.collection("system_controls").doc("deferred"))]);
        if (!existing.exists) {
          tx.create(ref, { name, event: serialized, state: "pending", createdAt: new Date().toISOString() });
          tx.set(db.collection("system_controls").doc("deferred"), { pending: Number(queue.data()?.pending ?? 0) + 1 });
        }
        return false;
      }
      tx.create(db.collection("release_operations").doc(operationId), {
        operation: name, state: "active", releaseId: control?.releaseId ?? "bootstrap", startedAt: new Date().toISOString(),
        ...admission,
      });
      return true;
    });
    if (!admitted) return undefined;
    info("Release background operation admitted", {
      releaseOperationId: operationId, releaseOperationState: "admitted", operation: name, ...admission,
    });
    try { return await handler(event); }
    catch (error) {
      // Closing the gate can abort an already-admitted financial transaction.
      // Persist that event as well: Eventarc retries must not be our only copy.
      const reason = (error as { details?: { reason?: string } }).details?.reason;
      if (reason !== "maintenance") throw error;
      await db.runTransaction(async (tx) => {
        const ref = db.collection("release_deferred_events").doc(eventKey);
        const [existing, queue] = await Promise.all([tx.get(ref), tx.get(db.collection("system_controls").doc("deferred"))]);
        if (!existing.exists) {
          tx.create(ref, { name, event: serialized, state: "pending", createdAt: new Date().toISOString() });
          tx.set(db.collection("system_controls").doc("deferred"), { pending: Number(queue.data()?.pending ?? 0) + 1 });
        }
      });
      return undefined;
    }
    finally { await complete(db, operationId); }
  };
}

/** IAM-only jobs execute in the deployed runtime, with its own secret bindings. */
export function createReleaseRecoveryHandler(
  db: Firestore, handlers: () => Record<string, { run: (event: never) => unknown }>,
): (event: { params: { jobId: string } }) => Promise<void> {
  return async (event) => {
    const ref = db.collection("release_deferred_events").doc(event.params.jobId);
    const claim = randomUUID();
    const job = await db.runTransaction(async (tx) => {
      const [current, gate] = await Promise.all([tx.get(ref), tx.get(db.collection("system_controls").doc("release"))]);
      const data = current.data();
      if (data?.state !== "ready") return undefined;
      if (gate.data()?.phase !== "frozen" || data.approvedReleaseId !== gate.data()?.releaseId || data.approvedEpoch !== gate.data()?.epoch) {
        throw new Error("La recuperación requiere mantenimiento congelado y autorización del operador.");
      }
      tx.update(ref, { state: "recovering", claim, startedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 11 * 60_000).toISOString() });
      // Recovering an event can change the audited source. Require verification
      // again even if an operator starts this job after a successful audit.
      tx.set(db.collection("system_controls").doc("release"), {
        occupancyVerifiedEpoch: null, occupancyAuditHash: null,
      }, { merge: true });
      return data;
    });
    if (!job) return;
    try {
      const target = handlers()[job.name];
      if (!target?.run) throw new Error("El evento no corresponde a un manejador autorizado.");
      await withMaintenanceRecovery(job.approvedReleaseId, async () => target.run(restoreReleaseEvent(job.event, db) as never));
      await db.runTransaction(async (tx) => {
        const [current, summary] = await Promise.all([tx.get(ref), tx.get(db.collection("system_controls").doc("deferred"))]);
        if (current.data()?.claim !== claim || current.data()?.state !== "recovering") throw new Error("La concesión de recuperación ha cambiado.");
        const pending = Number(summary.data()?.pending ?? 0);
        if (!Number.isSafeInteger(pending) || pending < 1) throw new Error("Contador de recuperación inconsistente.");
        tx.update(ref, { state: "completed", completedAt: new Date().toISOString() });
        tx.set(db.collection("system_controls").doc("deferred"), { pending: pending - 1 });
      });
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (current.data()?.claim === claim && current.data()?.state === "recovering") {
          tx.update(ref, { state: "pending", failedAt: new Date().toISOString(), needsReview: true,
            errorCode: String((error as { code?: string }).code ?? "recovery_failed") });
        }
      });
      throw error;
    }
  };
}
