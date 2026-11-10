// Real Admin SDK + Firestore emulator only. No production database is permitted.
// Compare the removed eager import/duplicated financial reads with the new code.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
if (!host || !projectId.startsWith("demo-")) throw new Error("Load tests require the Firestore emulator and a demo-* project.");
if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error("Use Node 22 to match the production runtime.");
const historyEntries = Number(process.env.APPOINTMENT_BENCHMARK_HISTORY_ENTRIES ?? 1000);
if (!Number.isInteger(historyEntries) || historyEntries < 1 || historyEntries > 5000) throw new Error("History entries must be between 1 and 5000.");

const worker = process.argv.find((arg) => arg.startsWith("--worker="))?.split("=")[1];
if (!worker) {
  for (const variant of ["legacy-baseline", "optimized"]) {
    // This limits the JS heap, not container RSS. RSS is measured separately.
    const result = spawnSync(process.execPath, ["--expose-gc", "--max-old-space-size=384", __filename, `--worker=${variant}`], {
      env: process.env, encoding: "utf8", timeout: 180000, maxBuffer: 2 * 1024 * 1024,
    });
    const line = result.stdout?.split(/\r?\n/).find((item) => item.startsWith("BENCHMARK "));
    if (line) console.log(line);
    if (result.status !== 0) {
      const reason = /heap out of memory|heap limit/i.test(result.stderr ?? "") ? "heap_limit" : result.error?.code ?? "worker_failed";
      console.log(`BENCHMARK ${JSON.stringify({ variant, completed: false, reason, status: result.status })}`);
      if (variant === "optimized") {
        console.error(result.stderr?.slice(-2500));
        process.exitCode = 1;
      }
    }
  }
} else {
  run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
}

async function run() {
  const start = performance.now();
  if (worker === "legacy-baseline") require("googleapis");
  require("../lib/index.js");
  const startupMs = performance.now() - start;
  const startupRssMiB = process.memoryUsage().rss / 1048576;
  const finance = require("../lib/appointmentFinance.js");
  if (worker === "legacy-baseline") {
    finance.createFinanceContextReader = (tx, db) => (appointment) => finance.readFinanceContext(tx, db, appointment);
  }
  const { getFirestore } = require("firebase-admin/firestore");
  const db = getFirestore();
  const { logger } = require("firebase-functions");
  const entries = [];
  for (const method of ["info", "warn", "error"]) logger[method] = (_message, entry) => entries.push(entry);
  const { observeAdminAppointmentOperation } = require("../lib/adminAppointmentRuntime.js");
  const deps = { db, requireAdmin: async () => undefined, getNowDate: () => new Date("2026-11-10T10:00:00Z") };
  const status = require("../lib/adminAppointmentStatus.js").createAdminAppointmentStatusHandlers(deps);
  const schedule = require("../lib/adminAppointmentReschedule.js").createAdminAppointmentRescheduleHandlers(deps);
  const remove = observeAdminAppointmentOperation("delete", status.deleteAppointmentsFromAdmin);
  const replace = observeAdminAppointmentOperation("replace", schedule.replaceRecurringSeriesScheduleFromAdmin);
  const call = (data) => ({ auth: { uid: "admin", token: {} }, data });
  const history = Array.from({ length: historyEntries }, (_, i) => ({ fecha: "2026-01-01T10:00:00Z", accion: "descuento_cita", appointmentId: `historic-${i}`, duracion: "60" }));
  let peakRssMiB = startupRssMiB;
  const sample = () => { peakRssMiB = Math.max(peakRssMiB, process.memoryUsage().rss / 1048576, process.resourceUsage().maxRSS / 1024); };
  const timer = setInterval(sample, 20);
  const cycles = [];
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const reset = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
      assert.equal(reset.ok, true);
      const batch = db.batch();
      batch.set(db.doc("site_config/main"), { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 500 });
      for (let group = 0; group < 5; group += 1) {
        batch.set(db.doc(`bonos/b${group}`), { userId: `u${group}`, estado: "activo", minutosTotales: 2400, tamano: 2400, minutosRestantes: 0, fechaExpiracion: "2028-01-01T00:00:00Z", historial: history });
        for (let i = 0; i < 40; i += 1) batch.set(db.doc(`appointments/a${group}_${i}`), {
          userId: `u${group}`, bonoId: `b${group}`, status: "approved", duration: "60",
          approvedSlot: { date: `2026-12-${20 + group}`, time: "10:00" },
          minutesDeducted: true, minutesDeductedAt: "2026-11-01T10:00:00Z", minutesDeductedAmount: 60,
        });
        for (const time of ["10:00", "10:15", "10:30", "10:45"]) batch.set(db.doc(`slot_occupancy/2026-12-${20 + group}_${time}`), { date: `2026-12-${20 + group}`, time, count: 40 });
      }
      await batch.commit();
      const deletionStart = performance.now();
      await Promise.all(Array.from({ length: 5 }, (_, group) => remove(call({ appointmentIds: Array.from({ length: 40 }, (_, i) => `a${group}_${i}`) }))));
      const deletionMs = performance.now() - deletionStart;
      for (let group = 0; group < 5; group += 1) {
        const bono = (await db.doc(`bonos/b${group}`).get()).data();
        assert.equal(bono.minutosRestantes, 2400);
        assert.equal(bono.historial.length, historyEntries + 40);
        assert.equal((await db.doc(`slot_occupancy/2026-12-${20 + group}_10:00`).get()).data().count, 0);
      }
      const seriesBatch = db.batch();
      const dateAt = (index, offset = 0) => new Date(Date.UTC(2027, 0, 5 + index * 7 + offset)).toISOString().slice(0, 10);
      for (let group = 0; group < 5; group += 1) {
        seriesBatch.set(db.doc(`users/u${group}`), { uid: `u${group}`, role: "user" });
        seriesBatch.set(db.doc(`bonos/b${group}`), { minutosRestantes: 1200 }, { merge: true });
        seriesBatch.set(db.doc(`appointment_recurrences/s${group}`), {
          userId: `u${group}`, bonoId: `b${group}`, status: "pending", duration: "60", intervalDays: 7,
          occurrenceCount: 20, totalMinutes: 1200, startDate: dateAt(0), startTime: "10:00", endDate: dateAt(19), origin: "admin",
        });
        for (let i = 0; i < 20; i += 1) seriesBatch.set(db.doc(`appointments/s${group}_${i}`), {
          userId: `u${group}`, bonoId: `b${group}`, recurrenceSeriesId: `s${group}`, recurrenceIndex: i,
          status: "pending", duration: "60", preferredSlots: [{ date: dateAt(i), time: "10:00" }],
          minutesDeducted: true, minutesDeductedAt: "2026-11-01T10:00:00Z", minutesDeductedAmount: 60,
        });
      }
      await seriesBatch.commit();
      const replacementStart = performance.now();
      await Promise.all(Array.from({ length: 5 }, (_, group) => replace(call({
        appointmentId: `s${group}_0`, startSlot: { date: dateAt(0, 1), time: "11:00" }, endDate: dateAt(19, 1), assignedTrainer: null, requestId: `load_series_${cycle}_${group}`,
      }))));
      const replacementMs = performance.now() - replacementStart;
      for (let group = 0; group < 5; group += 1) {
        assert.equal((await db.doc(`appointment_recurrences/s${group}`).get()).data().occurrenceCount, 20);
        const bono = (await db.doc(`bonos/b${group}`).get()).data();
        assert.equal(bono.minutosRestantes, 1200);
        assert.equal(bono.historial.length, historyEntries + 40);
      }
      sample();
      global.gc();
      cycles.push({ deletionMs: Math.round(deletionMs), replacementMs: Math.round(replacementMs), postGcRssMiB: Math.round(process.memoryUsage().rss / 1048576), postGcHeapMiB: Math.round(process.memoryUsage().heapUsed / 1048576) });
    }
  } finally { clearInterval(timer); }
  const deleteEntries = entries.filter((entry) => entry.operation === "delete");
  const deleteReads = deleteEntries.map((entry) => entry.documentsRead);
  const deleteReadsPerAttempt = deleteEntries.map((entry) => entry.documentsRead / entry.attempts);
  if (worker === "optimized") {
    assert.ok(peakRssMiB < 410, `512 MiB must keep at least 20% headroom; peak=${peakRssMiB}`);
    assert.ok(cycles.every((cycle) => cycle.deletionMs < 45000 && cycle.replacementMs < 45000), "operations must stay below 60s with margin");
    assert.ok(cycles.at(-1).postGcHeapMiB <= cycles[0].postGcHeapMiB + 20, "heap must settle across repeated workloads");
    assert.ok(cycles.at(-1).postGcRssMiB <= cycles[0].postGcRssMiB + 32, "native and JS memory must settle across repeated workloads");
    // An attempt aborted during a read can return fewer snapshots. There must
    // still be a complete committed attempt and no duplicated financial reads.
    assert.ok(deleteEntries.every((entry) => entry.documentsRead >= 46 && entry.documentsRead <= 46 * entry.attempts), "at most 40 appointments + 2 financial documents + 4 counters per attempt, including retries");
  }
  console.log(`BENCHMARK ${JSON.stringify({ variant: worker, completed: true, node: process.version, concurrentRequests: 5, deletionsPerRequest: 40, seriesOccurrences: 20, historyEntries, startupMs: Math.round(startupMs), startupRssMiB: Math.round(startupRssMiB), peakRssMiB: Math.round(peakRssMiB), deleteDocumentsReadPerRequest: deleteReads, deleteDocumentsReadPerAttempt: deleteReadsPerAttempt, transactionAttempts: deleteEntries.map((entry) => entry.attempts), cycles })}`);
  await db.terminate();
}
