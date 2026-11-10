const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { logger } = require("firebase-functions");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  adminAppointmentError, observeAdminAppointmentOperation, runAdminAppointmentTransaction, measureAdminPhase,
} = require("../lib/adminAppointmentRuntime.js");
const { FakeFirestore } = require("./helpers/transactionalFakes.cjs");

test("cold entrypoint avoids googleapis and configures exactly the four appointment callables", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const functions = require('./lib/index.js');
    const names = ['updateAppointmentStatusFromAdmin', 'deleteAppointmentsFromAdmin', 'rescheduleAppointmentFromAdmin', 'replaceRecurringSeriesScheduleFromAdmin'];
    const settings = names.map(name => ({ name, ...functions[name].__endpoint }));
    console.log(JSON.stringify({ settings, googleModules: Object.keys(require.cache).filter(path => /[\\\\/]node_modules[\\\\/]googleapis[\\\\/]/.test(path)) }));
    process.exit(0);
  `], { cwd: require("node:path").join(__dirname, ".."), encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const { settings, googleModules } = JSON.parse(result.stdout);
  assert.deepEqual(googleModules, []);
  for (const setting of settings) {
    assert.equal(setting.availableMemoryMb, 512, setting.name);
    assert.equal(setting.concurrency, 5, setting.name);
    assert.equal(setting.cpu, 1, setting.name);
    assert.equal(setting.timeoutSeconds, 60, setting.name);
    assert.deepEqual(setting.region, ["europe-west1"]);
    assert.deepEqual(setting.callableTrigger, {});
  }
});

test("deferred Calendar module still constructs the same authenticated v3 client", async () => {
  const sdk = await import("googleapis/build/src/apis/calendar/index.js");
  const auth = new sdk.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/calendar"] });
  const client = sdk.calendar({ version: "v3", auth });
  assert.equal(typeof client.events.insert, "function");
  assert.equal(typeof client.events.update, "function");
  assert.equal(typeof client.events.delete, "function");
  assert.equal(client.context._options.auth, auth);
});

test("business errors retain object identity, codes, reasons and override details", () => {
  const error = new HttpsError("failed-precondition", "La cita ha cambiado.", { reason: "status_changed", currentStatus: "cancelled" });
  assert.equal(adminAppointmentError(error, "trace"), error);
});

test("infrastructure errors are callable errors with safe messages and correlation IDs", () => {
  for (const [code, expected] of [[4, "deadline-exceeded"], [8, "resource-exhausted"], [10, "aborted"], [14, "unavailable"], ["UNAVAILABLE", "unavailable"], ["DEADLINE_EXCEEDED", "deadline-exceeded"], ["unrecognised", "internal"]]) {
    const error = adminAppointmentError(Object.assign(new Error("private payload / email / credentials"), { code }), "correlation");
    assert.equal(error.code, expected);
    assert.equal(error.details.operationId, "correlation");
    assert.match(error.message, /comprobar el resultado antes de repetir/);
    assert.doesNotMatch(error.message, /private|credentials/);
  }
});

test("observations isolate simultaneous requests and include committed transaction retries", async (t) => {
  const entries = [];
  for (const method of ["info", "warn", "error"]) t.mock.method(logger, method, (_message, entry) => entries.push(entry));
  const db = new FakeFirestore({ "values/a": { count: 1 } });
  let injected = false;
  db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    await db.collection("values").doc("a").set({ count: 10 });
  };
  const update = observeAdminAppointmentOperation("update", () => measureAdminPhase("authorization", async () => {
    return runAdminAppointmentTransaction(db, async (tx) => {
      const ref = db.collection("values").doc("a");
      const snap = await tx.get(ref);
      tx.set(ref, { count: snap.data().count + 1 });
      return { success: true };
    });
  }));
  const read = observeAdminAppointmentOperation("read", () => runAdminAppointmentTransaction(db, (tx) => tx.get(db.collection("values"))));
  await Promise.all([update({ data: "must never be logged" }), read({})]);
  assert.equal(db.doc("values/a").count, 11);
  const updateLog = entries.find((entry) => entry.operation === "update");
  const readLog = entries.find((entry) => entry.operation === "read");
  assert.ok(updateLog.attempts >= 2);
  assert.equal(updateLog.documentsRead, updateLog.attempts);
  assert.equal(updateLog.stagedWrites, updateLog.attempts);
  assert.equal(readLog.stagedWrites, 0);
  assert.ok(updateLog.phasesMs.transaction >= 0);
  assert.ok(readLog.activeAtStart >= 2);
  assert.notEqual(updateLog.operationId, readLog.operationId);
  assert.doesNotMatch(JSON.stringify(entries), /must never be logged/);
  await observeAdminAppointmentOperation("after", async () => true)({});
  assert.equal(entries.at(-1).activeAtStart, 1);
});

test("observed failures never return success and release request telemetry", async (t) => {
  const entries = [];
  for (const method of ["info", "warn", "error"]) t.mock.method(logger, method, (_message, entry) => entries.push(entry));
  const failed = observeAdminAppointmentOperation("failed", async () => { throw Object.assign(new Error("secret"), { code: 10 }); });
  await assert.rejects(failed({}), (error) => error.code === "aborted");
  await observeAdminAppointmentOperation("next", async () => true)({});
  assert.equal(entries[0].outcome, "aborted");
  assert.equal(entries[1].activeAtStart, 1);
});

test("logging failure cannot change a committed result or replace a business error", async (t) => {
  for (const method of ["info", "warn", "error"]) t.mock.method(logger, method, () => { throw new Error("log transport unavailable"); });
  const db = new FakeFirestore();
  const result = await observeAdminAppointmentOperation("commit", () => runAdminAppointmentTransaction(db, async (tx) => {
    tx.set(db.collection("values").doc("committed"), { done: true });
    return { success: true };
  }))({});
  assert.deepEqual(result, { success: true });
  assert.deepEqual(db.doc("values/committed"), { done: true });
  const business = new HttpsError("failed-precondition", "Estado modificado.", { reason: "status_changed" });
  await assert.rejects(observeAdminAppointmentOperation("fail", async () => { throw business; })({}), (error) => error === business);
});
