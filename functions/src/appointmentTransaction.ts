import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { appointmentOccupancyKeys, occupiesCapacity, planOccupancyWrites } from "./slotOccupancy.js";
import { normalizeSiteConfig } from "./siteConfig.js";
import { loadCapacityExceptions, resolveMaxCapacity } from "./capacityExceptions.js";
import { assertMaintenanceTransaction } from "./releaseMaintenance.js";
import { getAppointmentEffectiveSlot } from "./appointmentLifecycle.js";

type Data = Record<string, unknown>;
type Write = { kind: "set" | "create" | "update" | "delete"; ref: DocumentReference; data?: Data; options?: unknown };

function applyProjection(before: Data | undefined, write: Write): Data | undefined {
  if (write.kind === "delete") return undefined;
  const merge = write.kind === "update" || Boolean((write.options as { merge?: boolean } | undefined)?.merge);
  const result = merge ? { ...before } : {} as Data;
  for (const [key, value] of Object.entries(write.data ?? {})) {
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete result[key];
    else result[key] = value;
  }
  return result;
}

function confirmedOverride(writes: Write[], key: string, appointments: Data[]): boolean {
  const covers = (item: { date?: unknown; time?: unknown }): boolean => appointments.some((appointment) => {
    const slot = getAppointmentEffectiveSlot(appointment);
    return slot?.date === item.date && slot?.time === item.time && appointmentOccupancyKeys(appointment).includes(key);
  });
  return writes.some(({ data, ref }) => {
    if (!data) return false;
    if (ref.path.startsWith("activity_logs/") && data.adminUid && Array.isArray(data.restrictions)
      && data.restrictions.some((item: { date?: string; time?: string; reason?: string }) => item.reason === "slot_full" && covers(item))) return true;
    if (ref.path.startsWith("activity_logs/") && data.action === "appointment_approved_over_capacity") {
      return Boolean(data.adminUid) && covers({ date: data.date, time: data.time });
    }
    const audit = data.adminOverride as { authorizedByUid?: string; restrictions?: Array<{ date: string; time: string; reason: string }> } | undefined;
    return Boolean(audit?.authorizedByUid && audit.restrictions?.some((item) => item.reason === "slot_full" && covers(item)));
  });
}

/**
 * One transactional boundary for every appointment mutation. Writes are staged
 * until all reads finish. Counts derive from before/after appointments, never
 * from a caller's approval-only counter. Legacy counter writes are replaced.
 */
export function runAppointmentTransaction<T>(db: Firestore, action: (transaction: Transaction) => Promise<T>): Promise<T> {
  return db.runTransaction(async (transaction) => {
    const maintenance = await assertMaintenanceTransaction(transaction, db);
    const writes: Write[] = [];
    const snapshots = new Map<string, DocumentSnapshot>();
    let staged: Transaction;
    staged = new Proxy(transaction, {
      get(target, property) {
        if (property === "get" || property === "getAll") {
          const original = Reflect.get(target, property);
          if (typeof original !== "function") return original;
          const method = original.bind(target);
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(method, target, args);
            const fullRead = !args.some((arg) => arg && typeof arg === "object" && "fieldMask" in arg);
            if (fullRead) for (const snap of Array.isArray(result) ? result : [result]) {
              if (snap?.ref?.path?.startsWith("appointments/") && typeof snap.data === "function") snapshots.set(snap.ref.path, snap);
            }
            return result;
          };
        }
        if (["set", "create", "update", "delete"].includes(String(property))) {
          return (ref: DocumentReference, data?: Data, options?: unknown) => {
            writes.push({ kind: property as Write["kind"], ref, data, options });
            return staged;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await action(staged);
    const changed = new Map<string, DocumentReference>();
    for (const write of writes) if (/^appointments\/[^/]+$/.test(write.ref.path)) changed.set(write.ref.path, write.ref);
    const delta = new Map<string, number>();
    const invalidReleases: string[] = [];
    const afterAppointments: Data[] = [];
    await Promise.all([...changed].map(async ([path, ref]) => {
      if (!snapshots.has(path)) snapshots.set(path, await transaction.get(ref));
    }));
    for (const [path] of changed) {
      const snap = snapshots.get(path)!;
      const before = snap.exists ? snap.data() as Data : undefined;
      let after = before;
      for (const write of writes) if (write.ref.path === path) after = applyProjection(after, write);
      if (after && occupiesCapacity(after.status)) afterAppointments.push(after);
      for (const [document, direction] of [[before, -1], [after, 1]] as const) {
        if (!document || !occupiesCapacity(document.status)) continue;
        const keys = appointmentOccupancyKeys(document);
        if (!keys.length) {
          if (direction === -1 && !occupiesCapacity(after?.status)) { invalidReleases.push(path); continue; }
          throw new HttpsError("failed-precondition", "La cita no tiene una franja y duración válidas.", { reason: "invalid_occupancy" });
        }
        for (const key of keys) delta.set(key, (delta.get(key) ?? 0) + direction);
      }
    }
    const keys = [...delta].filter(([, amount]) => amount !== 0).map(([key]) => key).sort();
    const snaps = await Promise.all(keys.map((key) => transaction.get(db.collection("slot_occupancy").doc(key))));
    const raw = new Map<string, unknown>(snaps.map((snap, index) => [keys[index], snap.exists ? snap.data()?.count : undefined]));
    const planned = planOccupancyWrites(new Map(keys.map((key) => [key, delta.get(key)!])), raw);
    if (keys.some((key) => delta.get(key)! > 0)) {
      const configSnap = await transaction.get(db.collection("site_config").doc("main"));
      const config = normalizeSiteConfig(configSnap.data() ?? {});
      const exceptions = await loadCapacityExceptions(transaction, db, [...new Set(keys.map((key) => key.slice(0, 10)))]);
      for (const write of planned.writes) {
        if (delta.get(write.key)! <= 0) continue;
        const maxCapacity = resolveMaxCapacity(config, exceptions, write.date);
        if (write.count > maxCapacity && !confirmedOverride(writes, write.key, afterAppointments)) {
          throw new HttpsError("failed-precondition", "La franja seleccionada está llena.", {
            reason: "slot_full", date: write.date, time: write.time, maxCapacity,
          });
        }
      }
    }
    if (changed.size && maintenance?.phase === "frozen") transaction.set(db.doc("system_controls/release"), {
      occupancyVerifiedEpoch: null, occupancyAuditHash: null,
    }, { merge: true });
    for (const write of writes) {
      if (changed.size && write.ref.path.startsWith("slot_occupancy/")) continue;
      if (write.kind === "delete") transaction.delete(write.ref);
      else if (write.kind === "update") transaction.update(write.ref, write.data!);
      else if (write.kind === "create") transaction.create(write.ref, write.data!);
      else if (write.options) transaction.set(write.ref, write.data!, write.options as { merge: boolean });
      else transaction.set(write.ref, write.data!);
    }
    for (const write of planned.writes) transaction.set(db.collection("slot_occupancy").doc(write.key), {
      date: write.date, time: write.time, count: write.count,
    }, { merge: true });
    if (planned.clamped.length) transaction.create(db.collection("activity_logs").doc(), {
      action: "occupancy_release_inconsistency", keys: planned.clamped, createdAt: new Date().toISOString(),
    });
    if (invalidReleases.length) transaction.create(db.collection("activity_logs").doc(), {
      action: "occupancy_release_invalid_source", appointmentPaths: invalidReleases,
      reviewRequired: true, createdAt: new Date().toISOString(),
    });
    return result;
  });
}
