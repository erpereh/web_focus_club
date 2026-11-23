const assert = require('node:assert/strict');
const test = require('node:test');
const { hash } = require('../../scripts/release-common.cjs');
const { inspectCalendar, listCalendarEvents, summarizeOperations, FUNCTION } = require('../../scripts/sync-google-calendar-appointments.cjs');
const { planFunctionsResume } = require('../../scripts/functions-resume.cjs');
const { calendarSyncRemote } = require('../lib/googleCalendarReconciliation.js');
const { stableCalendarEventId } = require('../lib/googleCalendarSync.js');

test('audit classifies exact IDs, duplicates, orphaned and inactive events without relying on names', () => {
  const description = id => `Comentario:\n\nID cita:\n${id}\n\nHorario:\n2026-12-01 10:00 - 30 min`;
  const appointments = [{ id: 'a', visible: true, status: 'approved' }, { id: 'b', visible: true, status: 'approved', eventId: 'linked' },
    { id: 'c', visible: false, status: 'cancelled' }, { id: 'd', visible: true, status: 'pending', eventId: 'missing' }];
  const events = [{ id: 'p', description: description('a'), summary: 'Pendiente - Ana' },
    { id: stableCalendarEventId('a'), extendedProperties: { private: { focusAppointmentId: 'a' } }, summary: 'Aprobada - Ana' },
    { id: 'linked', description: description('b'), summary: 'Aprobada - Ana' },
    { id: 'c1', description: description('c') }, { id: 'z', description: description('z') },
    { id: 'c2', description: description('c'), status: 'cancelled' },
    { id: 'wrong-markers', description: description('c'), extendedProperties: { private: { focusAppointmentId: 'a' } } },
    { id: 'unrelated', summary: 'Pendiente - Ana' }];
  const result = inspectCalendar(appointments, events, new Set(['z']));
  assert.deepEqual(result.duplicates.map(x => x.appointmentId), ['a']);
  assert.equal(result.missingApproved[0].matches.length, 2);
  assert.deepEqual(result.inactive.map(x => x.eventId), ['c1']);
  assert.deepEqual(result.orphaned.map(x => [x.eventId, x.deletionRecord]), [['z', true]]);
  assert.deepEqual(result.ambiguous.map(x => x.eventId), ['wrong-markers']);
  assert.deepEqual(result.drift.map(x => x.eventId), ['p']);
  assert.deepEqual(result.danglingLinks.map(x => x.eventId), ['missing']);
  assert.ok(!JSON.stringify(result).includes('Ana'));
});

test('Calendar audit reads every page with GET and refuses incomplete, unauthorized or cyclic results', async () => {
  let calls = 0;
  const request = async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.match(url, /showDeleted=false/);
    const next = ++calls === 1;
    if (!next) assert.match(url, /pageToken=page2/);
    return Response.json({ accessRole: 'reader', items: [{ id: String(calls) }], ...(next ? { nextPageToken: 'page2' } : {}) });
  };
  assert.deepEqual((await listCalendarEvents('fake', { request })).map(x => x.id), ['1', '2']);
  await assert.rejects(listCalendarEvents('fake', { request: async () => Response.json({ accessRole: 'freeBusyReader', items: [] }) }), /detalles suficientes/);
  await assert.rejects(listCalendarEvents('fake', { request: async () => Response.json({ accessRole: 'reader', items: [], nextPageToken: 'loop' }) }), /incompleta/);
  await assert.rejects(listCalendarEvents('fake', { request: async () => new Response('', { status: 403 }) }), /HTTP 403/);
});

test('lease audit distinguishes OOM inference, competing requests and direct completion', () => {
  const revision = FUNCTION.toLowerCase() + '-old';
  const operation = { id: 'lease', startedAt: '2026-11-23T10:00:00Z' };
  const log = { resource: { labels: { revision_name: revision } }, labels: { instanceId: 'instance' } };
  const request = { ...log, insertId: 'req', logName: 'logs/run.googleapis.com%2Frequests', timestamp: '2026-11-23T09:59:59Z', httpRequest: { latency: '2s', status: 200 } };
  const oom = { ...log, insertId: 'oom', logName: 'logs/run.googleapis.com%2Fvarlog%2Fsystem', timestamp: '2026-11-23T10:00:01Z', textPayload: 'Memory limit of 256 MiB exceeded' };
  assert.equal(summarizeOperations([operation], [request, oom], revision).operations[0].disposition, 'oom_inferred');
  assert.equal(summarizeOperations([operation], [request, oom, { ...request, labels: { instanceId: 'other' } }], revision).operations[0].disposition, 'unproven');
  assert.equal(summarizeOperations([operation], [{ ...log, jsonPayload: { releaseOperationId: 'lease', releaseOperationState: 'handler_finished' } }], revision).operations[0].disposition, 'handler_finished');
});

test('Calendar adapter uses ETags, explicit ID, request timeouts and suppresses email invites', async () => {
  const captured = [];
  const remote = calendarSyncRemote({ events: {
    insert: async (...args) => { captured.push(args); return { data: { id: args[0].requestBody.id } }; },
    patch: async (...args) => { captured.push(args); },
    delete: async (...args) => { captured.push(args); throw { response: { status: 410 } }; },
    get: async () => { throw { response: { status: 404 } }; },
  } }, 'calendar');
  await remote.insert('fc123', { summary: 'Aprobada' });
  await remote.patch('fc123', 'etag-a', { summary: 'Aprobada' });
  await remote.delete('fc123', 'etag-b');
  assert.equal(await remote.get('missing'), undefined);
  assert.equal(captured[0][0].requestBody.id, 'fc123');
  for (const [parameters, options] of captured) {
    assert.equal(parameters.sendUpdates, 'none');
    assert.equal(options.retry, false);
    assert.equal(options.timeout, 8000);
  }
  assert.equal(captured[1][1].headers['If-Match'], 'etag-a');
  assert.equal(captured[2][1].headers['If-Match'], 'etag-b');
});

test('selective final plan preserves reviewed baseline endpoints and demands new Calendar source and serving runtime', async () => {
  const projectId = 'focus-club-f73b8';
  const packagePath = 'functions/lib/index.js';
  const current = 'patch', baseline = 'base';
  const source = generation => ({ bucket: 'b', object: 'o', generation });
  const revision = FUNCTION.toLowerCase() + '-old';
  const manifest = { projectId, releaseId: 'r', maxFunctionBatchSize: 5, webFunctions: [FUNCTION, 'unrelatedEndpoint'], portalFunctions: [],
    inputs: [{ path: packagePath, sha256: hash(current) }], bootstrap: { captured: true, artifacts: [] },
    calendarHotfix: { baselineManifestHash: 'b'.repeat(64), baselineRevision: revision, baselineServingRevision: FUNCTION.toLowerCase() + '-older', baselineSource: source('12'),
      baselineDefaultInputs: [{ path: packagePath, sha256: hash(baseline) }] } };
  const fn = (name, rev, generation) => ({ name: `projects/${projectId}/locations/europe-west1/functions/${name}`, state: 'ACTIVE',
    buildConfig: { runtime: 'nodejs22', source: { storageSource: source(generation) } }, serviceConfig: { revision: rev, allTrafficOnLatestRevision: true },
    labels: { focus_release: 'r', focus_phase: 'final' } });
  const base = fn(FUNCTION, revision, '12'), untouched = fn('unrelatedEndpoint', 'unrelatedendpoint-01', '1');
  const runtimes = [];
  const plan = functions => planFunctionsResume({ manifest, functions,
    verifyRuntime: async (selected, runtime) => { runtimes.push([selected.serviceConfig.revision, runtime]); },
    readArchive: async ({ generation }) => new Map([['lib/index.js', Buffer.from(generation === '13' ? current : baseline)]]) });
  assert.deepEqual((await plan([base, untouched])).pendingFunctions, [FUNCTION]);
  assert.equal(runtimes[0][1].servingBaseline, manifest.calendarHotfix.baselineServingRevision);
  await assert.rejects(plan([fn(FUNCTION, FUNCTION.toLowerCase() + '-new', '11'), untouched]), /revisión anterior/);
  assert.deepEqual((await plan([fn(FUNCTION, FUNCTION.toLowerCase() + '-new', '13'), untouched])).pendingFunctions, []);
  assert.equal(runtimes.at(-1)[1].memory, '512Mi');
  assert.equal(runtimes.at(-1)[1].concurrency, 1);
  assert.equal(runtimes.at(-1)[1].maxCpu, 0.34);
});
