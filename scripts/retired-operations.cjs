const { googleGet, hash } = require('./release-common.cjs');
const { readIncidentLogs } = require('./interrupted-operations.cjs');

const SCHEMA = 'focus-retired-operations-v1';
const COMMAND = 'resolve-retired-operations';
const OPERATION = 'syncAppointmentWithGoogleCalendar';
const SERVICE = OPERATION.toLowerCase();
const REVISION = SERVICE + '-00012-nok';
const CASES = [
  { id: 'ca8001da-9728-4feb-beea-28b9adc49a05', startedAt: '2026-11-23T05:20:47.068Z',
    request: '6b03cd2f00099e1659496cf6', termination: '6b03cd2f00095f95031f2a2a', eventId: '54bab7b8-6fff-4339-9a64-ed2128a47cc3' },
  { id: 'd4e44eb3-c938-4551-80a7-2b01c78fd8c2', startedAt: '2026-11-23T10:01:36.377Z',
    request: '6b040f0100002bd0bc8ca3f2', termination: '6b040f00000f21400dee4c5e', eventId: 'ae04f10f-068f-40d2-9c56-806b8f68d1d0' },
  { id: '8d373580-f197-4c4b-96c4-3a64b46eb90b', startedAt: '2026-11-23T11:01:56.203Z',
    request: '6b041d250001738840de0293', termination: '6b041d25000131b05f422ea4', eventId: '3194d065-7240-41ab-b8b3-423967a755ed' },
  { id: 'c306e4d1-6951-4bb0-8e58-862ba9d3ac06', startedAt: '2026-11-23T13:23:53.934Z',
    request: '6b043e6a000555f5b856aba2', termination: '6b043e6a0004e55010ff95e1', eventId: '469b2bfa-a912-4362-8e2b-d7d619e9805e' },
];
const operationPath = id => 'release_operations/' + id;
const receiptPath = id => 'release_control_audits/retired-' + id;
const identifiers = new Set(CASES.map(item => item.id));
const millis = value => Date.parse(value?.timestamp);
const instance = entry => entry?.labels?.instanceId;
const revision = entry => entry?.resource?.labels?.revision_name;
const eventId = entry => entry?.labels?.['run.googleapis.com/cloud_event_id'];
const requested = entry => entry.httpRequest && entry.logName?.endsWith('%2Frequests');
const version = doc => doc.updateTime ? [doc.updateTime.seconds, doc.updateTime.nanoseconds] : null;
const dataHash = value => hash(JSON.stringify(value));

function correlate(entries) {
  if (entries.some(entry => identifiers.has(entry.jsonPayload?.releaseOperationId))) {
    throw new Error('Hay evidencia directa nueva. Revisar antes de usar la resolución por retiro.');
  }
  const requests = entries.filter(requested);
  return CASES.map(item => {
    const request = requests.find(entry => entry.insertId === item.request);
    const termination = entries.find(entry => entry.insertId === item.termination && entry.logName?.endsWith('%2Fvarlog%2Fsystem'));
    const start = Date.parse(item.startedAt);
    const concurrent = requests.filter(entry => {
      const at = millis(entry);
      if (!(at >= start - 65_000 && at <= start + 1000)) return false;
      const seconds = Number.parseFloat(entry.httpRequest.latency);
      return !Number.isFinite(seconds) || at + seconds * 1000 >= start - 1200;
    });
    if (!request?.trace || !instance(request) || !termination || revision(request) !== REVISION || revision(termination) !== REVISION
      || instance(request) !== instance(termination) || eventId(request) !== item.eventId || millis(request) > start
      || concurrent.length !== 1 || concurrent[0] !== request || !(millis(termination) >= start && millis(termination) <= start + 2500)
      || !/Memory limit of 256 MiB exceeded/.test(termination.textPayload ?? '')) {
      throw new Error(`La terminación ya no se correlaciona inequívocamente para ${item.id}.`);
    }
    const unexplained = requests.some(entry => entry !== request && revision(entry) === REVISION && instance(entry) === instance(request)
      && millis(entry) >= start - 65_000 && millis(entry) <= millis(termination)
      && !entries.some(e => e.trace === entry.trace && entry.trace && e.jsonPayload?.releaseOperationState === 'handler_finished'));
    if (unexplained) throw new Error(`Hay otra solicitud sin explicar para ${item.id}.`);
    return {
      id: item.id, revision: REVISION, eventId: item.eventId, instance: instance(request), trace: request.trace,
      request: { id: request.insertId, at: request.timestamp, status: request.httpRequest.status ?? null, latency: request.httpRequest.latency ?? null },
      termination: { id: termination.insertId, at: termination.timestamp, reason: 'memory_limit_exceeded' },
      interpretation: 'legacy_request_correlated_with_termination', effect: 'unknown',
    };
  });
}

function retiredRevision(service, old, name) {
  const inactive = old.conditions?.find(item => item.type === 'Active');
  const exposed = [...(service.traffic ?? []), ...(service.trafficStatuses ?? [])].some(target =>
    target.revision?.split('/').at(-1) === REVISION && (Number(target.percent) > 0 || target.tag));
  if (service.reconciling || service.generation == null || service.observedGeneration !== service.generation
    || service.terminalCondition?.state !== 'CONDITION_SUCCEEDED' || old.name !== name || !old.uid || exposed
    || !(service.trafficStatuses ?? []).some(target => target.percent === 100 && target.revision && target.revision.split('/').at(-1) !== REVISION)
    || inactive?.state !== 'CONDITION_FAILED' || inactive.revisionReason !== 'RETIRED'
    || !(Date.parse(inactive.lastTransitionTime) > Date.parse(CASES.at(-1).startedAt))
    || old.timeout !== '60s' || Number(old.scaling?.minInstanceCount ?? 0) !== 0
    || !/@sha256:[a-f0-9]{64}$/.test(old.containers?.[0]?.image ?? '')) {
    throw new Error('Cloud Run no acredita que la revisión histórica esté retirada y sin rutas.');
  }
  return { name, uid: old.uid, image: old.containers[0].image, retiredAt: inactive.lastTransitionTime };
}

async function readProof(credential, project) {
  const resource = `projects/${project}/locations/europe-west1/services/${SERVICE}`;
  const url = 'https://run.googleapis.com/v2/' + resource;
  const base = `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND resource.labels.location="europe-west1"`;
  const windows = CASES.map(item => {
    const start = Date.parse(item.startedAt);
    return `(timestamp >= "${new Date(start - 70_000).toISOString()}" AND timestamp <= "${new Date(start + 70_000).toISOString()}")`;
  });
  const directIds = CASES.map(item => `jsonPayload.releaseOperationId="${item.id}"`).join(' OR ');
  const [service, old, entries, direct] = await Promise.all([
    googleGet(credential, url), googleGet(credential, url + '/revisions/' + REVISION),
    readIncidentLogs(credential, project, { filter: `${base} AND timestamp >= "2026-11-23T00:00:00Z" AND timestamp < "2026-11-24T00:00:00Z" AND (${windows.join(' OR ')})` }),
    readIncidentLogs(credential, project, { filter: `${base} AND timestamp >= "2026-11-23T00:00:00Z" AND (${directIds})` }),
  ]);
  if (service.name !== resource) throw new Error('Servicio histórico distinto.');
  return { retired: retiredRevision(service, old, resource + '/revisions/' + REVISION), operations: correlate([...entries, ...direct]) };
}

async function snapshot(tx, db, reviewerUid) {
  const [gate, config, queue, active, pending, reviewer, docs] = await Promise.all([
    tx.get(db.doc('system_controls/release')), tx.get(db.doc('site_config/main')), tx.get(db.doc('system_controls/deferred')),
    tx.get(db.collection('release_operations').where('state', '==', 'active').limit(CASES.length + 1)),
    tx.get(db.collection('release_deferred_events').where('state', 'in', ['pending', 'ready', 'recovering']).limit(1)),
    reviewerUid ? tx.get(db.doc('users/' + reviewerUid)) : undefined,
    tx.getAll(...CASES.map(item => db.doc(operationPath(item.id))), ...CASES.map(item => db.doc(receiptPath(item.id)))),
  ]);
  if (reviewerUid && reviewer?.get('role') !== 'admin') throw new Error('El revisor debe ser administrador.');
  return { gate, config, queue, active, pending, docs: docs.slice(0, CASES.length), receipts: docs.slice(CASES.length) };
}

function bodyFromSnapshot(state, manifest, proof) {
  const { gate, config, queue, active, pending, docs, receipts } = state;
  if (gate.get('phase') !== 'open' || gate.get('releaseId') !== manifest.releaseId || gate.get('occupancyVersion') !== 2
    || config.get('maintenanceMode') === true || config.get('automaticMinuteRefundsEnabled') === true
    || Number(queue.get('pending') ?? 0) !== 0 || !pending.empty || active.size !== CASES.length
    || active.docs.some(doc => !identifiers.has(doc.id)) || receipts.some(doc => doc.exists)) {
    throw new Error('Cambió el estado abierto, la cola o el conjunto exacto de operaciones.');
  }
  return {
    schema: SCHEMA, projectId: manifest.projectId, releaseId: manifest.releaseId, manifestHash: manifest.manifestHash,
    epoch: gate.get('epoch'), gateVersion: version(gate), retired: proof.retired,
    operations: docs.map((doc, i) => {
      const item = CASES[i];
      if (doc.get('operation') !== OPERATION || doc.get('releaseId') !== manifest.releaseId || doc.get('state') !== 'active'
        || doc.get('startedAt') !== item.startedAt || doc.get('eventId') || doc.get('revision') || !doc.updateTime
        || proof.operations[i]?.id !== item.id) throw new Error(`Cambió el registro histórico de ${item.id}.`);
      return { ...proof.operations[i], startedAt: item.startedAt, version: version(doc), state: 'active', operation: OPERATION };
    }),
    action: 'mark_interrupted_without_replay',
  };
}

async function auditRetiredOperations(db, manifest, getProof) {
  const proof = await getProof();
  const body = await db.runTransaction(async tx => bodyFromSnapshot(await snapshot(tx, db), manifest, proof), { readOnly: true });
  return { ...body, reportHash: dataHash(body) };
}

function assertReviewed(report, { approvedHash, reviewerUid, acknowledged }, manifest) {
  const { reportHash, ...body } = report ?? {};
  if (!acknowledged || !/^[a-f0-9]{64}$/.test(approvedHash ?? '') || dataHash(body) !== reportHash || approvedHash !== reportHash
    || body.schema !== SCHEMA || body.projectId !== manifest.projectId || body.releaseId !== manifest.releaseId
    || body.manifestHash !== manifest.manifestHash || !/^[^/\s]{1,128}$/.test(reviewerUid ?? '')
    || JSON.stringify(body.operations?.map(operation => operation.id)) !== JSON.stringify(CASES.map(item => item.id))) {
    throw new Error('Falta el informe íntegro, hash aprobado, revisor o aceptación del efecto desconocido.');
  }
}

function alreadyResolved(state, report) {
  const completed = state.receipts.every((receipt, i) => receipt.get('command') === COMMAND && receipt.get('operationId') === CASES[i].id
    && receipt.get('reportHash') === report.reportHash && receipt.get('effect') === 'unknown' && receipt.get('replayed') === false
    && state.docs[i].get('state') === 'interrupted' && state.docs[i].get('recoveryReportHash') === report.reportHash);
  if (!completed && (state.receipts.some(receipt => receipt.exists) || state.docs.some(doc => doc.get('state') !== 'active'))) {
    throw new Error('Resolución parcial o de otro informe. No se modifica ninguna operación.');
  }
  return completed;
}

async function resolveRetiredOperations(db, manifest, report, options) {
  assertReviewed(report, options, manifest);
  const read = tx => snapshot(tx, db, options.reviewerUid);
  if (await db.runTransaction(async tx => alreadyResolved(await read(tx), report), { readOnly: true })) {
    return { alreadyResolved: true, operations: CASES.length };
  }
  const proof = await options.getProof();
  return db.runTransaction(async tx => {
    const state = await read(tx);
    if (alreadyResolved(state, report)) return { alreadyResolved: true, operations: CASES.length };
    const current = bodyFromSnapshot(state, manifest, proof);
    if (dataHash(current) !== report.reportHash) throw new Error('La evidencia cambió. Revisar un informe nuevo.');
    const resolvedAt = new Date().toISOString();
    for (const item of current.operations) {
      tx.update(db.doc(operationPath(item.id)), { state: 'interrupted', recoveryReportHash: report.reportHash,
        recoveryEpoch: current.epoch, recoveryEffect: 'unknown', resolvedAt });
      tx.create(db.doc(receiptPath(item.id)), { command: COMMAND, operationId: item.id, reportHash: report.reportHash,
        projectId: current.projectId, releaseId: current.releaseId, epoch: current.epoch, manifestHash: current.manifestHash,
        reviewerUid: options.reviewerUid, resolvedAt, evidence: item, retired: current.retired, effect: 'unknown', replayed: false });
    }
    return { alreadyResolved: false, operations: CASES.length };
  });
}

module.exports = { CASES, REVISION, OPERATION, correlate, retiredRevision, readProof, auditRetiredOperations, assertReviewed, resolveRetiredOperations };
