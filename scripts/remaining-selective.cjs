const { fs, path, root, hash, googleGet } = require('./release-common.cjs');

const PHASE = 'remaining_selective';
const ACCOUNT = '1555015411-compute@developer.gserviceaccount.com';
const EVENT_TYPE = 'google.cloud.firestore.document.v1.created';
const RUNTIME = { memory: '256Mi', cpu: 1, concurrency: 80, timeoutSeconds: 60 };
const TARGETS = {
  onNotificationOutboxCreated: { document: 'notification_outbox/{operationId}', trigger: 'onnotificationoutboxcreated-390537', topicSuffix: '029' },
  onUserProfileCreatedWelcomeEmail: { document: 'users/{uid}', trigger: 'onuserprofilecreatedwelcomeemail-902792', topicSuffix: '278' },
  createUserFromAdmin: {},
  updateMaxCapacityFromAdmin: {},
};

function remainingArtifacts(manifest) {
  const section = manifest.remainingSelective;
  if (section === undefined) return new Map();
  if (section?.schema !== 'focus-remaining-selective-v1' || !Array.isArray(section.artifacts)
    || section.artifacts.map(artifact => artifact?.name).join(',') !== Object.keys(TARGETS).join(',')) {
    throw new Error('Inventario de las cuatro publicaciones selectivas inválido.');
  }
  return new Map(section.artifacts.map(artifact => {
    if (!/^release\/remaining-selective\/[a-f0-9]{20}\/firebase\.json$/.test(artifact.config)
      || !manifest.inputs.some(input => input.path === artifact.config)
      || !manifest.bootstrap.artifacts.some(base => base.config === artifact.baseConfig && !base.portal && base.functions.includes(artifact.name))) {
      throw new Error(`Captura o configuración no acreditada para ${artifact.name}.`);
    }
    const prefix = path.posix.dirname(artifact.config) + '/functions/';
    const inputs = manifest.inputs.filter(input => input.path.startsWith(prefix));
    const files = inputs.map(input => input.path.slice(prefix.length));
    if (new Set(files).size !== files.length || !['package.json', 'package-lock.json', 'entry.cjs', 'lib/index.js', 'lib/releaseMaintenance.js'].every(file => files.includes(file))) {
      throw new Error(`Faltan huellas del artefacto ${artifact.name}.`);
    }
    return [artifact.name, { ...artifact, prefix, inputs }];
  }));
}

function assertLocalArtifact(artifact) {
  const source = path.resolve(root, artifact.prefix);
  const directory = path.dirname(source);
  if (!fs.lstatSync(directory).isDirectory() || !fs.lstatSync(source).isDirectory()) throw new Error('El paquete tiene una ruta redirigida.');
  const expected = new Map(artifact.inputs.map(input => [input.path.slice(artifact.prefix.length), input.sha256]));
  function verify(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!relative && entry.name === 'node_modules') continue;
      const local = relative + entry.name;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) verify(file, local + '/');
      else if (!entry.isFile() || !expected.has(local) || expected.get(local) !== hash(fs.readFileSync(file))) {
        throw new Error(`Archivo ajeno o alterado en el paquete ${artifact.name}: ${local}.`);
      } else expected.delete(local);
    }
  }
  verify(source);
  if (expected.size) throw new Error(`Faltan archivos del paquete ${artifact.name}.`);
}

const filtersKey = filters => JSON.stringify((filters ?? []).map(f => [f.attribute, f.value, f.operator ?? '']).sort());
function assertFunctionContract(project, fn) {
  const name = fn.name.split('/').at(-1);
  if (!Object.hasOwn(TARGETS, name)) throw new Error('Function ajena a esta fase.');
  const expected = TARGETS[name];
  const config = fn.serviceConfig ?? {};
  const refs = config.secretEnvironmentVariables ?? [];
  if (config.serviceAccountEmail !== ACCOUNT || config.ingressSettings !== 'ALLOW_ALL') {
    throw new Error(`Identidad de ejecución o política de ingreso distinta para ${name}.`);
  }
  if (!expected.trigger) {
    if (fn.eventTrigger || refs.length) throw new Error(`Trigger o secretos inesperados para ${name}.`);
    return null;
  }
  const event = fn.eventTrigger;
  const trigger = `projects/${project}/locations/eur3/triggers/${expected.trigger}`;
  const topic = `projects/${project}/topics/eventarc-eur3-${expected.trigger}-${expected.topicSuffix}`;
  const filters = [
    { attribute: 'document', value: expected.document, operator: 'match-path-pattern' },
    { attribute: 'database', value: '(default)' },
    { attribute: 'namespace', value: '(default)' },
  ];
  if (event?.trigger !== trigger || event.triggerRegion !== 'eur3' || event.eventType !== EVENT_TYPE
    || filtersKey(event.eventFilters) !== filtersKey(filters) || event.retryPolicy !== 'RETRY_POLICY_DO_NOT_RETRY'
    || event.serviceAccountEmail !== ACCOUNT || event.pubsubTopic !== topic
    || refs.length !== 1 || refs[0].key !== 'BREVO_API_KEY' || refs[0].secret !== 'BREVO_API_KEY'
    || refs[0].projectId !== project || refs[0].version !== '2') {
    throw new Error(`Cambió el contrato de eventos o la referencia al secreto de ${name}.`);
  }
  return { trigger, filters: [...filters, { attribute: 'type', value: EVENT_TYPE }], topic };
}

async function verifyInfrastructure(credential, project, fn) {
  const expected = assertFunctionContract(project, fn);
  if (!expected) return;
  const event = await googleGet(credential, 'https://eventarc.googleapis.com/v1/' + expected.trigger);
  if (event.name !== expected.trigger || event.serviceAccount !== ACCOUNT || event.destination?.cloudFunction !== fn.name
    || event.transport?.pubsub?.topic !== expected.topic || filtersKey(event.eventFilters) !== filtersKey(expected.filters)
    || Object.values(event.conditions ?? {}).some(condition => condition.code && condition.code !== 'OK')) {
    throw new Error(`El trigger efectivo de Eventarc ha cambiado para ${fn.name}.`);
  }
}

function assertPredecessorRetired(run, revision, name, digest, now = Date.now()) {
  const shortName = value => value?.split('/').at(-1);
  const current = (run.trafficStatuses ?? []).filter(target => Number(target.percent) > 0);
  const stillRouted = [...(run.traffic ?? []), ...(run.trafficStatuses ?? [])].some(target =>
    shortName(target.revision) === shortName(name) && (Number(target.percent) > 0 || target.tag));
  const inactive = revision.conditions?.find(condition => condition.type === 'Active');
  const retiredAt = Date.parse(inactive?.lastTransitionTime);
  if (run.reconciling || run.generation == null || run.generation !== run.observedGeneration
    || run.terminalCondition?.state !== 'CONDITION_SUCCEEDED' || run.latestReadyRevision !== run.latestCreatedRevision
    || current.length !== 1 || current[0].percent !== 100 || shortName(current[0].revision) !== shortName(run.latestReadyRevision)
    || revision.name !== name || stillRouted || run.latestReadyRevision === name || !revision.uid
    || !revision.containers?.[0]?.image?.endsWith('@sha256:' + digest)
    || inactive?.state !== 'CONDITION_FAILED' || inactive.revisionReason !== 'RETIRED'
    || revision.timeout !== '60s' || !Number.isFinite(retiredAt) || now < retiredAt + 90_000
    || Number(revision.scaling?.minInstanceCount ?? 0) !== 0) {
    throw new Error(`Cloud Run aún no acredita el retiro de ${shortName(name)}. Verifica de nuevo antes de continuar.`);
  }
  return { revision: shortName(name), retiredAt: inactive.lastTransitionTime };
}

module.exports = { PHASE, TARGETS, RUNTIME, remainingArtifacts, assertLocalArtifact, assertFunctionContract, verifyInfrastructure, assertPredecessorRetired };
