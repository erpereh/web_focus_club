const assert = require('node:assert/strict');
const test = require('node:test');
const c = require('../../scripts/release-common.cjs');
const { remainingArtifacts, assertLocalArtifact, assertFunctionContract, assertPredecessorRetired, PHASE, TARGETS } = require('../../scripts/remaining-selective.cjs');
const { planFunctionsResume } = require('../../scripts/functions-resume.cjs');
const { CASES, REVISION, correlate, retiredRevision } = require('../../scripts/retired-operations.cjs');

const manifest = c.readJson(c.path.join(c.root, 'release/manifest.json'));
const artifacts = remainingArtifacts(manifest);
const account = '1555015411-compute@developer.gserviceaccount.com';
const base = name => `projects/${manifest.projectId}/locations/europe-west1/${name}`;
const resource = base('services/' + REVISION.split('-00012')[0]);
const retired = `${resource}/revisions/${REVISION}`;
const archive = item => new Map(item.inputs.map(input => [input.path.slice(item.prefix.length), c.fs.readFileSync(c.path.join(c.root, input.path))]));

test('four single exports preserve the reviewed Bootstrap source, dependencies and trigger handlers', () => {
  assert.equal(manifest.bootstrap.artifacts.length, 10);
  assert.equal(manifest.occupancySelective.artifacts.length, 3);
  for (const [name, item] of artifacts) {
    assertLocalArtifact(item);
    const folder = c.path.join(c.root, c.path.dirname(item.baseConfig), 'functions');
    const files = archive(item);
    assert.deepEqual(c.readJson(c.path.join(c.root, item.config)), { functions: { source: 'functions', ignore: ['node_modules'] } });
    assert.equal(files.get('entry.cjs').toString(), `const { ${name} } = require('./lib/index.js');\nmodule.exports = { ${name} };\n`);
    assert.deepEqual(Object.keys(require(c.path.join(c.root, item.prefix, 'entry.cjs'))), [name]);
    for (const [file, bytes] of files) {
      const read = () => c.fs.readFileSync(c.path.join(folder, file));
      if (file === 'package.json') assert.deepEqual(JSON.parse(bytes), { ...JSON.parse(read()), main: 'entry.cjs' });
      else if (file === 'src/index.ts') assert.equal(bytes.toString(), read().toString().replace('focus_phase: "bootstrap"', `focus_phase: "${PHASE}"`));
      else if (file === 'src/releaseMaintenance.ts') assert.equal(bytes.toString(), read().toString().replace('REQUIRE_OCCUPANCY_V2 = false', 'REQUIRE_OCCUPANCY_V2 = true'));
      else if (name === 'updateMaxCapacityFromAdmin' && file === 'src/capacityExceptions.ts') {
        const after = bytes.toString().replace('import { assertMaintenanceTransaction } from "./releaseMaintenance.js";\n', '')
          .replace('\n      await assertMaintenanceTransaction(transaction, db);', '');
        assert.equal(after, read().toString());
      } else if (file.startsWith('src/') || file === 'package-lock.json' || file === 'tsconfig.json') assert.deepEqual(bytes, read());
    }
  }
});

function deployed(name) {
  const target = TARGETS[name];
  const eventType = 'google.cloud.firestore.document.v1.created';
  return {
    name: base('functions/' + name), state: 'ACTIVE',
    buildConfig: { runtime: 'nodejs22', source: { storageSource: { bucket: 'bucket', object: name, generation: '1' } } },
    serviceConfig: { allTrafficOnLatestRevision: true, serviceAccountEmail: account, ingressSettings: 'ALLOW_ALL', revision: name.toLowerCase() + '-test',
      secretEnvironmentVariables: target.trigger ? [{ key: 'BREVO_API_KEY', secret: 'BREVO_API_KEY', version: '2', projectId: manifest.projectId }] : [] },
    labels: { focus_release: manifest.releaseId, focus_phase: PHASE },
    ...(target.trigger ? { eventTrigger: { trigger: base('').replace('europe-west1/', 'eur3/triggers/') + target.trigger,
      triggerRegion: 'eur3', eventType, retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY', serviceAccountEmail: account,
      pubsubTopic: `projects/${manifest.projectId}/topics/eventarc-eur3-${target.trigger}-${target.topicSuffix}`,
      eventFilters: [{ attribute: 'document', value: target.document, operator: 'match-path-pattern' },
        { attribute: 'database', value: '(default)' }, { attribute: 'namespace', value: '(default)' }] } } : {}),
  };
}

test('resume requires exact archive and real traffic for each of the four and never queues them for a generic batch', async () => {
  const names = [...artifacts.keys()];
  const fixture = { ...manifest, occupancySelective: undefined, calendarHotfix: undefined, webFunctions: names, portalFunctions: [],
    bootstrap: { ...manifest.bootstrap, artifacts: manifest.bootstrap.artifacts.filter(item => item.functions.some(name => names.includes(name)))
      .map(item => ({ ...item, functions: item.functions.filter(name => names.includes(name)) })) } };
  const files = new Map([...artifacts].map(([name, item]) => [name, archive(item)]));
  const functions = names.map(deployed);
  const cache = {};
  const run = (traffic = 'verified') => planFunctionsResume({ manifest: fixture, functions, cache,
    verifyTraffic: async (_, expected) => { assert.equal(expected.limits.cpu, 1); return traffic; }, readArchive: async ({ object }) => files.get(object) });
  assert.deepEqual((await run()).remainingSelectiveFunctions, names);
  const waiting = await run('fallback');
  assert.deepEqual(waiting.pendingRemainingSelective.map(item => item.name), names);
  assert.deepEqual(waiting.batches, []);
  assert.deepEqual(waiting.verifiedFunctions, []);
  functions[0].eventTrigger.eventFilters[0].value = 'another_collection/{operationId}';
  await assert.rejects(run(), /contrato de eventos/);
  functions[0] = deployed(names[0]);
  files.get(names[0]).set('extra.js', Buffer.from('unexpected'));
  await assert.rejects(run(), /no coincide/);
});

test('rejects changed secret versions and requires positive retirement evidence for the outgoing revision', () => {
  const fn = deployed('onNotificationOutboxCreated');
  assert.equal(assertFunctionContract(manifest.projectId, fn).filters.length, 4);
  fn.serviceConfig.secretEnvironmentVariables[0].version = 'latest';
  assert.throws(() => assertFunctionContract(manifest.projectId, fn), /referencia al secreto/);
  const run = { generation: '1', observedGeneration: '1', terminalCondition: { state: 'CONDITION_SUCCEEDED' },
    latestCreatedRevision: resource + '/revisions/new', latestReadyRevision: resource + '/revisions/new',
    trafficStatuses: [{ revision: resource + '/revisions/new', percent: 100 }] };
  const old = { name: retired, uid: 'fixture', timeout: '60s', containers: [{ image: 'image@sha256:' + 'a'.repeat(64) }],
    conditions: [{ type: 'Active', state: 'CONDITION_FAILED', revisionReason: 'RETIRED', lastTransitionTime: '2026-11-23T14:06:45Z' }] };
  assert.equal(retiredRevision(run, old, retired).uid, old.uid);
  const afterRetirement = Date.parse('2026-11-23T14:08:15Z');
  assert.equal(assertPredecessorRetired(run, old, retired, 'a'.repeat(64), afterRetirement).revision, REVISION);
  assert.throws(() => assertPredecessorRetired(run, old, retired, 'a'.repeat(64), afterRetirement - 1), /no acredita/);
  assert.throws(() => retiredRevision({ ...run, traffic: [{ revision: retired, tag: 'replay' }] }, old, retired), /no acredita/);
  assert.throws(() => assertPredecessorRetired(run, { ...old, conditions: [] }, retired, 'a'.repeat(64)), /no acredita/);
  assert.throws(() => assertPredecessorRetired(run, old, retired, 'b'.repeat(64)), /no acredita/);
});

test('unknown legacy outcomes need one exact correlated request and one matching termination', () => {
  const logs = CASES.flatMap(item => {
    const timestamp = offset => new Date(Date.parse(item.startedAt) + offset).toISOString();
    const shared = { resource: { labels: { revision_name: REVISION } }, trace: item.eventId };
    return [
      { ...shared, insertId: item.request, logName: 'log/run%2Frequests', timestamp: timestamp(-350), httpRequest: { status: 500, latency: '1s' },
        labels: { instanceId: item.id, 'run.googleapis.com/cloud_event_id': item.eventId } },
      { ...shared, insertId: item.termination, logName: 'log/run%2Fvarlog%2Fsystem', timestamp: timestamp(500), labels: { instanceId: item.id },
        textPayload: 'Memory limit of 256 MiB exceeded' },
    ];
  });
  assert.deepEqual(correlate(logs).map(item => item.effect), ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.throws(() => correlate(logs.slice(1)), /inequívocamente/);
  assert.throws(() => correlate([...logs, { ...logs[0], insertId: 'rival' }]), /inequívocamente/);
  assert.throws(() => correlate([...logs, { jsonPayload: { releaseOperationId: CASES[0].id } }]), /evidencia directa/);
});

test('Windows count evidence can be recovered from an encrypted private backup', { skip: process.platform !== 'win32' }, () => {
  const { writeBackup, readBackup, privatePath } = require('../../scripts/occupancy-count-backup.cjs');
  const temp = c.fs.mkdtempSync(c.path.join(process.env.LOCALAPPDATA, 'focus-backup-test-'));
  const file = c.path.join(temp, 'evidence.bin');
  const data = { counters: [{ id: '2026-11-26_07:30', data: { count: 0, value: 'only-found-after-decryption' } }] };
  try {
    assert.throws(() => privatePath(c.path.join(c.root, 'unsafe.bin')), /LocalAppData/);
    const sealed = writeBackup(file, data);
    const bytes = c.fs.readFileSync(file);
    assert.equal(bytes.includes(Buffer.from(data.counters[0].data.value)), false);
    assert.equal(c.hash(bytes), sealed.sha256);
    assert.deepEqual(readBackup(file), data);
    assert.throws(() => writeBackup(file, data), /EEXIST/);
  } finally {
    if (c.fs.existsSync(file)) c.fs.unlinkSync(file);
    c.fs.rmdirSync(temp);
  }
});
