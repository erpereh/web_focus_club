const { hash } = require('./release-common.cjs');

const FUNCTION_NAME = 'onAppointmentCustomerNotification';
const SERVICE = FUNCTION_NAME.toLowerCase();
const REVISION = SERVICE + '-00008-nal';
const RELEASE = 'occupancy-v2-refunds-20261118';
const SCHEMA = 'focus-interrupted-operations-20261122-v1';
const COMMAND = 'resolve-interrupted-operations';
const GATE = 'system_controls/release';
const CONFIG = 'site_config/main';
const OP = 'release_operations/';
const AUDIT = 'release_control_audits/interrupted-';

// Request and system insert IDs are independent evidence. The two requests on
// the shared instance are reviewed together: the old leases have no event ID.
const CASES = [
  ['8f39cd6e-25c7-4b54-a7fc-757fcc106afe', '2026-11-20T14:17:10.302Z', '6b005666000e185755044bf1', '6b005666000e91ceb6f4e6f7', '67a5f3e0-2a76-46d1-b50e-41b350eb9e45', 'complete'],
  ['37c6701f-e721-42d8-bea1-623b4c40018e', '2026-11-20T23:21:57.756Z', '6b00d616000d3a54878f7a21', '6b00d616000da7fb68bf40f6', '27d859da-1046-426d-9e60-05f083c3306e', 'complete'],
  ['0c5e245e-8b2c-4451-999d-ba34b5f1f7d3', '2026-11-21T05:23:52.368Z', '6b012ae8000bb3e3c6cb9612', '6b012ae8000c2f1581df9b6b', '94212aac-cc2c-4a19-9eba-9051766ce226', 'complete'],
  ['44ca45cf-3207-463f-b6f0-3e91496ca0a7', '2026-11-21T05:23:52.768Z', '6b012ae8000bb3e3c6cb9612', '6b012ae8000bd1bfc6135eac', '8ab08160-fa3a-4c27-9296-7e427520167f', 'follow_up'],
  ['75048eea-1d06-41eb-bfd5-7913d1c28514', '2026-11-21T09:22:50.465Z', '6b0162ea00097c589ce2fa4b', '6b0162ea0009ff04f263de4b', 'c9265338-6c38-4544-97ec-fd9a54efe0a1', 'follow_up'],
  ['46149b9a-779f-4390-80f6-00cb1096820c', '2026-11-21T09:24:38.171Z', '6b01635600098fc26fcdfb9f', '6b0163560009f3ebd0190b07', 'f4e52fd9-116a-49e2-aec6-ae1d20948e3c', 'complete'],
  ['86da0162-01e8-4123-b9b5-18c6b518d6d5', '2026-11-21T12:05:23.885Z', '6b0189040005ee223abf1254', '6b01890400065c9d4ebbe27a', '7fa64923-d57c-4916-aa76-790932ef3c3e', 'complete'],
  ['b5a26bfe-2fed-43a9-9575-e9ce4ef3bcae', '2026-11-22T10:34:44.737Z', '6b02c5450008db5e79989752', '6b02c545000975339a69c40c', '568ad525-caa7-4805-9e94-244a5f1c3171', 'complete'],
  ['dff80f9d-eb13-4d15-b74e-2ca04049f250', '2026-11-22T10:35:12.935Z', '6b02c5610008df0004e6acba', '6b02c56100094a918a09659d', 'd4513b39-d181-4a09-9575-aa6d35810011', 'complete'],
].map(([id, startedAt, terminationId, requestId, eventId, notice]) => ({
  id, startedAt, terminationId, requestId, eventId, notice,
}));

const reportHash = body => hash(JSON.stringify(body));
const version = snap => snap.updateTime ? [snap.updateTime.seconds, snap.updateTime.nanoseconds] : null;
const millis = entry => Date.parse(entry.timestamp);
const instance = entry => entry.labels?.instanceId;
const eventIdOf = entry => entry.labels?.['run.googleapis.com/cloud_event_id'];
const revision = entry => entry.resource?.labels?.revision_name;
const evidence = entry => ({
  insertId: entry.insertId, logName: entry.logName, timestamp: entry.timestamp,
  instance: instance(entry), revision: revision(entry), ...(entry.trace ? { trace: entry.trace } : {}),
});

function loggingFilter() {
  const windows = CASES.map(({ startedAt }) => {
    const at = Date.parse(startedAt);
    return `(timestamp >= "${new Date(at - 80_000).toISOString()}" AND timestamp <= "${new Date(at + 5000).toISOString()}")`;
  });
  const operations = CASES.map(({ id }) => `jsonPayload.releaseOperationId="${id}"`).join(' OR ');
  return `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND resource.labels.location="europe-west1" AND ((${windows.join(' OR ')}) OR (timestamp >= "2026-11-20T14:15:00Z" AND (${operations})))`;
}

async function readIncidentLogs(credential, project, { request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const token = await credential.getAccessToken();
  const entries = [];
  const tokens = new Set();
  let pageToken;
  do {
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await request('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json', 'x-goog-user-project': project },
        body: JSON.stringify({ resourceNames: ['projects/' + project], filter: loggingFilter(), orderBy: 'timestamp asc', pageSize: 250, pageToken }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status !== 429 || attempt === 3) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(60_000, Math.max(retryAfter * 1000 || 0, 5000 * 2 ** attempt)));
    }
    if (!response.ok) throw new Error(`Cloud Logging HTTP ${response.status}. La evidencia no es completa.`);
    const page = await response.json();
    if (!page || typeof page !== 'object' || (page.entries !== undefined && !Array.isArray(page.entries))
      || (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')) {
      throw new Error('Respuesta de Cloud Logging inválida.');
    }
    entries.push(...(page.entries ?? []));
    pageToken = page.nextPageToken;
    if (pageToken) {
      if (tokens.has(pageToken) || tokens.size >= 8) throw new Error('Paginación de Cloud Logging incompleta.');
      tokens.add(pageToken);
    }
  } while (pageToken);
  return entries;
}

function correlateIncidentLogs(entries) {
  const ids = new Set(CASES.map(item => item.id));
  if (entries.some(entry => ids.has(entry.jsonPayload?.releaseOperationId))) {
    throw new Error('Aparecieron registros directos de una concesión. Revisar el informe antes de usar la vía de interrupción.');
  }
  return CASES.map(item => {
    const request = entries.find(entry => entry.insertId === item.requestId && entry.logName?.endsWith('%2Frequests'));
    const termination = entries.find(entry => entry.insertId === item.terminationId && entry.logName?.endsWith('%2Fvarlog%2Fsystem'));
    const at = Date.parse(item.startedAt);
    if (!request?.httpRequest || !request.trace || !instance(request) || !termination
      || revision(request) !== REVISION || revision(termination) !== REVISION
      || instance(request) !== instance(termination) || eventIdOf(request) !== item.eventId
      || !(Math.abs(millis(termination) - at) <= 1500)
      || !(millis(request) >= at - 80_000 && millis(request) <= at)
      || !/Memory limit of 256 MiB exceeded/.test(termination.textPayload ?? '')) {
      throw new Error(`Falta acreditar la terminación de la instancia para ${item.id}.`);
    }
    const competing = entries.filter(entry => {
      if (!entry.httpRequest || !entry.logName?.endsWith('%2Frequests') || millis(entry) > at + 1000) return false;
      const latency = Number.parseFloat(entry.httpRequest.latency);
      if (!Number.isFinite(latency)) return millis(entry) >= at - 80_000 && instance(entry) !== instance(termination);
      return millis(entry) + latency * 1000 >= at - 1500 && instance(entry) !== instance(termination);
    });
    if (competing.length) throw new Error(`Otra instancia coincide con la admisión de ${item.id}. Revisar correlación.`);
    const sameInstance = entries.filter(entry => entry.httpRequest && revision(entry) === REVISION
      && instance(entry) === instance(termination) && millis(entry) <= millis(termination) && millis(entry) >= at - 80_000);
    if (sameInstance.some(entry => !entry.trace || !eventIdOf(entry)
      || (!CASES.some(other => other.terminationId === item.terminationId && other.requestId === entry.insertId)
        && !entries.some(log => log.trace === entry.trace && log.jsonPayload?.releaseOperationState === 'handler_finished')))) {
      throw new Error(`Hay solicitudes sin explicar en la instancia terminada para ${item.id}.`);
    }
    return {
      id: item.id, eventId: item.eventId, notice: item.notice,
      association: CASES.filter(other => other.terminationId === item.terminationId).length > 1 ? 'shared_instance' : 'reviewed_instance',
      request: { ...evidence(request), httpStatus: request.httpRequest.status },
      termination: { ...evidence(termination), reason: 'memory_limit_exceeded' },
      instanceRequests: sameInstance.map(entry => ({
        ...evidence(entry), eventId: eventIdOf(entry),
        finishedLogId: entries.find(log => log.trace === entry.trace && log.jsonPayload?.releaseOperationState === 'handler_finished')?.insertId ?? null,
      })).sort((a, b) => a.insertId.localeCompare(b.insertId)),
    };
  });
}

function assertGate(gate, config, manifest, { allowFrozen = false } = {}) {
  if ((gate?.phase !== 'draining' && !(allowFrozen && gate?.phase === 'frozen')) || gate.releaseId !== RELEASE
    || manifest.releaseId !== RELEASE || gate.epoch !== 1 || !(Date.parse(gate.closedAt) > Date.parse(CASES.at(-1).startedAt))
    || config?.maintenanceMode !== true || config.automaticMinuteRefundsEnabled === true) {
    throw new Error('El proyecto no conserva el mantenimiento del incidente en la época 1.');
  }
}

async function readOperations(tx, db) {
  const docs = await tx.getAll(...CASES.map(item => db.doc(OP + item.id)), ...CASES.map(item => db.doc(AUDIT + item.id)));
  return { operations: docs.slice(0, CASES.length), receipts: docs.slice(CASES.length) };
}

async function readNotices(tx, db) {
  const candidates = CASES.map(item => {
    const key = 'appt:' + item.eventId;
    return {
      key, refs: [
        db.doc('notification_deliveries/' + hash(key)),
        db.doc('email_dispatches/' + hash(key + ':email')),
        db.doc('push_dispatches/' + hash(key + ':push')),
        db.doc('release_deferred_events/' + hash(FUNCTION_NAME + ':' + item.eventId)),
      ],
    };
  });
  const docs = await tx.getAll(...candidates.flatMap(item => item.refs));
  const historyRefs = new Map();
  for (let i = 0; i < CASES.length; i++) {
    const delivery = docs[i * 4];
    const uid = delivery.get('uid');
    if (delivery.exists && typeof uid === 'string' && uid && !uid.includes('/')) {
      historyRefs.set(i, db.doc(`users/${uid}/notifications/${delivery.id}`));
    }
  }
  const historyDocs = historyRefs.size ? await tx.getAll(...historyRefs.values()) : [];
  const histories = new Map([...historyRefs.keys()].map((index, offset) => [index, historyDocs[offset]]));
  return CASES.map((item, i) => {
    const [delivery, email, push, deferred] = docs.slice(i * 4, (i + 1) * 4);
    const history = histories.get(i);
    const channels = Object.fromEntries(Object.entries(delivery.get('channels') ?? {}).map(([name, channel]) => [name, channel.status]).sort());
    if (item.notice === 'complete') {
      if (delivery.get('dedupeKey') !== candidates[i].key || delivery.get('status') !== 'complete' || channels.history !== 'sent'
        || !history?.exists || channels.email !== 'sent' || email.get('status') !== 'sent' || !email.get('messageId')
        || !['sent', 'skipped'].includes(channels.push) || (channels.push === 'sent' && push.get('status') !== 'sent')
        || (push.exists && push.get('status') !== 'sent') || deferred.exists) {
        throw new Error(`Los recibos del evento ${item.eventId} no acreditan una entrega final.`);
      }
    } else if ([delivery, email, push, deferred].some(snap => snap.exists)) {
      throw new Error(`Apareció evidencia para el aviso pendiente de revisión ${item.eventId}.`);
    }
    return {
      eventId: item.eventId, disposition: item.notice, channels,
      providerAccepted: email.get('status') === 'sent' && Boolean(email.get('messageId')),
      documents: [delivery, email, push, deferred, history].filter(Boolean).map(snap => ({ path: snap.ref.path, version: version(snap) })),
    };
  });
}

async function readEvidence(tx, db, manifest, logProof) {
  const [gateSnap, config, active, { operations, receipts }] = await Promise.all([
    tx.get(db.doc(GATE)), tx.get(db.doc(CONFIG)), tx.get(db.collection('release_operations').where('state', '==', 'active').limit(CASES.length + 1)),
    readOperations(tx, db),
  ]);
  const gate = gateSnap.data();
  assertGate(gate, config.data(), manifest);
  if (active.size !== CASES.length || receipts.some(snap => snap.exists)) throw new Error('El conjunto de concesiones activas o sus recibos ha cambiado.');
  for (let i = 0; i < CASES.length; i++) {
    const item = CASES[i];
    const operation = operations[i];
    if (operation.get('state') !== 'active' || operation.get('operation') !== FUNCTION_NAME || operation.get('releaseId') !== 'bootstrap'
      || operation.get('startedAt') !== item.startedAt || !operation.updateTime || !active.docs.some(snap => snap.id === item.id)) {
      throw new Error(`La concesión ${item.id} ya no coincide con el incidente.`);
    }
  }
  const notices = await readNotices(tx, db);
  return {
    schema: SCHEMA, projectId: manifest.projectId, releaseId: RELEASE, manifestHash: manifest.manifestHash, epoch: gate.epoch,
    maintenance: { closedAt: gate.closedAt, originalManifestHash: gate.manifestHash ?? null },
    operations: CASES.map((item, i) => ({
      startedAt: item.startedAt, version: version(operations[i]), ...logProof[i], delivery: notices[i],
    })),
    completeNotices: notices.filter(item => item.disposition === 'complete').length,
    followUpNotices: notices.filter(item => item.disposition === 'follow_up').length,
    action: 'release_interrupted_operations_without_replay',
  };
}

async function auditInterruptedOperations(db, manifest, readLogs) {
  const proof = correlateIncidentLogs(await readLogs());
  const body = await db.runTransaction(tx => readEvidence(tx, db, manifest, proof), { readOnly: true });
  return { ...body, reportHash: reportHash(body) };
}

function assertReviewedReport(report, approvedHash, reviewerUid, acknowledged, manifest) {
  const { reportHash: embedded, ...body } = report ?? {};
  if (!acknowledged || !/^[a-f0-9]{64}$/.test(approvedHash ?? '') || approvedHash !== embedded || reportHash(body) !== embedded
    || body.schema !== SCHEMA || body.projectId !== manifest.projectId || body.releaseId !== RELEASE
    || body.manifestHash !== manifest.manifestHash || body.epoch !== 1 || !/^[^/\s]{1,128}$/.test(reviewerUid ?? '')
    || JSON.stringify(body.operations?.map(item => item.id)) !== JSON.stringify(CASES.map(item => item.id))) {
    throw new Error('Falta el informe íntegro de este release, el hash aprobado, el UID revisor o la aceptación del seguimiento de avisos.');
  }
}

async function checkExistingResolution(tx, db, manifest, report, reviewerUid) {
  const [{ operations, receipts }, gate, config, reviewer] = await Promise.all([
    readOperations(tx, db), tx.get(db.doc(GATE)), tx.get(db.doc(CONFIG)), tx.get(db.doc('users/' + reviewerUid)),
  ]);
  assertGate(gate.data(), config.data(), manifest, { allowFrozen: true });
  if (reviewer.get('role') !== 'admin') throw new Error('El UID revisor debe pertenecer a un administrador.');
  const completed = receipts.every((receipt, i) => receipt.get('command') === COMMAND && receipt.get('operationId') === CASES[i].id
    && receipt.get('reportHash') === report.reportHash && receipt.get('epoch') === report.epoch
    && operations[i].get('state') === 'interrupted' && operations[i].get('recoveryReportHash') === report.reportHash);
  if (completed) return true;
  if (receipts.some(receipt => receipt.exists) || operations.some(snap => snap.get('state') !== 'active')) {
    throw new Error('Hay una resolución parcial o un recibo de otro informe. No se modifica ninguna concesión.');
  }
  return false;
}

async function resolveInterruptedOperations(db, manifest, report, { approvedHash, reviewerUid, acknowledged, readLogs, verifyBootstrap }) {
  assertReviewedReport(report, approvedHash, reviewerUid, acknowledged, manifest);
  if (await db.runTransaction(tx => checkExistingResolution(tx, db, manifest, report, reviewerUid), { readOnly: true })) {
    return { alreadyResolved: true, operations: CASES.length };
  }
  await verifyBootstrap();
  const proof = correlateIncidentLogs(await readLogs());
  return db.runTransaction(async tx => {
    if (await checkExistingResolution(tx, db, manifest, report, reviewerUid)) return { alreadyResolved: true, operations: CASES.length };
    const current = await readEvidence(tx, db, manifest, proof);
    if (reportHash(current) !== report.reportHash) throw new Error('La evidencia cambió. Genera y revisa un informe nuevo.');
    const resolvedAt = new Date().toISOString();
    for (const operation of current.operations) {
      tx.update(db.doc(OP + operation.id), {
        state: 'interrupted', resolvedAt, recoveryReportHash: report.reportHash, recoveryEpoch: current.epoch,
        noticeDisposition: operation.notice,
      });
      tx.create(db.doc(AUDIT + operation.id), {
        command: COMMAND, operationId: operation.id, releaseId: RELEASE, epoch: current.epoch, projectId: manifest.projectId,
        manifestHash: manifest.manifestHash, reportHash: report.reportHash, reviewerUid, resolvedAt,
        evidence: operation, replayed: false,
      });
    }
    return { alreadyResolved: false, operations: CASES.length, followUpNotices: current.followUpNotices };
  });
}

module.exports = {
  auditInterruptedOperations, assertReviewedReport, resolveInterruptedOperations, readIncidentLogs,
  correlateIncidentLogs, CASES, FUNCTION_NAME, SERVICE, REVISION,
};
