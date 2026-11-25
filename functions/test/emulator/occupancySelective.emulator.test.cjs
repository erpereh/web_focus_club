const assert = require('node:assert/strict');
const test = require('node:test');
const { getFirestore } = require('firebase-admin/firestore');
const c = require('../../../scripts/release-common.cjs');
const { selectiveArtifacts } = require('../../../scripts/occupancy-selective.cjs');
const { getMadridDateKey, getCanonicalSlotBlocks } = require('../../lib/appointmentLifecycle.js');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (!host || !project.startsWith('demo-')) throw new Error('These tests require the Firestore emulator and a demo-* project.');

const manifest = c.readJson(c.path.join(c.root, 'release/manifest.json'));
const artifacts = selectiveArtifacts(manifest);
const handlers = new Map();
for (const [name, artifact] of artifacts) {
  const selective = require(c.path.join(c.root, artifact.prefix, 'entry.cjs'));
  assert.deepEqual(Object.keys(selective), [name]);
  const old = require(c.path.join(c.root, c.path.dirname(artifact.baseConfig), 'functions/lib/index.js'));
  handlers.set(name, { selective: selective[name], old: old[name] });
}
const db = getFirestore();
const day = getMadridDateKey(new Date(Date.now() + 7 * 86400000));
const day2 = getMadridDateKey(new Date(Date.now() + 14 * 86400000));
const open = { phase: 'open', releaseId: manifest.releaseId, epoch: 1, occupancyVersion: 2, occupancyVerifiedEpoch: 1, occupancyAuditHash: 'fixture' };
const request = (uid, data) => ({ auth: { uid, token: { email: uid + '@example.com', email_verified: true } }, data });
const call = (name, packageType, uid, data) => handlers.get(name)[packageType].run(request(uid, data));
const read = async path => (await db.doc(path).get()).data();
const balance = () => read('bonos/bono-1');
const counter = (date, time, count) => [`slot_occupancy/${date}_${time}`, { date, time, count }];
const seats = async (date, time) => (await read(`slot_occupancy/${date}_${time}`))?.count ?? 0;
const blockCounts = (date, time, duration) => Promise.all(getCanonicalSlotBlocks(time, duration).map(key => seats(date, key)));
const shape = (status, time, duration = '45', more = {}) => ({
  userId: 'customer', status, date: day, time, duration, preferredSlots: [{ date: day, time }],
  ...(status === 'approved' ? { approvedSlot: { date: day, time } } : {}), serviceType: 'training',
  bonoId: 'bono-1', ...more,
});
async function seed(writes) {
  const batch = db.batch();
  for (const [key, data] of Object.entries(writes)) batch.set(db.doc(key), data);
  await batch.commit();
}
async function reset() {
  const clear = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(clear.ok);
  await seed({
    'system_controls/release': open,
    'site_config/main': { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4, capacityExceptionsEnabled: true, automaticMinuteRefundsEnabled: false, minBookingNoticeHours: 24 },
    'users/admin': { role: 'admin', name: 'Admin', email: 'admin@example.com' },
    'users/customer': { role: 'user', name: 'Client', email: 'customer@example.com' },
    'trainers/pt': { active: true, name: 'PT' },
    'services/training': { active: true, title: 'Training' },
    'bonos/bono-1': { userId: 'customer', estado: 'activo', tamano: 240, minutosTotales: 240, minutosRestantes: 180, fechaExpiracion: '2099-12-31', historial: [] },
  });
}
test.beforeEach(reset);
test.after(() => db.terminate());

function accountingState(data) {
  return { ...data, historial: data.historial.map(({ fecha, appointmentId, ...entry }) => entry) };
}
async function noNewRefundSystem() {
  for (const collection of ['minute_refunds', 'minute_refund_accounts', 'minute_refund_receipts', 'payments']) {
    assert.equal((await db.collection(collection).get()).size, 0, collection);
  }
}

test('recurring admin callable preserves debit, financial history and response contract through an idempotent replay', async () => {
  const endpoint = 'createRecurringAppointmentsFromAdmin';
  const data = { userId: 'customer', date: day, time: '10:00', endDate: day2, intervalDays: 7, duration: '30',
    serviceType: 'training', assignedTrainer: 'pt', requestId: 'retry-series-fixture' };
  const results = [];
  for (const variant of ['old', 'selective']) {
    await reset();
    const response = await call(endpoint, variant, 'admin', data);
    const replay = await call(endpoint, variant, 'admin', data);
    assert.equal(replay.replayed, true);
    const ledger = await balance();
    assert.equal(ledger.minutosRestantes, 120);
    assert.equal(ledger.historial.length, 2);
    assert.deepEqual(await blockCounts(day, '10:00', 30), [1, 1]);
    assert.deepEqual(await blockCounts(day2, '10:00', 30), [1, 1]);
    await noNewRefundSystem();
    results.push({ keys: Object.keys(response).sort(), ledger: accountingState(ledger) });
  }
  assert.deepEqual(results[0], results[1]);
});

test('deleting a pending and approved session releases all seats, with the same capped legacy refund and archive', async () => {
  const endpoint = 'deleteAppointmentsFromAdmin';
  const output = [];
  for (const variant of ['old', 'selective']) {
    await reset();
    await seed({
      'appointments/pending': shape('pending', '10:00', '45', { minutesDeducted: true, minutesDeductedAmount: 45, minutesDeductedAt: '2026-01-01T10:00:00.000Z' }),
      'appointments/approved': shape('approved', '10:15', '60', { minutesDeducted: true, minutesDeductedAmount: 60, minutesDeductedAt: '2026-01-01T10:00:00.000Z' }),
      ...Object.fromEntries(['10:00','10:15','10:30','10:45','11:00'].map((time,i) => counter(day, time, [1,2,2,1,1][i]))),
    });
    const data = { appointmentIds: ['pending','approved'] };
    const result = await call(endpoint, variant, 'admin', data);
    const replay = await call(endpoint, variant, 'admin', data);
    assert.deepEqual(replay.alreadyDeletedIds.sort(), ['approved', 'pending']);
    assert.deepEqual(await blockCounts(day, '10:00', 60), variant === 'selective' ? [0,0,0,0] : [1,1,1,0]);
    assert.equal(await seats(day, '11:00'), 0);
    assert.equal((await balance()).minutosRestantes, 240);
    await noNewRefundSystem();
    const finance = records => records.map(item => {
      const { ttl, ...value } = item;
      void ttl;
      return value;
    });
    output.push({ result, ledger: accountingState(await balance()), finance: finance(await Promise.all(['pending','approved']
      .map(async id => (await read('appointment_deletions/' + id)).finance))) });
  }
  assert.deepEqual(output[0], output[1]);
});

test('client move keeps shared pending seats, respects a date-specific full block, and never touches the ledger', async () => {
  const endpoint = 'updateOwnAppointmentSlot';
  const before = await balance();
  await seed({
    'appointments/move': shape('pending', '10:00', '45'),
    [`capacity_exceptions/${day}`]: { date: day, maxCapacity: 1 },
    ...Object.fromEntries(['10:00','10:15','10:30','10:45'].map(time => counter(day,time,1))),
  });
  const data = { appointmentId: 'move', preferredSlot: { date: day, time: '10:15' } };
  await assert.rejects(call(endpoint, 'selective', 'customer', data), error => error.details?.reason === 'slot_full');
  assert.equal((await read('appointments/move')).time, '10:00');
  assert.deepEqual(await blockCounts(day, '10:00', 60), [1,1,1,1]);
  await db.doc(`slot_occupancy/${day}_10:45`).set({ count: 0 }, { merge: true });
  assert.deepEqual(await call(endpoint, 'selective', 'customer', data), { success: true, appointmentId: 'move' });
  assert.deepEqual(await blockCounts(day, '10:00', 60), [0,1,1,1]);
  assert.deepEqual(await call(endpoint, 'selective', 'customer', data), { success: true, appointmentId: 'move' });
  assert.deepEqual(await blockCounts(day, '10:00', 60), [0,1,1,1]);
  assert.deepEqual(await balance(), before);
  await noNewRefundSystem();
});

test('selective callables deny both draining and frozen and preserve the 24-hour lock', async () => {
  for (const phase of ['draining', 'frozen']) {
    await db.doc('system_controls/release').set({ ...open, phase });
    for (const name of handlers.keys()) {
      await assert.rejects(call(name, 'selective', 'admin', {}), error => error.details?.reason === 'maintenance');
    }
  }
  await db.doc('system_controls/release').set(open);
  const date = getMadridDateKey(new Date(Date.now() + 3600000));
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(Date.now() + 3600000));
  await db.doc('appointments/locked').set({ ...shape('approved', time, '60'), date, approvedSlot: { date, time } });
  await assert.rejects(call('updateOwnAppointmentSlot', 'selective', 'customer', { appointmentId: 'locked', preferredSlot: { date: day, time: '10:00' } }),
    error => error.details?.reason === 'one_day_change_not_allowed');
  assert.equal((await balance()).minutosRestantes, 180);
  assert.equal((await db.collection('release_operations').get()).size, 0);
});
