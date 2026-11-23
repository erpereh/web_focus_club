const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createCalendarCutover, reconcileAppointmentCalendar } = require('../../lib/googleCalendarReconciliation.js');
const { stableCalendarEventId, calendarEventAppointmentIds, CALENDAR_SYNC_HASH_PROPERTY } = require('../../lib/googleCalendarSync.js');

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (!process.env.FIRESTORE_EMULATOR_HOST || !projectId.startsWith('demo-')) throw new Error('Emulator required.');
initializeApp({ projectId });
const db = getFirestore();
const pending = { status: 'pending', preferredSlots: [{ date: '2026-12-01', time: '10:00' }], duration: 45 };
const approved = { status: 'approved', approvedSlot: { date: '2026-12-01', time: '12:00' } };

function setup() {
  const ref = db.collection('appointments').doc(randomUUID());
  const state = db.collection('google_calendar_sync').doc(ref.id);
  const id = stableCalendarEventId(ref.id);
  const events = new Map(), calls = [], errors = [];
  let eventVersion = 0, clock = Date.now();
  function save(id, event) { events.set(id, { ...event, id, etag: `etag-${++eventVersion}` }); }
  const remote = {
    async find(appointmentId) {
      return [...events.values()].filter(event => event.status !== 'cancelled' && calendarEventAppointmentIds(event).includes(appointmentId));
    },
    async get(eventId) { calls.push(['get', eventId]); return events.get(eventId); },
    async insert(eventId, event) {
      calls.push(['insert', eventId]);
      if (events.has(eventId)) throw { code: 409 };
      save(eventId, event);
    },
    async patch(eventId, etag, event) {
      calls.push(['patch', eventId]);
      assert.equal(events.get(eventId)?.etag, etag);
      save(eventId, event);
    },
    async delete(eventId, etag) {
      calls.push(['delete', eventId]);
      assert.equal(events.get(eventId)?.etag, etag);
      save(eventId, { status: 'cancelled' });
    },
  };
  const sync = (more = {}) => reconcileAppointmentCalendar({ db, ref, remote: () => remote,
    resolveDetails: async () => ({ client: { name: 'Ana', email: '', phone: '' }, trainerName: '' }),
    reportError: (...error) => errors.push(error), now: () => clock, ...more });
  return { ref, state, id, events, calls, errors, remote, save, sync, waitOutLease: () => { clock += 91_000; } };
}

test.after(() => db.terminate());

test('creation, approval, duplicate trigger and out-of-order old trigger converge on one ID', async () => {
  const { ref, id, events, sync, calls } = setup();
  await ref.set(pending);
  await sync();
  assert.match(events.get(id).summary, /^Pendiente/);
  await ref.update(approved);
  await sync();
  await sync({ previousEventId: 'ignored-stale-link' });
  assert.equal(events.size, 1);
  assert.match(events.get(id).summary, /^Aprobada/);
  assert.equal(events.get(id).start.dateTime, '2026-12-01T12:00:00');
  assert.equal((await ref.get()).get('googleCalendarEventId'), id);
  assert.deepEqual(calls.filter(([call]) => call !== 'get'), [['insert', id], ['patch', id]]);
});

test('concurrent delivery and immediate approval during insert leave one approved event', async () => {
  const { ref, id, events, sync, remote } = setup();
  await ref.set(pending);
  const insert = remote.insert.bind(remote);
  let entered, release;
  const inCalendar = new Promise(resolve => { entered = resolve; });
  const unblock = new Promise(resolve => { release = resolve; });
  remote.insert = async (...args) => { entered(); await unblock; await insert(...args); };
  const first = assert.rejects(sync(), /cita cambió/);
  await inCalendar;
  try {
    await ref.update(approved);
    await assert.rejects(sync(), /sincronización en curso/);
  } finally { release(); }
  await first;
  await sync();
  assert.equal(events.size, 1);
  assert.match(events.get(id).summary, /^Aprobada/);
});

test('remote write followed by reverting the appointment forces reconciliation despite the old matching hash', async () => {
  const { ref, id, events, sync, remote, state } = setup();
  await ref.set(pending);
  await sync();
  const previousHash = (await ref.get()).get('googleCalendarSyncHash');
  await ref.update(approved);
  const patch = remote.patch.bind(remote);
  remote.patch = async (...args) => { await patch(...args); await ref.update({ status: 'pending' }); };
  await assert.rejects(sync(), /cita cambió/);
  assert.equal((await ref.get()).get('googleCalendarSyncHash'), previousHash);
  assert.equal((await state.get()).get('dirty'), true);
  remote.patch = patch;
  await sync();
  assert.match(events.get(id).summary, /^Pendiente/);
  assert.equal((await state.get()).get('dirty'), undefined);
});

test('lost insert response, retry and 409 use the same ID', async () => {
  const { ref, state, id, events, remote, sync, waitOutLease } = setup();
  await ref.set(pending);
  const insert = remote.insert.bind(remote), get = remote.get.bind(remote);
  remote.insert = async (...args) => { await insert(...args); throw new Error('socket timeout'); };
  await assert.rejects(sync(), /No se pudo completar/);
  assert.equal((await state.get()).get('dirty'), true);
  assert.equal((await ref.get()).get('googleCalendarSyncStatus'), 'error');
  await assert.rejects(sync(), /sincronización en curso/);
  waitOutLease();
  remote.insert = insert;
  let firstGet = true;
  remote.get = async eventId => { if (firstGet) { firstGet = false; return undefined; } return get(eventId); };
  await sync();
  assert.equal(events.size, 1);
  assert.equal((await ref.get()).get('googleCalendarEventId'), id);
  assert.ok(events.get(id).extendedProperties.private[CALENDAR_SYNC_HASH_PROPERTY]);
});

test('Firestore deletion during insert never resurrects the appointment and removes the unprojected event', async () => {
  const { ref, id, events, sync, remote } = setup();
  await ref.set(pending);
  const insert = remote.insert.bind(remote);
  remote.insert = async (...args) => { await insert(...args); await ref.delete(); };
  await assert.rejects(sync(), /cita cambió/);
  await sync();
  await sync();
  assert.equal(events.get(id).status, 'cancelled');
  assert.equal((await ref.get()).exists, false);
});

test('recurring pending stays hidden and reapproval restores a cancelled stable ID', async () => {
  const { ref, id, events, sync, calls } = setup();
  await ref.set({ ...pending, recurrenceSeriesId: 'series' });
  await sync();
  assert.equal(calls.length, 0);
  await ref.update(approved);
  await sync();
  await ref.update({ status: 'pending' });
  await sync();
  assert.equal(events.get(id).status, 'cancelled');
  await ref.update(approved);
  await sync();
  assert.equal(events.size, 1);
  assert.equal(events.get(id).status, 'confirmed');
});

test('legacy orphan is adopted by appointment ID, with ambiguity and foreign IDs preserved for review', async () => {
  const { ref, id, events, save, sync, errors } = setup();
  await ref.set({ ...pending, ...approved });
  const description = `Comentario:\n\nID cita:\n${ref.id}\n\nHorario:\n2026-12-01 10:00`;
  save('legacy1', { summary: 'Pendiente - Ana', description });
  save('legacy2', { summary: 'Aprobada - Ana', description });
  await sync();
  assert.match(errors.at(-1)[0], /varios eventos/);
  assert.equal(errors.at(-1)[1], false);
  assert.equal(events.size, 2);
  events.delete('legacy2');
  await sync();
  assert.equal((await ref.get()).get('googleCalendarEventId'), 'legacy1');
  assert.match(events.get('legacy1').summary, /^Aprobada/);
  assert.equal(events.has(id), false);
  save('legacy1', { description: description.replace(ref.id, 'foreign-appointment') });
  await ref.delete();
  await sync();
  assert.equal(events.get('legacy1').status, undefined);
  assert.match(errors.at(-1)[0], /pertenece a otra cita/);
});

test('temporary Google errors rethrow and permanent failure persists with no appointment recreation', async () => {
  const { ref, state, id, events, remote, sync, errors } = setup();
  await ref.set(pending);
  await sync();
  await ref.delete();
  const remove = remote.delete.bind(remote);
  remote.delete = async () => { throw { code: 429 }; };
  await assert.rejects(sync(), /HTTP 429/);
  remote.delete = async () => { throw { code: 403 }; };
  await sync();
  assert.equal((await ref.get()).exists, false);
  assert.equal((await state.get()).get('lastError.transient'), false);
  assert.deepEqual(errors, [['Google Calendar HTTP 429', true], ['Google Calendar HTTP 403', false]]);
  remote.delete = remove;
  await sync();
  assert.equal(events.get(id).status, 'cancelled');
  assert.equal((await state.get()).get('lastError'), undefined);
});

test('an inaccessible Calendar returning 404 is not recorded as a successful deletion', async () => {
  const { ref, state, id, events, remote, sync } = setup();
  await ref.set(pending);
  await sync();
  await ref.update({ status: 'cancelled' });
  remote.get = async () => undefined;
  remote.find = async () => { throw { code: 404 }; };
  await sync();
  assert.equal((await ref.get()).get('googleCalendarSyncStatus'), 'error');
  assert.equal((await state.get()).get('lastError.reason'), 'Google Calendar HTTP 404');
  assert.equal(events.get(id).status, 'confirmed');
});

test('cutover barrier is shared across instances and stops writes during old revision drainage', async () => {
  const ref = db.doc('system_controls/google_calendar_v2');
  await ref.delete();
  let clock = Date.now();
  const waitA = createCalendarCutover(db, () => clock);
  const waitB = createCalendarCutover(db, () => clock);
  await assert.rejects(waitA(), /revisión anterior/);
  clock += 50_000;
  await assert.rejects(waitB(), /revisión anterior/);
  clock += 41_000;
  await Promise.all([waitA(), waitB()]);
});
