const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { correlateIncidentLogs, readIncidentLogs, CASES } = require('../../scripts/interrupted-operations.cjs');
const { planFunctionsResume } = require('../../scripts/functions-resume.cjs');
const { incidentLogs } = require('./fixtures/interruptedOperationLogs.cjs');

test('a 200 response with termination proves interruption and retains the shared-instance ambiguity', () => {
  const proof = correlateIncidentLogs(incidentLogs());
  assert.equal(proof.length, 9);
  assert.equal(proof[0].request.httpStatus, 200);
  assert.equal(proof[0].termination.reason, 'memory_limit_exceeded');
  assert.equal(proof[2].association, 'shared_instance');
  assert.equal(proof[2].termination.insertId, proof[3].termination.insertId);
  assert.equal(proof[3].instanceRequests.length, 2);
  assert.equal(proof.filter(item => item.notice === 'follow_up').length, 2);
});

test('a request, its age and an HTTP status cannot replace termination evidence', () => {
  assert.throws(() => correlateIncidentLogs(incidentLogs().filter(entry => entry.insertId !== CASES[0].terminationId)), /terminación/);
});

test('an overlapping request on another instance blocks correlation', () => {
  const entries = incidentLogs();
  entries.push({ ...entries[0], insertId: 'competing', labels: { ...entries[0].labels, instanceId: 'other' } });
  assert.throws(() => correlateIncidentLogs(entries), /Otra instancia/);
});

test('an unexplained request on the terminated instance must be investigated', () => {
  const entries = incidentLogs();
  entries.push({ ...entries[0], insertId: 'incomplete', trace: 'other-trace' });
  assert.throws(() => correlateIncidentLogs(entries), /solicitudes sin explicar/);
});

test('a direct handler_finished marker requires reconsidering the interruption path', () => {
  const entries = incidentLogs();
  entries.push({ jsonPayload: { releaseOperationId: CASES[0].id, releaseOperationState: 'handler_finished' } });
  assert.throws(() => correlateIncidentLogs(entries), /registros directos/);
});

test('Cloud Logging paginates and retries a 429 without reporting an empty result', async () => {
  const credential = { getAccessToken: async () => ({ access_token: 'mock-token' }) };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const replies = [response({}, 429), response({ entries: [{ insertId: 'one' }], nextPageToken: 'more' }), response({ entries: [{ insertId: 'two' }] })];
  const requests = [], delays = [];
  const logs = await readIncidentLogs(credential, 'demo-test', {
    request: async (_url, options) => { requests.push(JSON.parse(options.body)); return replies.shift(); },
    sleep: async ms => { delays.push(ms); },
  });
  assert.deepEqual(logs.map(entry => entry.insertId), ['one', 'two']);
  assert.deepEqual(delays, [5000]);
  assert.equal(requests.at(-1).pageToken, 'more');
  await assert.rejects(readIncidentLogs(credential, 'demo-test', {
    request: async () => response({ nextPageToken: 'same' }),
  }), /Paginación/);
});

const sha = value => createHash('sha256').update(value).digest('hex');
function finalFixture() {
  const names = Array.from({ length: 12 }, (_, index) => 'function' + index);
  const config = 'release/bootstrap/0123456789abcdef0123/firebase.json';
  const manifest = {
    projectId: 'test-project', releaseId: 'test-release', manifestHash: 'test-hash', maxFunctionBatchSize: 5,
    webFunctions: [...names, 'onAppointmentCustomerNotification'], portalFunctions: ['deleteOwnAccount'],
    bootstrap: { captured: true, artifacts: [{ config, functions: names.slice(0, 5), compiled: true }] },
    inputs: [
      { path: config.replace('firebase.json', 'functions/lib/index.js'), sha256: sha('bootstrap') },
      { path: 'functions/lib/index.js', sha256: sha('final') },
      { path: '../app_focus_club/functions/lib/index.js', sha256: sha('portal') },
    ],
  };
  const fn = (name, phase, codebase = 'default') => ({
    name: 'projects/test-project/locations/europe-west1/functions/' + name, state: 'ACTIVE',
    labels: { focus_phase: phase, focus_release: manifest.releaseId, 'firebase-functions-codebase': codebase },
    serviceConfig: { revision: name.toLowerCase() + '-00001-a', allTrafficOnLatestRevision: true },
    buildConfig: { runtime: 'nodejs22', source: { storageSource: { bucket: 'bucket', object: codebase === 'portal' ? 'portal' : phase, generation: '1' } } },
  });
  return { manifest, names, fn, options: {
    manifest, functions: [fn(names[0], 'final'), ...names.slice(1, 5).map(name => fn(name, 'bootstrap'))],
    readArchive: async source => new Map([['lib/index.js', Buffer.from(source.object)]]),
    verifyRuntime: async () => {},
    verifyTraffic: async () => 'verified',
  } };
}

test('partial final deployment omits verified versions and batches pending names by codebase', async () => {
  const { options, names } = finalFixture();
  const plan = await planFunctionsResume(options);
  assert.deepEqual(plan.verifiedFunctions, [names[0]]);
  assert.equal(plan.pendingFunctions.length, 13);
  assert.deepEqual(plan.batches.map(batch => [batch.codebase, batch.functions.length]), [['default', 5], ['default', 5], ['default', 2], ['portal', 1]]);
  assert.deepEqual(plan.batches.at(-1).functions, ['deleteOwnAccount']);
});

test('final deployment requires reviewed source and reviewed runtime on cached retries', async () => {
  const { options, fn } = finalFixture();
  options.functions.push(fn('onAppointmentCustomerNotification', 'final'));
  options.cache = {};
  let checks = 0;
  options.verifyTraffic = async (fn, { limits }) => {
    if (fn.name.endsWith('/onAppointmentCustomerNotification')) {
      checks++;
      assert.deepEqual(limits, { memory: '512Mi', concurrency: 8 });
    }
    return 'verified';
  };
  await planFunctionsResume(options);
  await planFunctionsResume(options);
  assert.equal(checks, 2);
  options.verifyTraffic = async () => { throw new Error('wrong runtime'); };
  await assert.rejects(planFunctionsResume(options), /wrong runtime/);
  options.verifyTraffic = async () => 'verified';
  options.functions[0].buildConfig.source.storageSource.object = 'unexpected';
  await assert.rejects(planFunctionsResume(options), /no coincide/);
});

test('final continuation rejects an old traffic split, unknown function or missing Bootstrap', async () => {
  const { options, fn } = finalFixture();
  const first = options.functions[0];
  first.serviceConfig.allTrafficOnLatestRevision = false;
  await assert.rejects(planFunctionsResume(options), /tráfico/);
  first.serviceConfig.allTrafficOnLatestRevision = true;
  options.functions.push(fn('unreviewed', 'final'));
  await assert.rejects(planFunctionsResume(options), /incompatible/);
  options.functions.pop();
  options.functions.pop();
  await assert.rejects(planFunctionsResume(options), /Falta la Function Bootstrap/);
});
