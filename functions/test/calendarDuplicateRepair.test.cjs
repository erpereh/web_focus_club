const assert = require('node:assert/strict');
const test = require('node:test');
const { CASES, calendarClient, lockTargetDocs, runRepair } = require('../../scripts/repair-calendar-duplicates.cjs');

function fixture() {
  const events = new Map();
  for (const item of CASES) {
    for (const [id, state] of [[item.keep, item.keepState], [item.drop, 'pending']]) {
      events.set(id, {
        id, status: 'confirmed', etag: '"' + id + '"',
        summary: (state === 'approved' ? 'Aprobada' : 'Pendiente') + ' - Nombre privado',
        description: 'Información privada\n\nID cita:\n' + item.id + '\n\nHorario:\n' + item.date + ' 17:30 - 45 min',
        start: { dateTime: item.date + 'T17:30:00+01:00' }, end: { dateTime: item.date + 'T18:15:00+01:00' },
        extendedProperties: { private: { anotherProperty: 'some value' }, shared: { original: 'retained' } },
      });
    }
  }
  const operation = { id: 'old-operation', version: 'original', revision: null, startedAt: '2026-11-23T11:01:00Z' };
  const firestore = {
    summary: {
      readTime: '2026-11-23T14:30:00Z',
      release: { phase: 'open', occupancyVersion: 2, maintenanceMode: false, automaticRefunds: false, deferred: 0, cutoverReady: true },
      cases: CASES.map(item => ({ id: item.id, status: 'approved', eventId: item.keep, recurring: false,
        slot: { date: item.date, time: '17:30' }, version: 'original', syncVersion: null, binding: null, leaseUntil: null,
        keepReferences: [item.id], dropReferences: [],
      })),
      historicalOperations: [operation],
    },
    operations: [operation], details: [],
    build: { appointmentId: CASES[0].id,
      appointment: { status: 'approved', date: CASES[0].date, time: '17:30', duration: 45 },
      client: { name: 'Nombre privado', email: 'private@example.org', phone: '' }, trainerName: '',
    },
  };
  const calls = [], journal = [];
  let locked = false, backedUp = false;
  const remote = {
    async inventory() { return structuredClone([...events.values()]); },
    async call(method, id, options) {
      calls.push({ method, id, etag: options?.etag, locked });
      const event = events.get(id);
      if (method === 'GET') return event ? { event: structuredClone(event), http: 200 } : { event: null, http: 410 };
      assert.ok(backedUp && locked);
      assert.equal(options.etag, event.etag);
      if (method === 'DELETE') { events.delete(id); return { http: 204 }; }
      const updated = { ...event, ...options.body, etag: '"new-version"',
        start: { dateTime: options.body.start.dateTime + '+01:00' }, end: { dateTime: options.body.end.dateTime + '+01:00' } };
      events.set(id, updated);
      return { event: structuredClone(updated), http: 200 };
    },
  };
  const services = {
    firestore: async () => structuredClone(firestore),
    runtime: async () => ({ revision: 'reviewed revision', traffic: 100 }),
    calendar: async () => remote,
    backup: originals => {
      assert.equal(originals.length, 4);
      assert.ok(originals.every(event => event.description));
      backedUp = true;
      return { count: originals.length };
    },
    journal: entry => journal.push(structuredClone(entry)),
    lock: async (state, callback) => {
      assert.ok(backedUp);
      locked = true;
      try { await callback(() => 1000); }
      finally { locked = false; }
    },
    checkDetails: async () => true,
    verifyCalendar: async () => ({ inventory: await remote.inventory(),
      direct: await Promise.all(CASES.flatMap(({ keep, drop }) => [keep, drop]).map(async id => ({ id, ...await remote.call('GET', id) }))),
    }),
  };
  const reviewed = { etags: new Map([...events].map(([id, event]) => [id, event.etag])), operations: [operation.id] };
  const report = { operations: [], status: 'blocked' };
  return { services, reviewed, report, calls, events, firestore, remote, journal };
}

test('dry-run backs up complete events and permits exactly the three reviewed operations', async () => {
  const f = fixture();
  await runRepair({ ...f, mode: 'dry-run' });
  assert.equal(f.report.status, 'dry-run-passed');
  assert.equal(f.report.backup.count, 4);
  assert.deepEqual(f.report.calendarBefore.map(item => item.events.length), [2, 2]);
  assert.deepEqual(f.report.dryRun.map(({ method, id }) => [method, id]), [
    ['PATCH', CASES[0].keep], ['DELETE', CASES[0].drop], ['DELETE', CASES[1].drop],
  ]);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.deepEqual(f.report.operations, []);
  assert.doesNotMatch(JSON.stringify(f.report), /Nombre privado|private@example/);
});

test('apply patches then deletes under the lock, then proves 4 to 2 and preserves the second event', async () => {
  const f = fixture();
  const originalSecond = structuredClone(f.events.get(CASES[1].keep));
  await runRepair({ ...f, mode: 'apply' });
  assert.equal(f.report.status, 'verified', JSON.stringify(f.report.failure ?? f.report.verificationFailure));
  assert.deepEqual(f.report.calendarAfter.map(item => item.events.map(event => event.state)), [['approved'], ['approved']]);
  assert.ok(f.calls.filter(call => call.method !== 'GET').every(call => call.locked));
  assert.deepEqual(f.report.operations.map(operation => operation.result), Array(3).fill('acknowledged'));
  assert.deepEqual(f.events.get(CASES[1].keep), originalSecond);
  assert.equal(f.events.get(CASES[0].keep).extendedProperties.shared.original, 'retained');
  assert.equal(f.journal.filter(entry => entry.result === 'attempting').length, 3);
  assert.doesNotMatch(JSON.stringify(f.report), /Nombre privado|private@example/);
});

test('missing credentials retains Firestore evidence and attempts no calendar changes', async () => {
  const f = fixture();
  f.services.calendar = async () => { throw new Error('test token must not leak'); };
  await runRepair({ ...f, mode: 'apply' });
  assert.equal(f.report.status, 'blocked');
  assert.equal(f.report.failure.stage, 'preflight');
  assert.equal(f.report.preflight.firestore, 'ok');
  assert.equal(f.report.firestoreBefore.cases.length, 2);
  assert.doesNotMatch(JSON.stringify(f.report), /test token/);
  assert.deepEqual(f.calls, []);
});

test('wrong identity, third event, changed historical ETag and active unrelated lease each block all writes', async t => {
  const alternatives = {
    'conflicting identity': f => { f.events.get(CASES[0].drop).extendedProperties.private.focusAppointmentId = CASES[1].id; },
    'third event': f => { f.events.set('third', { ...f.events.get(CASES[0].keep), id: 'third' }); },
    'stale ETag': f => { f.events.get(CASES[0].drop).etag = '"changed"'; },
    'active lease': f => {
      f.firestore.summary.cases[0].leaseUntil = Date.parse(f.firestore.summary.readTime) + 5000;
      f.firestore.summary.cases[0].hasToken = true;
    },
    'changed appointment link': f => { f.firestore.summary.cases[1].eventId = CASES[1].drop; },
    'recent operation': f => { f.firestore.operations.push({ id: 'new-operation' }); },
  };
  for (const [label, alter] of Object.entries(alternatives)) await t.test(label, async () => {
    const f = fixture();
    alter(f);
    await runRepair({ ...f, mode: 'apply' });
    assert.equal(f.report.status, 'blocked');
    assert.ok(f.calls.every(call => call.method === 'GET'));
    assert.deepEqual(f.report.operations, []);
  });
});

test('backup failure and a change between dry-run and lock prevent the first mutation', async t => {
  await t.test('backup failure', async () => {
    const f = fixture();
    f.services.backup = () => { throw new Error('disk failure'); };
    await runRepair({ ...f, mode: 'apply' });
    assert.equal(f.report.failure.stage, 'backup');
    assert.ok(f.calls.every(call => call.method === 'GET'));
  });
  await t.test('concurrent calendar edit', async () => {
    const f = fixture();
    const lock = f.services.lock;
    f.services.lock = (...args) => {
      f.events.get(CASES[1].drop).etag = '"during-lock"';
      return lock(...args);
    };
    await runRepair({ ...f, mode: 'apply' });
    assert.equal(f.report.failure.stage, 'apply');
    assert.ok(f.calls.every(call => call.method === 'GET'));
  });
});

test('an uncertain delete stops later writes and triggers independent read-back without retries', async () => {
  const f = fixture();
  const call = f.remote.call;
  f.remote.call = async (method, id, options) => {
    const result = await call(method, id, options);
    if (method === 'DELETE' && id === CASES[0].drop) throw new Error('connection lost after deletion');
    return result;
  };
  await runRepair({ ...f, mode: 'apply' });
  assert.equal(f.report.status, 'partial-or-unverified');
  assert.equal(f.report.finalStateVerified, false);
  assert.deepEqual(f.report.calendarAfter.map(item => item.events.length), [1, 2]);
  assert.deepEqual(f.calls.filter(event => event.method !== 'GET').map(({ id }) => id), [CASES[0].keep, CASES[0].drop]);
  assert.ok(f.report.firestoreAfter);
});

test('transport rejects extra events and uses single If-Match requests with no invitations', async () => {
  const calls = [];
  const remote = calendarClient('fixture token', async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 412 });
  });
  await assert.rejects(remote.call('DELETE', CASES[1].keep, { etag: '"valid"' }), /fuera del alcance/);
  await assert.rejects(remote.call('PATCH', CASES[1].drop, { etag: '"valid"' }), /fuera del alcance/);
  await assert.rejects(remote.call('DELETE', CASES[0].drop, { etag: '*' }), /fuera del alcance/);
  await assert.rejects(remote.call('PATCH', CASES[0].keep, { etag: '"valid"', body: {} }), /HTTP 412/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendUpdates=none$/);
  assert.equal(calls[0].options.headers['If-Match'], '"valid"');
  assert.equal(calls[0].options.redirect, 'error');
});

test('lock checks a missing key and exact Firestore nanoseconds, then always rolls back without commit', async () => {
  const records = [
    { exists: true, ref: { path: 'appointments/' + CASES[0].id }, updateTime: { seconds: 1795436471, nanoseconds: 492895000 } },
    { exists: false, ref: { path: 'google_calendar_sync/' + CASES[0].id } },
  ];
  for (const sameVersion of [true, false]) {
    const steps = [];
    const request = async (url, options) => {
      const operation = url.split(':').at(-1);
      const body = JSON.parse(options.body);
      steps.push(operation);
      if (operation === 'beginTransaction') {
        assert.deepEqual(body.options, { readWrite: {} });
        return Response.json({ transaction: 'fixture transaction' });
      }
      assert.equal(body.transaction, 'fixture transaction');
      if (operation === 'rollback') return Response.json({});
      assert.equal(operation, 'batchGet');
      return Response.json([{ missing: body.documents[1] },
        { found: { name: body.documents[0], updateTime: sameVersion ? '2026-11-23T12:21:11.492895Z' : '2026-11-23T12:21:11.492895001Z' } },
      ]);
    };
    let entered = false;
    const lock = lockTargetDocs({ getAccessToken: async () => ({ access_token: 'fixture firestore' }) }, { records },
      () => { entered = true; }, request);
    if (sameVersion) await lock;
    else await assert.rejects(lock, /Cambió una versión/);
    assert.equal(entered, sameVersion);
    assert.deepEqual(steps, ['beginTransaction', 'batchGet', 'rollback']);
  }
});
