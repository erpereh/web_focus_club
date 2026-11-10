import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";

export const ADMIN_APPOINTMENT_RUNTIME = {
  memory: "512MiB" as const,
  cpu: 1,
  concurrency: 5,
  timeoutSeconds: 60,
};

interface Observation {
  attempts: number;
  documentsRead: number;
  stagedWrites: number;
  phasesMs: Record<string, number>;
}

const observations = new AsyncLocalStorage<Observation>();
let activeRequests = 0;

export async function measureAdminPhase<T>(phase: string, work: () => Promise<T>): Promise<T> {
  const observation = observations.getStore();
  if (!observation) return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    observation.phasesMs[phase] = (observation.phasesMs[phase] ?? 0) + performance.now() - start;
  }
}

/** Observe the existing SDK transaction, including its commit and retries. */
export function runAdminAppointmentTransaction<T>(db: Firestore, work: (transaction: Transaction) => Promise<T>): Promise<T> {
  return measureAdminPhase("transaction", () => db.runTransaction(async (transaction) => {
    const observation = observations.getStore();
    if (!observation) return work(transaction);
    observation.attempts += 1;
    const observed = new Proxy(transaction, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "get" || property === "getAll") {
          return (...args: unknown[]) => measureAdminPhase("readRpcTotal", async () => {
            const result: unknown = await Reflect.apply(value, target, args);
            // RPC durations can overlap: their sum is NOT wall-clock duration.
            if (Array.isArray(result)) observation.documentsRead += result.length;
            else if (result && typeof result === "object") {
              if ("size" in result && typeof result.size === "number") observation.documentsRead += result.size;
              else observation.documentsRead += 1;
            }
            return result;
          });
        }
        if (["set", "create", "delete", "update"].includes(String(property))) {
          return (...args: unknown[]) => {
            observation.stagedWrites += 1;
            Reflect.apply(value, target, args);
            return observed;
          };
        }
        return value.bind(target);
      },
    });
    return measureAdminPhase("transactionCallback", () => work(observed));
  }));
}

/** Business errors pass through verbatim; transport failures never expose SDK internals. */
export function adminAppointmentError(error: unknown, operationId: string): HttpsError {
  if (error instanceof HttpsError) return error;
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const code = String(rawCode ?? "").toLowerCase().replaceAll("_", "-");
  const refresh = "Actualiza las citas para comprobar el resultado antes de repetir la operación.";
  const details = { operationId };
  switch (code) {
    case "10": case "aborted":
      return new HttpsError("aborted", `Hay otra operación modificando estas citas. ${refresh}`, { ...details, reason: "transaction_contention" });
    case "4": case "deadline-exceeded":
      return new HttpsError("deadline-exceeded", `No se ha podido confirmar la operación a tiempo. ${refresh}`, { ...details, reason: "request_deadline_exceeded" });
    case "8": case "resource-exhausted":
      return new HttpsError("resource-exhausted", `El servicio está ocupado. ${refresh}`, { ...details, reason: "service_busy" });
    case "14": case "unavailable":
      return new HttpsError("unavailable", `El servicio no está disponible temporalmente. ${refresh}`, { ...details, reason: "service_unavailable" });
    default:
      return new HttpsError("internal", `No se ha podido confirmar la operación. ${refresh}`, { ...details, reason: "appointment_operation_failed" });
  }
}

/** The only shared mutable state here is process telemetry, never business data. */
export function observeAdminAppointmentOperation<Request, Result>(name: string, handler: (request: Request) => Promise<Result>) {
  return async (request: Request): Promise<Result> => {
    const observation: Observation = { attempts: 0, documentsRead: 0, stagedWrites: 0, phasesMs: {} };
    const operationId = randomUUID();
    const start = performance.now();
    const startMemory = process.memoryUsage();
    const activeAtStart = ++activeRequests;
    let failure: HttpsError | undefined;
    try {
      return await observations.run(observation, () => handler(request));
    } catch (error: unknown) {
      failure = adminAppointmentError(error, operationId);
      throw failure;
    } finally {
      const memory = process.memoryUsage();
      const durationMs = Math.round(performance.now() - start);
      const entry = {
        operation: name, operationId, durationMs, activeAtStart, activeAtEnd: activeRequests,
        ...observation,
        // All memory figures belong to the PROCESS shared by concurrent requests.
        processRssStartMiB: Math.round(startMemory.rss / 1048576),
        processRssEndMiB: Math.round(memory.rss / 1048576),
        processHeapStartMiB: Math.round(startMemory.heapUsed / 1048576),
        processHeapEndMiB: Math.round(memory.heapUsed / 1048576),
        processLifetimeMaxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        outcome: failure?.code ?? "success",
      };
      activeRequests -= 1;
      try {
        if (failure?.code === "internal") logger.error("admin_appointment_operation", entry);
        else if (failure || durationMs >= 10000 || memory.rss >= 384 * 1048576) logger.warn("admin_appointment_operation", entry);
        else logger.info("admin_appointment_operation", entry);
      } catch {
        // Telemetry must never turn a committed operation into a failure.
      }
    }
  };
}
