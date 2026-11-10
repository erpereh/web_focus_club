const assert = require("node:assert/strict");
const test = require("node:test");
const { createFinanceContextReader, resolveRefundTarget } = require("../lib/appointmentFinance.js");
const { createAdminAppointmentStatusHandlers } = require("../lib/adminAppointmentStatus.js");
const { FakeFirestore, callable } = require("./helpers/transactionalFakes.cjs");
const NOW = new Date("2026-11-10T10:00:00Z");
const DAY = "2026-11-20";

function fixture(count = 40) {
  const history = Array.from({ length: 5000 }, (_, i) => ({ fecha: "2026-01-01", appointmentId: `old-${i}`, accion: "descuento_cita" }));
  const docs = { "bonos/b": { userId: "u", estado: "activo", tamano: 2400, minutosTotales: 2400, minutosRestantes: 0, fechaExpiracion: "2028-01-01T00:00:00Z", historial: history } };
  for (let i = 0; i < count; i += 1) docs[`appointments/a${i}`] = {
    userId: "u", bonoId: "b", status: "approved", duration: "60", approvedSlot: { date: DAY, time: "10:00" },
    minutesDeducted: true, minutesDeductedAt: "2026-11-01T10:00:00Z", minutesDeductedAmount: 60,
  };
  for (const time of ["10:00", "10:15", "10:30", "10:45"]) docs[`slot_occupancy/${DAY}_${time}`] = { date: DAY, time, count };
  return docs;
}
const handlers = (db) => createAdminAppointmentStatusHandlers({ db, requireAdmin: async () => undefined, getNowDate: () => NOW });

test("forty deletions read each financial resource once and accumulate every refund without loading history", async () => {
  const db = new FakeFirestore(fixture());
  const ids = Array.from({ length: 40 }, (_, i) => `a${i}`);
  const result = await handlers(db).deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ids }));
  assert.equal(result.refundedIds.length, 40);
  assert.equal(result.deletedIds.length, 40);
  assert.equal(db.doc("bonos/b").minutosRestantes, 2400);
  assert.equal(db.doc("bonos/b").historial.length, 5040);
  assert.equal(db.doc("bonos/b").historial[0].appointmentId, "old-0");
  for (const time of ["10:00", "10:15", "10:30", "10:45"]) assert.equal(db.doc(`slot_occupancy/${DAY}_${time}`).count, 0);
  const reads = db.reads.filter((read) => read.target.startsWith("bonos"));
  assert.equal(reads.length, 2, "one original document and one active-bono query");
  assert.ok(reads.every((read) => read.fields && !read.fields.includes("historial")));
  assert.equal(db.writes.filter((write) => write.path.startsWith("appointment_deletions/")).length, 40);
  const repeat = await handlers(db).deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ids }));
  assert.deepEqual(repeat.alreadyDeletedIds, ids);
  assert.equal(db.doc("bonos/b").historial.length, 5040);
});

test("a retried deletion rebuilds the financial cache and uses the latest balance", async () => {
  const db = new FakeFirestore(fixture(2));
  let injected = false;
  db.beforeCommit = async () => {
    if (injected) return;
    injected = true;
    await db.collection("bonos").doc("b").set({ minutosRestantes: 180 }, { merge: true });
  };
  await handlers(db).deleteAppointmentsFromAdmin(callable("admin", { appointmentIds: ["a0", "a1"] }));
  assert.equal(db.attempts, 2);
  assert.equal(db.doc("bonos/b").minutosRestantes, 300);
  assert.equal(db.doc("bonos/b").historial.length, 5002);
  for (const attempt of [1, 2]) assert.equal(db.reads.filter((read) => read.attempt === attempt && read.target.startsWith("bonos")).length, 2);
});

test("parallel readers keep separate users and all active bonos, including ambiguous and replaced cases", async () => {
  const db = new FakeFirestore({
    "bonos/old": { userId: "u", estado: "agotado", replacedByBonoId: "current", minutosTotales: 600, minutosRestantes: 0, historial: ["large"] },
    "bonos/current": { userId: "u", estado: "activo", sesionesTotales: 10, sesionesRestantes: 3, modalidad: "30min", fechaExpiracion: "2028-01-01T00:00:00Z" },
    "bonos/other": { userId: "v", estado: "activo", minutosTotales: 600, minutosRestantes: 600 },
  });
  await db.runTransaction(async (tx) => {
    const read = createFinanceContextReader(tx, db);
    const [a, b, other] = await Promise.all([read({ userId: "u", bonoId: "old" }), read({ userId: "u", bonoId: "old" }), read({ userId: "v", bonoId: "old" })]);
    assert.equal(a.originalBono, b.originalBono);
    assert.equal(a.activeBonos, b.activeBonos);
    assert.deepEqual(other.activeBonos.map((snap) => snap.id), ["other"]);
    assert.equal(a.originalBono.data().historial, undefined);
    const target = resolveRefundTarget({ userId: "u", bonoId: "old" }, a, NOW);
    assert.equal(target.kind, "bono");
    assert.equal(target.snap.id, "current");
    assert.equal(target.bono.sesionesRestantes, 3);
  });
  assert.equal(db.reads.filter((read) => read.target === "bonos/old").length, 1);
  assert.equal(db.reads.filter((read) => read.target === "bonos").length, 2);
});
