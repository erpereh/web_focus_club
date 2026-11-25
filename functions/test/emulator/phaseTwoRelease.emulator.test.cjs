const assert = require('node:assert/strict');
const test = require('node:test');
const { getFirestore } = require('firebase-admin/firestore');
const { enterDraining, freezeMaintenance, reopenMaintenance } = require('../../../scripts/release-controls.cjs');
const { CASES, OPERATION, auditRetiredOperations, resolveRetiredOperations } = require('../../../scripts/retired-operations.cjs');
const { remainingArtifacts } = require('../../../scripts/remaining-selective.cjs');
const { auditCounts, applyCounts, verifyCounts } = require('../../lib/slotOccupancyCounts.js');
const { getMadridDateKey } = require('../../lib/appointmentLifecycle.js');
const c = require('../../../scripts/release-common.cjs');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (!host || !project.startsWith('demo-')) throw new Error('The emulator and a demo-* project are required.');
const manifest = { projectId: project, releaseId: 'release-phase-two-test', manifestHash: 'b'.repeat(64), remainingSelective: {} };
const gate = 'system_controls/release';
const config = 'site_config/main';
const date = getMadridDateKey(new Date(Date.now() + 7 * 86_400_000));
const localManifest = c.readJson(c.path.join(c.root, 'release/manifest.json'));
const artifacts = remainingArtifacts(localManifest);
const load = name => require(c.path.join(c.root, artifacts.get(name).prefix, 'entry.cjs'))[name];
const selected = new Map([...artifacts.keys()].map(name => [name, load(name)]));
const db = getFirestore();
const operation = item => `release_operations/${item.id}`;
const receipt = item => `release_control_audits/retired-${item.id}`;
const counter = (time, day = date) => `slot_occupancy/${day}_${time}`;
const counterData = (time, count, day = date) => ({ time, count, date: day, source: 'keep' });
const read = async key => (await db.doc(key).get()).data();
const beforeOpen = () => assert.rejects(reopenMaintenance(db, manifest), /reapertura|ocupación completa/);

async function seed(docs) {
  const batch = db.batch();
  for (const [key, value] of Object.entries(docs)) batch.set(db.doc(key), value);
  await batch.commit();
}
async function reset() {
  const result = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(result.status, 200);
  await seed({ [gate]: { phase: 'open', releaseId: manifest.releaseId, epoch: 1, occupancyVersion: 2,
    occupancyVerifiedEpoch: 1, occupancyAuditHash: 'fixture' },
    [config]: { maxCapacity: 4, startHour: 7, endHour: 22, slotInterval: 15, maintenanceMode: false, automaticMinuteRefundsEnabled: false },
    'system_controls/deferred': { pending: 0 }, 'users/admin': { role: 'admin' }, 'users/customer': { role: 'user' },
    'bonos/untouched': { minutosRestantes: 180, historial: [] }, 'payments/untouched': { amount: 40 } });
}
test.beforeEach(reset);
test.after(async () => db.terminate());

const proof = { retired: { uid: 'old-revision' }, operations: CASES.map(item => ({ id: item.id, effect: 'unknown', eventId: item.eventId })) };
const getProof = async () => proof;
const approve = (report, options = {}) => ({ getProof, approvedHash: report.reportHash, reviewerUid: 'admin', acknowledged: true, ...options });

async function seedHistory() {
  await seed(Object.fromEntries(CASES.map(item => [operation(item), { state: 'active', operation: OPERATION, releaseId: manifest.releaseId,
    startedAt: item.startedAt, retained: { data: 'initial' } }])));
}

test('only the exact four reviewed abandoned operations are atomically interrupted, without replay', async () => {
  await seedHistory();
  await assert.rejects(enterDraining(db, manifest), /cero operaciones activas/);
  const first = await auditRetiredOperations(db, manifest, getProof);
  await assert.rejects(resolveRetiredOperations(db, manifest, first, approve(first, { acknowledged: false })), /aceptación/);
  await assert.rejects(resolveRetiredOperations(db, manifest, first, approve(first, { reviewerUid: 'customer' })), /administrador/);
  await db.doc(operation(CASES[1])).update({ retained: { data: 'new evidence' } });
  await assert.rejects(resolveRetiredOperations(db, manifest, first, approve(first)), /evidencia cambió/);
  const second = await auditRetiredOperations(db, manifest, getProof);
  const changedProof = () => ({ ...proof, retired: { uid: 'different' } });
  await assert.rejects(resolveRetiredOperations(db, manifest, second, approve(second, { getProof: changedProof })), /evidencia cambió/);
  assert.deepEqual(await Promise.all(CASES.map(async item => (await read(operation(item))).state)), Array(4).fill('active'));
  assert.equal((await db.collection('release_control_audits').get()).size, 0);
  assert.deepEqual(await resolveRetiredOperations(db, manifest, second, approve(second)), { alreadyResolved: false, operations: 4 });
  for (const item of CASES) {
    assert.equal((await read(operation(item))).state, 'interrupted');
    assert.equal((await read(operation(item))).startedAt, item.startedAt);
    const audit = await read(receipt(item));
    assert.equal(audit.evidence.eventId, item.eventId);
    assert.equal(audit.effect, 'unknown');
    assert.equal(audit.replayed, false);
  }
  assert.equal((await read(operation(CASES[1]))).retained.data, 'new evidence');
  for (const name of ['release_deferred_events', 'notification_outbox', 'email_dispatches', 'push_dispatches']) {
    assert.equal((await db.collection(name).get()).size, 0);
  }
  await enterDraining(db, manifest);
  await freezeMaintenance(db, manifest.releaseId, { manifestHash: manifest.manifestHash });
  assert.deepEqual(await resolveRetiredOperations(db, manifest, second, approve(second, { getProof: () => assert.fail('no replay') })),
    { alreadyResolved: true, operations: 4 });
  await beforeOpen();
});

const slot = time => ({ date, time });
const pending = (time, duration) => ({ userId: 'customer', status: 'pending', duration, preferredSlots: [slot(time)] });
const approved = (time, duration) => ({ userId: 'customer', status: 'approved', duration, approvedSlot: slot(time) });
const zeros = Array.from({ length: 20 }, (_, i) => `${String(12 + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`);
const fixed = ['07:30', '07:45', '08:00', '17:45', '18:00', '18:15', '18:30', '19:00', '19:15'];
async function seedCounts() {
  await seed({ 'appointments/a': pending('07:30', '45'), 'appointments/b': approved('17:45', '60'), 'appointments/c': pending('19:00', '30'),
    'appointments/no-seat': { ...approved('08:00', '30'), status: 'cancelled' },
    ...Object.fromEntries(zeros.map(time => [counter(time), counterData(time, 0)])),
    ...Object.fromEntries(fixed.filter(time => !['07:45', '08:00'].includes(time)).map(time => [counter(time), counterData(time, time === '07:30' ? 0 : 2)])),
  });
  await enterDraining(db, manifest);
  await freezeMaintenance(db, manifest.releaseId, { manifestHash: manifest.manifestHash });
}
const countOptions = report => ({ confirmProject: project, approvedReportHash: report.reportHash, reviewerUid: 'admin' });

test('the normal maintenance lifecycle repairs nine counters with a single resumable transaction and preserves twenty valid zeros', async () => {
  await seedCounts();
  const unaffected = await db.getAll(...zeros.map(time => db.doc(counter(time))));
  const appointments = (await db.collection('appointments').get()).docs;
  const { report, backup } = await auditCounts(db, project);
  assert.deepEqual(report.differences.map(item => item.id), fixed.map(time => `${date}_${time}`));
  assert.equal(report.validZeros.length, 20);
  assert.deepEqual(report.issues, []);
  assert.equal(backup.counters.filter(item => item.data === null).length, 2);
  assert.equal(backup.counters.find(item => item.id.endsWith('07:30')).data.source, 'keep');
  await beforeOpen();
  const results = await Promise.all([applyCounts(db, report, backup, countOptions(report)), applyCounts(db, report, backup, countOptions(report))]);
  assert.deepEqual(results.map(item => item.changed).sort(), [0, 9]);
  const current = await auditCounts(db, project);
  assert.deepEqual(current.report.differences, []);
  assert.equal(current.report.counters, 29);
  assert.equal((await read(counter('07:30'))).source, 'keep');
  const after = await db.getAll(...unaffected.map(doc => doc.ref), ...appointments.map(doc => doc.ref));
  for (const [i, before] of [...unaffected, ...appointments].entries()) assert.ok(before.updateTime.isEqual(after[i].updateTime));
  await beforeOpen();
  await verifyCounts(db, report);
  const verified = await read(gate);
  await verifyCounts(db, report);
  assert.deepEqual(await read(gate), verified);
  await reopenMaintenance(db, manifest);
  assert.equal((await read(gate)).phase, 'open');
  assert.equal((await read(config)).maintenanceMode, false);
  assert.equal((await read(config)).automaticMinuteRefundsEnabled, false);
  assert.deepEqual(await read('bonos/untouched'), { minutosRestantes: 180, historial: [] });
  assert.deepEqual(await read('payments/untouched'), { amount: 40 });
});

test('stale and corrupt backups, changed zero-counter versions and undisclosed queue work all stop the repair or reopen', async () => {
  await db.doc('release_deferred_events/race').set({ state: 'pending' });
  await assert.rejects(enterDraining(db, manifest), /cola vacía/);
  await db.doc('release_deferred_events/race').update({ state: 'completed' });
  await seedCounts();
  const old = await auditCounts(db, project);
  await assert.rejects(applyCounts(db, old.report, { ...old.backup, counters: [] }, countOptions(old.report)), /respaldo íntegro/);
  await db.doc(counter(zeros[0])).update({ source: 'concurrent-change' });
  await assert.rejects(applyCounts(db, old.report, old.backup, countOptions(old.report)), /Cambió un contador/);
  assert.equal((await auditCounts(db, project)).report.differences.length, 9);
  const fresh = await auditCounts(db, project);
  await applyCounts(db, fresh.report, fresh.backup, countOptions(fresh.report));
  await verifyCounts(db, fresh.report);
  await db.doc('release_deferred_events/race').update({ state: 'ready' });
  await beforeOpen();
  assert.equal((await read(gate)).phase, 'frozen');
  await db.doc('release_deferred_events/race').update({ state: 'completed' });
  await db.doc(counter(zeros[0])).update({ source: 'changed-after-verification' });
  await beforeOpen();
  const audit = await auditCounts(db, project);
  assert.deepEqual(audit.report.differences, []);
  assert.deepEqual(await applyCounts(db, audit.report, audit.backup, countOptions(audit.report)), { changed: 0, alreadyApplied: false });
  await verifyCounts(db, audit.report);
  await reopenMaintenance(db, manifest);
});

test('a scheduled event queued during draining is preserved and cannot authorize repair or reopen', async () => {
  await enterDraining(db, manifest);
  await db.doc('release_deferred_events/scheduled').set({ state: 'pending', name: 'appointmentRemindersScheduled' });
  await freezeMaintenance(db, manifest.releaseId, { manifestHash: manifest.manifestHash });
  const { report, backup } = await auditCounts(db, project);
  assert.equal(report.phase, 'frozen');
  assert.equal(report.idle, false);
  await assert.rejects(applyCounts(db, report, backup, countOptions(report)), /Informe de conteos inválido/);
  await beforeOpen();
  assert.equal((await read('release_deferred_events/scheduled')).state, 'pending');
});

test('compiled selected handlers require occupancy v2 and keep explicit capacity acknowledgement', async () => {
  const request = data => ({ auth: { uid: 'admin', token: { email: 'admin@example.test' } }, data });
  const event = (id, params) => ({ id, params, subject: 'documents/fixtures/' + id });
  await db.doc(gate).update({ occupancyVersion: 1 });
  for (const name of ['createUserFromAdmin', 'updateMaxCapacityFromAdmin']) {
    await assert.rejects(selected.get(name).run(request({})), error => error.details?.reason === 'occupancy_not_ready');
  }
  await db.doc(gate).update({ occupancyVersion: 2 });
  await selected.get('onUserProfileCreatedWelcomeEmail').run(event('welcome', { uid: 'example' }));
  await selected.get('onNotificationOutboxCreated').run(event('outbox', { operationId: 'example' }));
  await seed({ [counter('09:00')]: counterData('09:00', 3) });
  const update = selected.get('updateMaxCapacityFromAdmin');
  const reduction = { maxCapacity: 2, requestId: 'test-reduction' };
  let payload;
  await assert.rejects(update.run(request(reduction)), error => {
    payload = error.details?.fingerprint;
    return error.code === 'failed-precondition' && error.details.restrictions?.length === 1 && typeof payload === 'string';
  });
  assert.equal((await read(config)).maxCapacity, 4);
  const confirmed = { ...reduction, acknowledgedRestrictions: payload };
  const changed = await update.run(request(confirmed));
  assert.equal(changed.maxCapacity, 2);
  assert.equal((await update.run(request(confirmed))).replayed, true);
  assert.equal((await read(counter('09:00'))).count, 3);
  assert.equal((await db.collection('appointments').get()).size, 0);
  assert.equal((await db.collection('notification_outbox').get()).size, 0);
  assert.equal((await db.collection('release_operations').get()).size, 0);
});
