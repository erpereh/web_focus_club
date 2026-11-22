const { createHash } = require('node:crypto');
const path = require('node:path');
const { sourceIdentity, matchesFiles } = require('./bootstrap-resume.cjs');

const REQUIRED_RUNTIME = {
  onAppointmentCustomerNotification: { memory: '512Mi', concurrency: 8 },
  onReleaseDeferredEventWritten: { memory: '512Mi' },
};

async function planFunctionsResume({ manifest, functions, readArchive, verifyRuntime, cache = {} }) {
  const expected = new Map();
  for (const [codebase, names, prefix] of [
    ['default', manifest.webFunctions, 'functions/'],
    ['portal', manifest.portalFunctions, '../app_focus_club/functions/'],
  ]) {
    for (const name of names) {
      if (!/^[A-Za-z][A-Za-z0-9]+$/.test(name) || expected.has(name)) throw new Error('Inventario definitivo inválido.');
      expected.set(name, { name, codebase, prefix, verified: false });
    }
  }
  if (!expected.size || manifest.maxFunctionBatchSize !== 5 || !manifest.bootstrap?.captured
    || manifest.bootstrap.artifacts.some(item => !item.compiled)) throw new Error('Inventario de publicación incompleto.');
  const bootstrap = new Map();
  for (const artifact of manifest.bootstrap.artifacts) {
    const prefix = path.posix.dirname(artifact.config) + '/functions/';
    for (const name of artifact.functions) {
      if (!expected.has(name) || bootstrap.has(name)) throw new Error('Inventario Bootstrap inválido.');
      bootstrap.set(name, prefix);
    }
  }
  const seen = new Set();
  const archives = new Map();
  const tasks = functions.map(fn => {
    const name = fn.name.split('/').at(-1);
    const item = expected.get(name);
    if (!item || seen.has(name) || fn.name !== `projects/${manifest.projectId}/locations/europe-west1/functions/${name}`
      || fn.state !== 'ACTIVE' || fn.buildConfig?.runtime !== 'nodejs22' || fn.serviceConfig?.allTrafficOnLatestRevision !== true
      || typeof fn.serviceConfig.revision !== 'string' || !fn.serviceConfig.revision.startsWith(name.toLowerCase() + '-')
      || (fn.labels?.['firebase-functions-codebase'] ?? 'default') !== item.codebase
      || (item.codebase === 'portal' && (fn.serviceConfig.secretEnvironmentVariables ?? []).length)) {
      throw new Error(`Estado, revisión, tráfico, región o codebase incompatible para ${name}.`);
    }
    seen.add(name);
    const phase = fn.labels?.focus_phase;
    const prefix = phase === 'final' ? item.prefix : phase === 'bootstrap' ? bootstrap.get(name) : undefined;
    if (fn.labels?.focus_release !== manifest.releaseId || !prefix) throw new Error(`Versión remota desconocida para ${name}.`);
    const source = fn.buildConfig.source?.storageSource;
    const identity = sourceIdentity(source);
    return async () => {
      const inputs = manifest.inputs.filter(input => input.path.startsWith(prefix));
      const fingerprint = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
      const cached = cache[name];
      if (cached?.identity !== identity || cached.fingerprint !== fingerprint) {
        if (!archives.has(identity)) archives.set(identity, Promise.resolve().then(() => readArchive(source)));
        if (!matchesFiles(await archives.get(identity), inputs, prefix)) throw new Error(`La fuente publicada de ${name} no coincide con el manifiesto.`);
        cache[name] = { identity, fingerprint };
      }
      if (phase === 'final' && REQUIRED_RUNTIME[name]) await verifyRuntime(fn, REQUIRED_RUNTIME[name]);
      item.verified = phase === 'final';
    };
  });
  for (const name of bootstrap.keys()) if (!seen.has(name)) throw new Error(`Falta la Function Bootstrap ${name}.`);
  for (let start = 0; start < tasks.length; start += 5) await Promise.all(tasks.slice(start, start + 5).map(task => task()));
  const pendingFunctions = [...expected.values()].filter(item => !item.verified);
  const batches = [];
  for (const codebase of ['default', 'portal']) {
    const names = pendingFunctions.filter(item => item.codebase === codebase).map(item => item.name);
    for (let i = 0; i < names.length; i += 5) batches.push({ codebase, functions: names.slice(i, i + 5) });
  }
  return {
    projectId: manifest.projectId, releaseId: manifest.releaseId, manifestHash: manifest.manifestHash,
    verifiedFunctions: [...expected.values()].filter(item => item.verified).map(item => item.name),
    pendingFunctions: pendingFunctions.map(item => item.name), batches,
  };
}

module.exports = { planFunctionsResume };
