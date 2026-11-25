const { path } = require('./release-common.cjs');

// Effective Cloud Run revisions observed during the occupancy incident.
const FALLBACKS = {
  createRecurringAppointmentsFromAdmin: {
    serving: 'createrecurringappointmentsfromadmin-00011-mid', rejected: 'createrecurringappointmentsfromadmin-00013-los',
    digest: '0bcdb9b5a29ed8881095dd1aee70addf5997d6a0dede0cad54aeb11a72caca4e',
  },
  deleteAppointmentsFromAdmin: {
    serving: 'deleteappointmentsfromadmin-00004-pir', rejected: 'deleteappointmentsfromadmin-00005-rib',
    digest: 'ab77c0434df5f3e9a52b3c6b338512fd594734334ede13230066146dfeac8574',
  },
  updateOwnAppointmentSlot: {
    serving: 'updateownappointmentslot-00018-luc', rejected: 'updateownappointmentslot-00019-qig',
    digest: '7bf8c80ea1c334e7a20a6cc08fd8f1bd28a40c9a854ed8eb0d411cb50c0cc22e',
  },
  updateMaxCapacityFromAdmin: {
    serving: 'updatemaxcapacityfromadmin-00002-luk', rejected: 'updatemaxcapacityfromadmin-00003-cil',
    digest: '7bf8c80ea1c334e7a20a6cc08fd8f1bd28a40c9a854ed8eb0d411cb50c0cc22e',
  },
  onUserProfileCreatedWelcomeEmail: {
    serving: 'onuserprofilecreatedwelcomeemail-00008-pib', rejected: 'onuserprofilecreatedwelcomeemail-00009-cey',
    digest: '98c9b75c5b4befb1ba037996c1ddbdff4d10e32faeeb281a038b9413db48482d',
  },
  onNotificationOutboxCreated: {
    serving: 'onnotificationoutboxcreated-00006-six', rejected: 'onnotificationoutboxcreated-00007-rer',
    digest: '3239afb8d0efdceb034d8c04d6becd7fede52c0d5b147bac473f810953083a6b',
  },
  createUserFromAdmin: {
    serving: 'createuserfromadmin-00008-jub', rejected: 'createuserfromadmin-00009-lif',
    digest: 'f759b10ebb2b570d6ca2b3e63cba0376a4c74b17009eaae9d900231b4c6c4de9',
  },
};

const OWN_SLOT_RUNTIME = { memory: '512Mi', cpu: 1, concurrency: 1, maxInstances: 5, timeoutSeconds: 60 };
const TARGETS = {
  createRecurringAppointmentsFromAdmin: { memory: '256Mi', cpu: 1, concurrency: 80, timeoutSeconds: 60 },
  deleteAppointmentsFromAdmin: { memory: '512Mi', cpu: 1, concurrency: 5, timeoutSeconds: 60 },
  updateOwnAppointmentSlot: OWN_SLOT_RUNTIME,
};
const SELECTIVE_PHASE = 'occupancy_selective';

function selectiveArtifacts(manifest) {
  const entries = manifest.occupancySelective;
  if (entries === undefined) return new Map();
  if (entries?.schema !== 'focus-occupancy-selective-v1' || !Array.isArray(entries.artifacts)
    || entries.artifacts.map(artifact => artifact?.name).join(',') !== Object.keys(TARGETS).join(',')) {
    throw new Error('Inventario selectivo de aforo inválido.');
  }
  return new Map(entries.artifacts.map(artifact => {
    if (!/^release\/occupancy-selective\/[a-f0-9]{20}\/firebase\.json$/.test(artifact.config)
      || !manifest.inputs.some(input => input.path === artifact.config)
      || !manifest.bootstrap.artifacts.some(base => base.config === artifact.baseConfig && !base.portal && base.functions.includes(artifact.name))) {
      throw new Error(`Paquete selectivo sin captura o configuración acreditada: ${artifact.name}.`);
    }
    const prefix = path.posix.dirname(artifact.config) + '/functions/';
    const inputs = manifest.inputs.filter(input => input.path.startsWith(prefix));
    const paths = inputs.map(input => input.path.slice(prefix.length));
    if (new Set(paths).size !== paths.length || !['package.json', 'package-lock.json', 'entry.cjs', 'lib/index.js', 'lib/appointmentTransaction.js'].every(file => paths.includes(file))) {
      throw new Error(`Faltan huellas selectivas para ${artifact.name}.`);
    }
    return [artifact.name, { ...artifact, prefix, inputs }];
  }));
}

function effectiveTraffic({ run, revision, declared, phase, release, fallback, limits = {} }) {
  const shortName = name => name?.split('/').at(-1);
  const serving = shortName(revision.name);
  const targets = (run.trafficStatuses ?? []).filter(target => Number(target.percent) > 0);
  const conditionsReady = revision.conditions?.some(condition => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED');
  const container = revision.containers?.[0];
  const rawCpu = container?.resources?.limits?.cpu ?? '';
  const cpu = rawCpu.endsWith('m') ? Number(rawCpu.slice(0, -1)) / 1000 : Number(rawCpu);
  const singleReady = run.generation != null && run.generation === run.observedGeneration && run.reconciling !== true
    && revision.name === run.latestReadyRevision && targets.length === 1 && targets[0].percent === 100
    && shortName(targets[0].revision) === serving && conditionsReady && revision.labels?.focus_release === release
    && /@sha256:[a-f0-9]{64}$/.test(container?.image ?? '');
  if (singleReady && serving === declared && shortName(run.latestCreatedRevision) === declared
    && run.terminalCondition?.state === 'CONDITION_SUCCEEDED' && revision.labels.focus_phase === phase
    && (phase !== SELECTIVE_PHASE || revision.labels['deployment-callable'] === 'true')
    && (limits.memory === undefined || container.resources?.limits?.memory === limits.memory)
    && (limits.cpu === undefined || cpu === limits.cpu)
    && (limits.concurrency === undefined || revision.maxInstanceRequestConcurrency === limits.concurrency)
    && (limits.maxInstances === undefined || revision.scaling?.maxInstanceCount === limits.maxInstances)
    && (limits.timeoutSeconds === undefined || revision.timeout === limits.timeoutSeconds + 's')) return 'verified';

  if (singleReady && phase === 'final' && fallback && declared === fallback.rejected && serving === fallback.serving
    && revision.labels.focus_phase === 'bootstrap' && container.image.endsWith('@sha256:' + fallback.digest)
    && shortName(run.latestCreatedRevision) === fallback.rejected && run.terminalCondition?.state === 'CONDITION_FAILED'
    && /^Quota exceeded for total allowable CPU per project per region\./.test(run.terminalCondition.message ?? '')
    && targets[0].type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST') return 'fallback';

  throw new Error(`Cloud Run no acredita el tráfico de ${declared}: ${run.terminalCondition?.message?.split('\n')[0] ?? 'revisión, ruta o recursos distintos'}.`);
}

module.exports = { FALLBACKS, TARGETS, SELECTIVE_PHASE, selectiveArtifacts, effectiveTraffic };
