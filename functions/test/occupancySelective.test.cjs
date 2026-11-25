const assert = require('node:assert/strict');
const test = require('node:test');
const c = require('../../scripts/release-common.cjs');
const { FALLBACKS, TARGETS, SELECTIVE_PHASE, effectiveTraffic, selectiveArtifacts } = require('../../scripts/occupancy-selective.cjs');
const { planFunctionsResume } = require('../../scripts/functions-resume.cjs');

const name = 'updateOwnAppointmentSlot';
const release = 'test-release';
const fallback = FALLBACKS[name];
const base = 'projects/test/locations/europe-west1/services/updateownappointmentslot/revisions/';
const fixture = (old = false) => {
  const declared = old ? fallback.rejected : 'updateownappointmentslot-00020-aaa';
  const serving = old ? fallback.serving : declared;
  const phase = old ? 'final' : SELECTIVE_PHASE;
  return {
    declared, phase, release, fallback, limits: old ? undefined : TARGETS[name],
    run: {
      generation: '12', observedGeneration: '12', latestReadyRevision: base + serving, latestCreatedRevision: base + declared,
      terminalCondition: { state: old ? 'CONDITION_FAILED' : 'CONDITION_SUCCEEDED', message: 'Quota exceeded for total allowable CPU per project per region.' },
      trafficStatuses: [{ revision: serving, percent: 100, type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' }],
    },
    revision: {
      name: base + serving, labels: { focus_release: release, focus_phase: old ? 'bootstrap' : phase, 'deployment-callable': 'true' },
      conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
      containers: [{ image: 'image@sha256:' + fallback.digest, resources: { limits: { cpu: '1', memory: '512Mi' } } }],
      maxInstanceRequestConcurrency: 1, timeout: '60s', scaling: { maxInstanceCount: 5 },
    },
  };
};

test('effective traffic requires one ready reviewed revision and its approved resources', () => {
  assert.equal(effectiveTraffic(fixture()), 'verified');
  const changes = [
    f => { f.run.reconciling = true; },
    f => { f.run.trafficStatuses[0].percent = 90; f.run.trafficStatuses.push({ revision: 'other', percent: 10 }); },
    f => { f.run.trafficStatuses[0].revision = 'unknown'; },
    f => { f.run.latestCreatedRevision = base + 'other'; },
    f => { f.revision.conditions = []; },
    f => { f.revision.labels.focus_phase = 'bootstrap'; },
    f => { f.revision.containers[0].resources.limits.memory = '256Mi'; },
    f => { f.revision.maxInstanceRequestConcurrency = 80; },
    f => { f.revision.scaling.maxInstanceCount = 10; },
  ];
  for (const change of changes) {
    const invalid = fixture();
    change(invalid);
    assert.throws(() => effectiveTraffic(invalid), /no acredita el tráfico/);
  }
});

test('a known quota fallback is pending rather than verified; unknown predecessors are rejected', () => {
  assert.equal(effectiveTraffic(fixture(true)), 'fallback');
  for (const mutation of [
    f => { f.revision.containers[0].image = 'image@sha256:' + '0'.repeat(64); },
    f => { f.run.terminalCondition.message = 'other failure'; },
    f => { f.run.trafficStatuses[0].type = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'; },
  ]) {
    const invalid = fixture(true);
    mutation(invalid);
    assert.throws(() => effectiveTraffic(invalid), /no acredita el tráfico/);
  }
});

test('the compiled selective package is accepted only for its callable, archive and serving phase', async () => {
  const manifest = c.readJson(c.path.join(c.root, 'release/manifest.json'));
  const reviewed = selectiveArtifacts(manifest);
  assert.deepEqual([...reviewed.keys()], Object.keys(TARGETS));
  const item = reviewed.get(name);
  const files = new Map(item.inputs.map(({ path }) => [path.slice(item.prefix.length), c.fs.readFileSync(c.path.join(c.root, path))]));
  const testManifest = { ...manifest, calendarHotfix: undefined, webFunctions: [...reviewed.keys()], portalFunctions: [],
    bootstrap: { ...manifest.bootstrap, artifacts: [...new Set([...reviewed.values()].map(x => x.baseConfig))].map(config => ({ config, compiled: true,
      functions: [...reviewed.values()].filter(x => x.baseConfig === config).map(x => x.name) })) } };
  const functions = [...reviewed].map(([id]) => ({
    name: `projects/${manifest.projectId}/locations/europe-west1/functions/${id}`, state: 'ACTIVE',
    buildConfig: { runtime: 'nodejs22', source: { storageSource: { bucket: 'bucket', object: id, generation: '1' } } },
    serviceConfig: { allTrafficOnLatestRevision: true, revision: id.toLowerCase() + '-ready' },
    labels: { focus_release: manifest.releaseId, focus_phase: SELECTIVE_PHASE },
  }));
  const cache = {};
  const run = (archive = files, status = 'verified') => planFunctionsResume({ manifest: testManifest, functions, cache,
    verifyTraffic: async () => status, readArchive: async ({ object }) => object === name ? archive
      : new Map(reviewed.get(object).inputs.map(({ path }) => [path.slice(reviewed.get(object).prefix.length), c.fs.readFileSync(c.path.join(c.root, path))])),
  });
  const result = await run();
  assert.deepEqual(result.pendingFunctions, []);
  assert.deepEqual(result.selectiveFunctions, [...reviewed.keys()]);
  await assert.rejects(run(new Map([...files, ['extra.js', Buffer.from('unexpected')]])), /no coincide/);
  const changed = new Map(files);
  changed.set('entry.cjs', Buffer.from('otro punto de entrada'));
  await assert.rejects(run(changed), /no coincide/);
});
