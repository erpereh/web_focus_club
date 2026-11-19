// Pure, fail-closed planner. The caller supplies GET-only readers; no deployments here.
const { createHash } = require('node:crypto');
const path = require('node:path');
const digest = value => createHash('sha256').update(value).digest('hex');
function sourceIdentity(source) {
  if (typeof source?.bucket !== 'string' || !source.bucket || typeof source.object !== 'string' || !source.object
    || !/^\d+$/.test(String(source.generation))) throw new Error('Falta una versión inmutable de la fuente.');
  return JSON.stringify([source.bucket, source.object, String(source.generation)]);
}
function matchesFiles(files, inputs, prefix) {
  return inputs.length > 0 && inputs.every(input => files.has(input.path.slice(prefix.length)) && digest(files.get(input.path.slice(prefix.length))) === input.sha256);
}
async function planBootstrapResume({ manifest, functions, readArchive, readRules, originalRules, bootstrapRules, cache = {} }) {
  if (!manifest.bootstrap?.captured || !manifest.bootstrap.artifacts.length || manifest.bootstrap.artifacts.some(a => !a.compiled)) throw new Error('Falta la captura Bootstrap compilada.');
  const seen = new Set(), expected = [];
  for (const artifact of manifest.bootstrap.artifacts) {
    if (!/^release\/bootstrap\/[a-f0-9]{20}\/firebase\.json$/.test(artifact.config) || !artifact.functions.length) throw new Error('Paquete Bootstrap no válido.');
    const prefix = path.posix.dirname(artifact.config) + '/functions/';
    const inputs = manifest.inputs.filter(input => input.path.startsWith(prefix));
    if (!inputs.length) throw new Error('Faltan las huellas del paquete Bootstrap.');
    for (const name of artifact.functions) {
      if (seen.has(name) || !/^[A-Za-z][A-Za-z0-9]+$/.test(name)) throw new Error('Función Bootstrap repetida o no válida.');
      seen.add(name); expected.push({ name, artifact, prefix, inputs });
    }
  }
  if (functions.some(fn => !seen.has(fn.name.split('/').at(-1)))) throw new Error('Función remota ajena a la captura Bootstrap sin revisar.');
  const archives = new Map(), verified = new Set(), pending = new Set();
  const loadArchive = source => {
    const identity = sourceIdentity(source);
    if (!archives.has(identity)) archives.set(identity, Promise.resolve().then(() => readArchive(source)));
    return archives.get(identity);
  };
  for (let start = 0; start < expected.length; start += 5) await Promise.all(expected.slice(start, start + 5).map(async item => {
    const candidates = functions.filter(fn => fn.name.split('/').at(-1) === item.name);
    const fn = candidates[0];
    const resource = `projects/${manifest.projectId}/locations/europe-west1/functions/${item.name}`;
    if (candidates.length !== 1 || fn.name !== resource || fn.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22'
      || fn.serviceConfig?.allTrafficOnLatestRevision !== true) throw new Error(`Estado, región, runtime o tráfico no válido: ${item.name}`);
    if ((fn.labels?.['firebase-functions-codebase'] ?? 'default') !== (item.artifact.portal ? 'portal' : 'default')) throw new Error(`Codebase inesperado: ${item.name}`);
    if (item.artifact.portal && (fn.serviceConfig.secretEnvironmentVariables ?? []).length) throw new Error(`Secretos inesperados en portal: ${item.name}`);
    const source = fn.buildConfig?.source?.storageSource;
    const identity = sourceIdentity(source);
    const baseline = item.artifact.sourceVersions.find(version => version.name === resource);
    if (!baseline) throw new Error(`Falta la versión original capturada: ${item.name}`);
    const isBootstrap = fn.labels?.focus_release === manifest.releaseId && fn.labels?.focus_phase === 'bootstrap';
    if (!isBootstrap) {
      if (fn.labels?.focus_release || fn.labels?.focus_phase || identity !== sourceIdentity(baseline.source)) throw new Error(`Versión remota desconocida: ${item.name}`);
      pending.add(item.name); return;
    }
    const fingerprint = digest(JSON.stringify(item.inputs));
    if (cache[item.name]?.identity === identity && cache[item.name]?.fingerprint === fingerprint) { verified.add(item.name); return; }
    const files = await loadArchive(source);
    if (matchesFiles(files, item.inputs, item.prefix)) {
      verified.add(item.name); cache[item.name] = { identity, fingerprint }; return;
    }
    // A previously reviewed package amendment is known, but is never considered current.
    if (item.artifact.amendments?.some(amendment => matchesFiles(files, amendment.beforeInputs, item.prefix))) { pending.add(item.name); return; }
    throw new Error(`La fuente publicada no coincide con el paquete revisado: ${item.name}`);
  }));
  const rules = await readRules();
  if (rules !== originalRules && rules !== bootstrapRules) throw new Error('Las reglas publicadas son una versión desconocida.');
  const artifacts = manifest.bootstrap.artifacts.map(artifact => ({ config: artifact.config, portal: Boolean(artifact.portal),
    verified: artifact.functions.filter(name => verified.has(name)), pending: artifact.functions.filter(name => pending.has(name)) }));
  const batches = artifacts.flatMap(artifact => Array.from({ length: Math.ceil(artifact.pending.length / 5) }, (_, index) => ({
    config: artifact.config, portal: artifact.portal, functions: artifact.pending.slice(index * 5, index * 5 + 5),
  })));
  return { schema: 'focus-bootstrap-resume-v1', projectId: manifest.projectId, releaseId: manifest.releaseId, manifestHash: manifest.manifestHash,
    verifiedFunctions: [...verified].sort(), pendingFunctions: [...pending].sort(), artifacts, batches,
    rules: { status: rules === bootstrapRules ? 'verified' : 'pending', config: 'release/bootstrap/firebase.json' } };
}
module.exports = { planBootstrapResume, sourceIdentity };
