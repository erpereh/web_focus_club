const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { planBootstrapResume, sourceIdentity } = require('../../scripts/bootstrap-resume.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const manifest = { projectId: 'focus-club-f73b8', releaseId: 'test-release', manifestHash: 'manifest-one', webFunctions: [], portalFunctions: ['deleteOwnAccount'], inputs: [],
    bootstrap: { captured: true, artifacts: [] } };
  const functions = [], archives = new Map(), reads = [];
  for (const [index, names] of [['a', ['firstOne', 'secondOne', 'thirdOne', 'fourthOne', 'fifthOne', 'sixthOne', 'seventhOne']], ['b', ['deleteOwnAccount']], ['c', ['lastOne']]]) {
    const prefix = `release/bootstrap/${index.repeat(20)}/functions/`;
    const artifact = { config: prefix.replace('functions/', 'firebase.json'), compiled: true, portal: names.includes('deleteOwnAccount'), functions: names, sourceVersions: [] };
    manifest.bootstrap.artifacts.push(artifact);
    manifest.inputs.push({ path: prefix + 'src/index.ts', sha256: hash('source-' + index) }, { path: prefix + 'lib/index.js', sha256: hash('compiled-' + index) });
    for (const name of names) {
      if (!artifact.portal) manifest.webFunctions.push(name);
      const resource = `projects/${manifest.projectId}/locations/europe-west1/functions/${name}`;
      const source = { bucket: 'source-bucket', object: 'original/' + name, generation: '1' };
      artifact.sourceVersions.push({ name: resource, source });
      functions.push({ name: resource, state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', source: { storageSource: { ...source } } }, serviceConfig: { allTrafficOnLatestRevision: true }, labels: artifact.portal ? { 'firebase-functions-codebase': 'portal' } : {} });
    }
  }
  let rules = 'original-rules';
  function ready(name) {
    const fn = functions.find(fn => fn.name.endsWith('/' + name));
    const artifact = manifest.bootstrap.artifacts.find(artifact => artifact.functions.includes(name));
    const index = artifact.config.split('/')[2][0];
    fn.labels = { ...fn.labels, focus_release: manifest.releaseId, focus_phase: 'bootstrap' };
    fn.buildConfig.source.storageSource = { bucket: 'source-bucket', object: 'bootstrap/' + name, generation: '2' };
    archives.set(sourceIdentity(fn.buildConfig.source.storageSource), new Map([['src/index.ts', Buffer.from('source-' + index)], ['lib/index.js', Buffer.from('compiled-' + index)]]));
    return fn;
  }
  const options = { manifest, functions, readArchive: async source => { reads.push(sourceIdentity(source)); return archives.get(sourceIdentity(source)); }, readRules: async () => rules, originalRules: 'original-rules', bootstrapRules: 'bootstrap-rules' };
  return { manifest, functions, archives, reads, ready, options, setRules: value => { rules = value; }, run: () => planBootstrapResume(options) };
}

test('partial Bootstrap skips only verified sources, retaining exact codebases and groups of at most five', async () => {
  const f = fixture(); f.ready('firstOne'); f.ready('deleteOwnAccount');
  const plan = await f.run();
  assert.deepEqual(plan.verifiedFunctions, ['deleteOwnAccount', 'firstOne']);
  assert.equal(plan.pendingFunctions.length, 7);
  assert.deepEqual(plan.batches.map(b => b.functions.length), [5, 1, 1]);
  assert.ok(plan.batches.every(b => b.functions.every(name => !plan.verifiedFunctions.includes(name))));
  assert.equal(plan.rules.status, 'pending');
});
test('after a lost CLI response, restarting resumes from the actual published version', async () => {
  const f = fixture(); const before = await f.run();
  for (const name of before.batches[0].functions) f.ready(name);
  const after = await f.run();
  assert.equal(after.verifiedFunctions.length, 5);
  assert.deepEqual(after.batches[0].functions, ['sixthOne', 'seventhOne']);
});
test('completed Bootstrap and matching rules require no deployment on retry', async () => {
  const f = fixture(); f.functions.forEach(fn => f.ready(fn.name.split('/').at(-1))); f.setRules('bootstrap-rules');
  const result = await f.run(); assert.equal(result.batches.length, 0); assert.equal(result.rules.status, 'verified');
});
test('a global manifest change reuses only proofs with matching source identity and package inputs', async () => {
  const f = fixture(); f.ready('firstOne'); f.options.cache = {};
  await f.run(); assert.equal(f.reads.length, 1);
  f.manifest.manifestHash = 'new-global-manifest'; await f.run(); assert.equal(f.reads.length, 1);
  f.manifest.inputs[0].sha256 = hash('other-source');
  await assert.rejects(f.run(), /fuente publicada/); assert.equal(f.reads.length, 2);
});
test('a revision change with a valid label must still prove the new source', async () => {
  const f = fixture(); const fn = f.ready('firstOne'); f.options.cache = {}; await f.run();
  const old = sourceIdentity(fn.buildConfig.source.storageSource);
  fn.buildConfig.source.storageSource.generation = '3'; f.archives.set(sourceIdentity(fn.buildConfig.source.storageSource), f.archives.get(old));
  await f.run(); assert.equal(f.reads.length, 2);
});
test('known amended package is pending rather than verified until corrected code is deployed', async () => {
  const f = fixture(); const fn = f.ready('deleteOwnAccount');
  const artifact = f.manifest.bootstrap.artifacts[1];
  artifact.amendments = [{ beforeInputs: f.manifest.inputs.filter(i => i.path.includes('/bbbb')).map(i => ({ ...i })) }];
  f.manifest.inputs.find(i => i.path.includes('/bbbb') && i.path.endsWith('src/index.ts')).sha256 = hash('fixed-source');
  const result = await f.run(); assert.ok(result.pendingFunctions.includes('deleteOwnAccount')); assert.equal(result.verifiedFunctions.length, 0);
  assert.equal(result.batches.find(b => b.portal).functions[0], 'deleteOwnAccount');
  assert.ok(fn);
});
for (const [name, change, message] of [
  ['non-active revision', fn => { fn.state = 'DEPLOYING'; }, /Estado/],
  ['old traffic', fn => { fn.serviceConfig.allTrafficOnLatestRevision = false; }, /tráfico/],
  ['wrong region', fn => { fn.name = fn.name.replace('europe-west1', 'us-central1'); }, /región/],
  ['wrong project', fn => { fn.name = fn.name.replace('focus-club-f73b8', 'other-project'); }, /región/],
  ['wrong runtime', fn => { fn.buildConfig.runtime = 'nodejs20'; }, /runtime/],
  ['unknown release label', fn => { fn.labels.focus_release = 'other-release'; }, /desconocida/],
  ['final release', fn => { fn.labels.focus_phase = 'final'; }, /desconocida/],
  ['unknown source without labels', fn => { fn.buildConfig.source.storageSource.generation = '44'; }, /desconocida/],
  ['missing immutable generation', fn => { delete fn.buildConfig.source.storageSource.generation; }, /inmutable/],
  ['wrong codebase', fn => { fn.labels['firebase-functions-codebase'] = 'other'; }, /Codebase/],
]) test(`resume refuses ${name}`, async () => { const f = fixture(); change(f.functions[0]); await assert.rejects(f.run(), message); });
test('a label alone never proves a published Bootstrap', async () => {
  const f = fixture(); const fn = f.ready('firstOne'); f.archives.get(sourceIdentity(fn.buildConfig.source.storageSource)).delete('src/index.ts');
  await assert.rejects(f.run(), /fuente publicada/);
});
test('compiled source mismatch is detected', async () => {
  const f = fixture(); const fn = f.ready('firstOne'); f.archives.get(sourceIdentity(fn.buildConfig.source.storageSource)).set('lib/index.js', Buffer.from('wrong'));
  await assert.rejects(f.run(), /fuente publicada/);
});
test('portal cannot be considered ready with a secret binding, even from cached source proof', async () => {
  const f = fixture(); const fn = f.ready('deleteOwnAccount'); f.options.cache = {}; await f.run();
  fn.serviceConfig.secretEnvironmentVariables = [{ key: 'MAKE_RESERVATION_WEBHOOK_URL' }];
  await assert.rejects(f.run(), /Secretos inesperados/);
});
test('duplicate endpoints across regions do not get mistaken for the expected function', async () => {
  const f = fixture(); f.functions.push({ ...f.functions[0], name: f.functions[0].name.replace('europe-west1', 'us-central1') });
  await assert.rejects(f.run(), /región/);
});
test('unknown remote function and missing captured function block continuation', async () => {
  const f = fixture(); f.functions.push({ name: 'projects/p/locations/europe-west1/functions/unknown' }); await assert.rejects(f.run(), /ajena/);
  f.functions.pop(); f.functions.shift(); await assert.rejects(f.run(), /Estado/);
});
test('a newly published final function outside the captured Bootstrap blocks resumption even if managed by this release', async () => {
  const f = fixture(); f.manifest.webFunctions.push('newFinalFunction');
  f.functions.push({ name: 'projects/focus-club-f73b8/locations/europe-west1/functions/newFinalFunction' });
  await assert.rejects(f.run(), /ajena a la captura/);
});
test('unreviewed rules block continuation even with verified functions', async () => {
  const f = fixture(); f.ready('firstOne'); f.setRules('third-rules-version'); await assert.rejects(f.run(), /reglas/);
});
test('a source or rules read failure never returns a partial deployment plan', async () => {
  const f = fixture(); f.ready('firstOne'); f.options.readArchive = async () => { throw new Error('archive unavailable'); };
  await assert.rejects(f.run(), /archive unavailable/);
  f.options.readArchive = async () => new Map(); f.functions[0].labels = {}; f.options.readRules = async () => { throw new Error('rules unavailable'); };
  // Return the function to its exact captured baseline first.
  f.functions[0].buildConfig.source.storageSource = f.manifest.bootstrap.artifacts[0].sourceVersions[0].source;
  await assert.rejects(f.run(), /rules unavailable/);
});
test('incomplete and duplicate artifact inventories are rejected', async () => {
  const f = fixture(); f.manifest.bootstrap.artifacts[0].compiled = false; await assert.rejects(f.run(), /compilada/);
  f.manifest.bootstrap.artifacts[0].compiled = true; f.manifest.bootstrap.artifacts[0].functions.push('deleteOwnAccount'); await assert.rejects(f.run(), /repetida/);
});
