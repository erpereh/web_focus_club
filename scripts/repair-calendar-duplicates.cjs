#!/usr/bin/env node
// One-off repair for the two reviewed November 2026 appointments.
const { spawnSync } = require('node:child_process');
const c = require('./release-common.cjs');
const { CALENDAR, FUNCTION, listCalendarEvents } = require('./sync-google-calendar-appointments.cjs');
const {
  buildCalendarEventPayload, buildCalendarSyncHash, calendarEventAppointmentIds,
  CALENDAR_APPOINTMENT_PROPERTY, CALENDAR_SYNC_HASH_PROPERTY, resolveAppointmentSlot, stableCalendarEventId,
} = require('../functions/lib/googleCalendarSync.js');

const PROJECT = 'focus-club-f73b8';
const REVISION = 'syncappointmentwithgooglecalendar-00014-jok';
const ORIGINAL_HASH = '24cd688e48aebb1682e81c294807c282dfd0fa714708a900ec80ddb76031e9b6';
const CASES = [
  { id: 'MvM1yRidvYQbJZViJX0S', date: '2026-11-25', keep: 'pccmlg3o6meovi75pv36lqtmok', drop: '347clrb6g1p2je2dgt94tqm9ms', keepState: 'pending' },
  { id: '3nw2G4rXSOvfSStZlcjT', date: '2026-11-26', keep: 'gtul0tguddpgnnvmee8rfqc2v0', drop: 's6q51pch3pi472rjve13j1up38', keepState: 'approved' },
];
const EVENT_IDS = CASES.flatMap(({ keep, drop }) => [keep, drop]);
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const DATABASE = 'projects/' + PROJECT + '/databases/(default)';
const FIRESTORE_URL = 'https://firestore.googleapis.com/v1/' + DATABASE;
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CALENDAR) + '/events';
const APPOINTMENT_TIME = '17:30';

class Stop extends Error {}
function requireCheck(condition, message) {
  if (!condition) throw new Stop(message);
}
function safeError(error) {
  return error instanceof Stop ? error.message : 'Fallo inesperado en la etapa actual.';
}
function version(snapshot) {
  const time = snapshot.updateTime;
  return time ? new Date(time.seconds * 1000).toISOString().slice(0, 19) + '.' + String(time.nanoseconds).padStart(9, '0') + 'Z' : null;
}
function normalizeVersion(value) {
  return typeof value === 'string' ? value.replace(/^(.*?:\d{2})(?:\.(\d{1,9}))?Z$/, (_, date, ns) => date + '.' + (ns ?? '').padEnd(9, '0') + 'Z') : null;
}

function readReviewedAudit() {
  const file = c.path.join(c.root, 'release/calendar-audit-20261123-152623.json');
  const { reportHash, ...audit } = c.readJson(file);
  requireCheck(reportHash === ORIGINAL_HASH && c.hash(JSON.stringify(audit)) === reportHash
    && audit.projectId === PROJECT && audit.calendar?.status === 'read' && audit.calendar.calendar === CALENDAR
    && audit.runtime?.servingRevision === REVISION, 'El informe revisado no coincide con el proyecto, calendario y revisión autorizados.');
  const etags = new Map();
  for (const { id, keep, drop, keepState, date } of CASES) {
    const matches = audit.findings.duplicates.find(item => item.appointmentId === id)?.matches;
    requireCheck(matches?.length === 2, 'El informe revisado no identifica exactamente dos eventos por cita.');
    for (const [eventId, state] of [[keep, keepState], [drop, 'pending']]) {
      const match = matches.find(item => item.eventId === eventId);
      requireCheck(match?.state === state && match.startsAt === date + 'T17:30:00+01:00' && validEtag(match.etag),
        'El informe revisado cambió de identidad, estado, horario o ETag.');
      etags.set(eventId, match.etag);
    }
  }
  return { etags, reportHash, calendarReadAt: audit.calendar.readAt, operations: audit.operations.map(operation => operation.id) };
}

async function snapshotFirestore(db, reviewed) {
  return db.runTransaction(async tx => {
    const refs = CASES.flatMap(({ id }) => [db.doc('appointments/' + id), db.doc('google_calendar_sync/' + id)]);
    const [records, release, config, deferred, cutover, active, references] = await Promise.all([
      tx.getAll(...refs), tx.get(db.doc('system_controls/release')), tx.get(db.doc('site_config/main')),
      tx.get(db.doc('system_controls/deferred')), tx.get(db.doc('system_controls/google_calendar_v2')),
      tx.get(db.collection('release_operations').where('state', '==', 'active')),
      Promise.all(EVENT_IDS.map(id => tx.get(db.collection('appointments').where('googleCalendarEventId', '==', id).select()))),
    ]);
    const [first, , second] = records;
    const a = first.data() ?? {};
    const [user, trainer] = await Promise.all([
      a.userId ? tx.get(db.collection('users').doc(a.userId)) : null,
      a.assignedTrainer ? tx.get(db.collection('trainers').doc(a.assignedTrainer)) : null,
    ]);
    const profile = user?.data() ?? {};
    const build = {
      appointmentId: first.id, appointment: a, trainerName: trainer?.get('name') ?? '',
      client: { name: profile.name || a.name || 'Cliente', email: profile.email || a.email || '', phone: profile.phone || a.phone || '' },
    };
    const operations = active.docs.filter(doc => doc.get('operation') === FUNCTION)
      .map(doc => ({ id: doc.id, version: version(doc), revision: doc.get('revision') ?? null, startedAt: doc.get('startedAt') ?? null }))
      .sort((first, second) => first.id.localeCompare(second.id));
    return {
      records, details: [user, trainer].filter(Boolean), build, operations,
      summary: {
        readTime: first.readTime.toDate().toISOString(),
        release: { phase: release.get('phase'), occupancyVersion: release.get('occupancyVersion'),
          maintenanceMode: config.get('maintenanceMode') === true, automaticRefunds: config.get('automaticMinuteRefundsEnabled') === true,
          deferred: Number(deferred.get('pending') ?? 0), cutoverReady: typeof cutover.get('readyAt') === 'number' && cutover.get('readyAt') < first.readTime.toMillis() },
        cases: [first, second].map((doc, index) => {
          const sync = records[index * 2 + 1];
          const leaseUntil = sync.get('leaseUntil');
          return { id: doc.id, status: doc.get('status'), eventId: doc.get('googleCalendarEventId'), slot: resolveAppointmentSlot(doc.data() ?? {}),
            recurring: Boolean(doc.get('recurrenceSeriesId')), version: version(doc), syncVersion: version(sync), binding: sync.get('eventId') ?? null,
            hasToken: Boolean(sync.get('token')), leaseUntil: typeof leaseUntil === 'number' && Number.isFinite(leaseUntil) ? leaseUntil : null,
            inconsistentLease: (leaseUntil !== undefined && (!Number.isFinite(leaseUntil) || typeof sync.get('token') !== 'string' || !sync.get('token')))
              || (sync.get('token') !== undefined && leaseUntil === undefined),
            dirty: sync.get('dirty') === true, error: Boolean(sync.get('lastError')),
            keepReferences: references[index * 2].docs.map(d => d.id), dropReferences: references[index * 2 + 1].docs.map(d => d.id),
          };
        }),
        historicalOperations: operations.filter(operation => reviewed.operations.includes(operation.id)),
      },
    };
  }, { readOnly: true });
}

function validateFirestore(record, reviewed) {
  const { summary, operations } = record;
  const gate = summary.release;
  requireCheck(gate.phase === 'open' && gate.occupancyVersion === 2 && !gate.maintenanceMode
    && !gate.automaticRefunds && gate.deferred === 0 && gate.cutoverReady, 'El estado de publicación o mantenimiento cambió.');
  const readTime = Date.parse(summary.readTime);
  requireCheck(Number.isFinite(readTime) && reviewed.operations.every(id => summary.historicalOperations.some(operation => operation.id === id)),
    'Falta evidencia de alguna operación histórica.');
  requireCheck(operations.every(operation => reviewed.operations.includes(operation.id)
    && Number.isFinite(Date.parse(operation.startedAt)) && Date.parse(operation.startedAt) < readTime - 90_000
    && operation.revision !== REVISION), 'Se detectó una operación activa de Calendar que requiere revisión.');
  for (let i = 0; i < CASES.length; i++) {
    const expected = CASES[i], item = summary.cases[i];
    requireCheck(item.id === expected.id && item.status === 'approved' && item.eventId === expected.keep && item.version
      && !item.recurring && item.slot?.date === expected.date && item.slot?.time === APPOINTMENT_TIME
      && item.keepReferences.length === 1 && item.keepReferences[0] === expected.id && item.dropReferences.length === 0,
    'Cambió la cita o la vinculación de ' + expected.id + '.');
    requireCheck(!item.dirty && !item.error && !item.inconsistentLease && (item.binding === null || item.binding === expected.keep)
      && (item.leaseUntil === null || item.leaseUntil < readTime) && (item.leaseUntil !== null || !item.hasToken),
    'La exclusión o el estado del sincronizador requiere revisión para ' + expected.id + '.');
  }
}

async function verifyRuntime(credential) {
  const fn = (await c.deployedFunctions(credential, PROJECT)).find(item => item.name.endsWith('/' + FUNCTION));
  requireCheck(fn?.serviceConfig?.revision === REVISION && fn.serviceConfig.service
    && fn.serviceConfig.timeoutSeconds === 60 && fn.eventTrigger?.retryPolicy === 'RETRY_POLICY_RETRY',
  'La Function publicada cambió respecto de la revisión aprobada.');
  const [run, db] = await Promise.all([
    c.googleGet(credential, 'https://run.googleapis.com/v2/' + fn.serviceConfig.service),
    c.googleGet(credential, FIRESTORE_URL),
  ]);
  requireCheck(run.terminalCondition?.state === 'CONDITION_SUCCEEDED' && !run.reconciling && run.latestReadyRevision?.endsWith('/' + REVISION)
    && run.trafficStatuses?.length === 1 && run.trafficStatuses[0].revision === REVISION && run.trafficStatuses[0].percent === 100,
  'Cloud Run no acredita el 100 % del tráfico sobre la revisión autorizada.');
  requireCheck(db.concurrencyMode === 'PESSIMISTIC' && db.databaseEdition === 'STANDARD',
    'Firestore no acredita el modo pesimista requerido.');
  return { revision: REVISION, traffic: 100, concurrencyMode: db.concurrencyMode, databaseEdition: db.databaseEdition };
}

async function calendarToken() {
  const { GoogleAuth, OAuth2Client } = c.requireFunctions('google-auth-library');
  let token = process.env.FOCUS_CALENDAR_WRITE_TOKEN;
  if (!token) {
    try { token = await new GoogleAuth({ scopes: [SCOPE] }).getAccessToken(); }
    catch { throw new Stop('Calendar no dispone de ADC ni de FOCUS_CALENDAR_WRITE_TOKEN en esta sesión.'); }
  }
  requireCheck(token, 'Falta una credencial temporal de Calendar.');
  let info;
  try { info = await new OAuth2Client().getTokenInfo(token); }
  catch { throw new Stop('No se pudo verificar el alcance de la credencial de Calendar.'); }
  requireCheck(info.scopes?.includes(SCOPE) && info.expiry_date > Date.now() + 120_000,
    'La credencial de Calendar requiere el alcance calendar.events y al menos dos minutos de vigencia.');
  return token;
}

function validEtag(etag) {
  return typeof etag === 'string' && /^"[^"\r\n]+"$/.test(etag);
}
function displayState(event) {
  if (/^Aprobada - /.test(event.summary ?? '')) return 'approved';
  if (/^Pendiente - /.test(event.summary ?? '')) return 'pending';
  return 'unknown';
}
function belongs(event, appointmentId) {
  const ids = calendarEventAppointmentIds(event);
  return ids.length === 1 && ids[0] === appointmentId;
}
function timedFor(event, date) {
  return Date.parse(event.start?.dateTime) === Date.parse(date + 'T17:30:00+01:00');
}
function assertEvent(event, id, item, state, etag) {
  requireCheck(event?.id === id && event.status === 'confirmed' && validEtag(event.etag) && (!etag || event.etag === etag)
    && belongs(event, item.id) && displayState(event) === state && timedFor(event, item.date)
    && !event.recurringEventId && !event.recurrence?.length && !event.locked
    && !event.attendeesOmitted && !event.attendees?.length,
  'Identidad, versión, estado, horario o datos de seguridad inesperados en el evento ' + id + '.');
}
function inventoryFor(events, item) {
  const related = events.filter(event => event.status !== 'cancelled' && (
    [item.keep, item.drop, stableCalendarEventId(item.id)].includes(event.id)
    || calendarEventAppointmentIds(event).includes(item.id)
  ));
  return related.map(event => ({ id: event.id, etag: event.etag ?? null, status: event.status ?? null,
    state: displayState(event), start: event.start?.dateTime ?? null, identityVerified: belongs(event, item.id) }));
}

function calendarClient(token, request = fetch) {
  async function call(method, id, { etag, body, timeout = 8000 } = {}) {
    requireCheck(EVENT_IDS.includes(id), 'Evento fuera del alcance autorizado.');
    requireCheck(method === 'GET' || (method === 'PATCH' && id === CASES[0].keep && validEtag(etag))
      || (method === 'DELETE' && CASES.some(item => item.drop === id) && validEtag(etag)),
    'Método, evento o ETag fuera del alcance autorizado.');
    const write = method !== 'GET';
    let response;
    try {
      response = await request(CALENDAR_URL + '/' + encodeURIComponent(id) + (write ? '?sendUpdates=none' : ''), {
        method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { Authorization: 'Bearer ' + token, ...(write ? { 'If-Match': etag } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Stop('Calendar ' + method + ' ' + id + ' no respondió de forma verificable.'); }
    if (!write && [404, 410].includes(response.status)) return { event: null, http: response.status };
    requireCheck(response.status === (method === 'DELETE' ? 204 : 200),
      'Calendar ' + method + ' ' + id + ' devolvió HTTP ' + response.status + '.');
    if (method === 'DELETE') return { http: response.status };
    try { return { event: await response.json(), http: response.status }; }
    catch { throw new Stop('Calendar ' + method + ' ' + id + ' devolvió una respuesta ilegible.'); }
  }
  return {
    call,
    inventory: () => listCalendarEvents(token, { request: async (url, options) => {
      const response = await request(url, { ...options, redirect: 'error' });
      if (response.ok) {
        const data = await response.clone().json();
        requireCheck(['writer', 'owner'].includes(data.accessRole), 'El calendario compartido requiere rol writer u owner.');
      }
      return response;
    } }),
  };
}

function planWrites(originals, build) {
  const [keep, firstDrop, , secondDrop] = originals;
  const payload = buildCalendarEventPayload(build);
  requireCheck(payload && displayState(payload) === 'approved', 'No se pudo generar el evento aprobado desde Firestore.');
  const patch = { ...payload, status: 'confirmed', extendedProperties: {
    ...keep.extendedProperties, private: {
      ...keep.extendedProperties?.private,
      [CALENDAR_APPOINTMENT_PROPERTY]: CASES[0].id,
      [CALENDAR_SYNC_HASH_PROPERTY]: buildCalendarSyncHash(build),
    },
  } };
  return [[keep, 'PATCH', patch], [firstDrop, 'DELETE'], [secondDrop, 'DELETE']].map(([event, method, body]) => ({
    id: event.id, method, etag: event.etag, ...(body ? { body } : {}),
  }));
}

function assertPatched(event, body, previousEtag) {
  assertEvent(event, CASES[0].keep, CASES[0], 'approved');
  requireCheck(event.etag !== previousEtag && event.summary === body.summary && event.description === body.description
    && event.colorId === body.colorId && Date.parse(event.end?.dateTime) === Date.parse(body.end.dateTime + '+01:00')
    && Object.entries(body.extendedProperties).every(([key, values]) => Object.entries(values ?? {})
      .every(([name, value]) => event.extendedProperties?.[key]?.[name] === value)),
  'El evento aprobado no coincide con el contenido previsto.');
}

async function lockTargetDocs(credential, snapshot, run, request = fetch) {
  const { access_token: token } = await credential.getAccessToken();
  const started = performance.now();
  const budget = () => {
    const remaining = Math.floor(14_000 - (performance.now() - started));
    requireCheck(remaining >= 1000, 'Se agotó la ventana segura del bloqueo de Firestore.');
    return Math.min(remaining - 300, 3000);
  };
  async function post(operation, body, timeout) {
    let response;
    try {
      response = await request(FIRESTORE_URL + '/documents:' + operation, {
        method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
      });
    } catch { throw new Stop('Firestore ' + operation + ' no respondió de forma verificable.'); }
    requireCheck(response.ok, 'Firestore ' + operation + ' devolvió HTTP ' + response.status + '.');
    return response.json();
  }
  const { transaction } = await post('beginTransaction', { options: { readWrite: {} } }, budget());
  requireCheck(typeof transaction === 'string' && transaction, 'Firestore no devolvió un identificador de transacción.');
  try {
    const names = snapshot.records.map(doc => DATABASE + '/documents/' + doc.ref.path);
    const docs = await post('batchGet', { transaction, documents: names }, budget());
    requireCheck(Array.isArray(docs) && docs.length === names.length
      && snapshot.records.every((doc, index) => {
        const entries = docs.filter(entry => (entry.found?.name ?? entry.missing) === names[index]);
        return entries.length === 1 && (doc.exists
          ? Boolean(entries[0].found) && normalizeVersion(entries[0].found.updateTime) === version(doc)
          : entries[0].missing === names[index]);
      }), 'Cambió una versión de cita o una concesión al adquirir el bloqueo.');
    await run(budget);
  } finally {
    await post('rollback', { transaction }, 3500);
  }
}

async function runRepair({ mode, reviewed, services, report }) {
  let stage = 'preflight';
  let plan;
  const attempted = report.operations;
  try {
    const [firestore, runtime, auth] = await Promise.allSettled([services.firestore().then(record => {
      report.firestoreBefore = record.summary;
      validateFirestore(record, reviewed);
      return record;
    }), services.runtime(), services.calendar()]);
    if (runtime.status === 'fulfilled') report.runtime = runtime.value;
    report.preflight = Object.fromEntries(Object.entries({ firestore, runtime, calendarCredential: auth })
      .map(([name, value]) => [name, value.status === 'fulfilled' ? 'ok' : safeError(value.reason)]));
    const rejected = [firestore, runtime, auth].find(value => value.status === 'rejected');
    if (rejected) throw rejected.reason;
    const remote = auth.value;
    stage = 'calendar-audit';
    const [inventory, ...raw] = await Promise.all([remote.inventory(), ...EVENT_IDS.map(id => remote.call('GET', id))]);
    const originals = raw.map(item => item.event);
    report.calendarBefore = CASES.map(item => ({ appointmentId: item.id, events: inventoryFor(inventory, item) }));
    for (const [index, item] of CASES.entries()) {
      const matches = report.calendarBefore[index].events;
      requireCheck(matches.length === 2 && matches.every(event => [item.keep, item.drop].includes(event.id)
        && event.identityVerified && event.etag === reviewed.etags.get(event.id)), 'El inventario o los ETags del informe cambiaron para ' + item.id + '.');
      assertEvent(originals[index * 2], item.keep, item, item.keepState, reviewed.etags.get(item.keep));
      assertEvent(originals[index * 2 + 1], item.drop, item, 'pending', reviewed.etags.get(item.drop));
    }
    stage = 'backup';
    report.backup = services.backup(originals);
    stage = 'dry-run';
    plan = planWrites(originals, firestore.value.build);
    report.dryRun = plan.map(({ id, method, etag }) => ({ id, method, etag, sendUpdates: 'none' }));
    services.journal({ stage, writes: report.dryRun, firestoreWrites: 0 });
    if (mode === 'dry-run') { report.status = 'dry-run-passed'; return; }
    stage = 'apply';
    await services.lock(firestore.value, async budget => {
      const [fresh, unchanged] = await Promise.all([
        Promise.all(EVENT_IDS.map(id => remote.call('GET', id, { timeout: budget() }))),
        services.checkDetails(firestore.value.details, budget()),
      ]);
      requireCheck(unchanged, 'Cambió el perfil del cliente o el entrenador antes de aplicar.');
      for (const [index, item] of CASES.entries()) {
        assertEvent(fresh[index * 2].event, item.keep, item, item.keepState, reviewed.etags.get(item.keep));
        assertEvent(fresh[index * 2 + 1].event, item.drop, item, 'pending', reviewed.etags.get(item.drop));
      }
      for (const [index, operation] of plan.entries()) {
        if (index > 0) {
          const item = CASES[index - 1];
          const { event } = await remote.call('GET', item.keep, { timeout: budget() });
          if (index === 1) assertPatched(event, plan[0].body, plan[0].etag);
          else assertEvent(event, item.keep, item, 'approved', reviewed.etags.get(item.keep));
        }
        budget();
        const entry = { ...report.dryRun[index], result: 'attempting' };
        services.journal(entry);
        attempted.push(entry);
        try {
          const response = await remote.call(operation.method, operation.id, { etag: operation.etag, body: operation.body, timeout: budget() });
          entry.http = response.http;
          if (operation.method === 'PATCH') assertPatched(response.event, operation.body, operation.etag);
          entry.result = 'acknowledged';
        } catch (error) {
          entry.result = 'stopped';
          entry.reason = safeError(error);
          throw error;
        } finally { services.journal(entry); }
      }
    });
    stage = 'verify';
  } catch (error) {
    report.failure = { stage, reason: safeError(error) };
    report.status = attempted.length ? 'partial-or-unverified' : 'blocked';
  }
  if (!attempted.length) return;
  const [afterFirestore, afterCalendar] = await Promise.allSettled([services.firestore(), services.verifyCalendar()]);
  if (afterFirestore.status === 'fulfilled') report.firestoreAfter = afterFirestore.value.summary;
  if (afterCalendar.status === 'fulfilled') {
    report.calendarAfter = CASES.map(item => ({ appointmentId: item.id,
      events: inventoryFor(afterCalendar.value.inventory, item),
      direct: afterCalendar.value.direct.filter(({ id }) => [item.keep, item.drop].includes(id))
        .map(({ id, http, event }) => ({ id, http, status: event?.status ?? null, etag: event?.etag ?? null })),
    }));
  }
  try {
    requireCheck(afterFirestore.status === 'fulfilled' && afterCalendar.status === 'fulfilled', 'Falló la lectura posterior de Calendar o Firestore.');
    validateFirestore(afterFirestore.value, reviewed);
    const before = report.firestoreBefore;
    const after = report.firestoreAfter;
    requireCheck(before.cases.every((item, index) => item.version === after.cases[index].version && item.syncVersion === after.cases[index].syncVersion)
      && JSON.stringify(before.historicalOperations) === JSON.stringify(after.historicalOperations), 'Cambió una versión de Firestore durante la reparación.');
    for (const [index, item] of CASES.entries()) {
      const matches = report.calendarAfter[index].events;
      const keep = afterCalendar.value.direct.find(event => event.id === item.keep);
      const drop = afterCalendar.value.direct.find(event => event.id === item.drop);
      requireCheck(matches.length === 1 && matches[0].id === item.keep && matches[0].etag === keep?.event?.etag
        && matches[0].identityVerified && matches[0].state === 'approved'
        && ([404, 410].includes(drop?.http) || drop?.event?.status === 'cancelled'), 'El inventario posterior no confirma un único evento aprobado para ' + item.id + '.');
      if (index === 0) assertPatched(keep.event, plan[0].body, plan[0].etag);
      else assertEvent(keep.event, item.keep, item, 'approved', reviewed.etags.get(item.keep));
    }
    report.finalStateVerified = true;
    report.status = report.failure ? 'verified-with-interruption' : 'verified';
  } catch (error) {
    report.finalStateVerified = false;
    report.verificationFailure = safeError(error);
    report.status = 'partial-or-unverified';
  }
}

function durableWrite(file, data, flag) {
  const descriptor = c.fs.openSync(file, flag);
  try { c.fs.writeFileSync(descriptor, data); c.fs.fsyncSync(descriptor); }
  finally { c.fs.closeSync(descriptor); }
}

function backupEvents(directory, events) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^FOCUS_CALENDAR_/i.test(key)));
  const command = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
    '$bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())',
    '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
    '$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)',
    '$decrypted = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, $scope)',
    'if ([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($decrypted)) { throw "Backup verification failed" }',
    '[Console]::Write([Convert]::ToBase64String($encrypted))',
  ].join('; ');
  const enc = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env, input: JSON.stringify(events), encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  requireCheck(enc.status === 0 && /^[A-Za-z0-9+/]+=*$/.test(enc.stdout ?? ''), 'Falló el respaldo cifrado local.');
  const file = c.path.join(directory, 'events-before.dpapi');
  const bytes = Buffer.from(enc.stdout, 'base64');
  durableWrite(file, bytes, 'wx');
  return { file, count: events.length, sha256: c.hash(bytes), encoding: 'Windows DPAPI CurrentUser' };
}

async function main() {
  const [modeArg, projectArg, project, ...extra] = process.argv.slice(2);
  requireCheck(!extra.length && project === PROJECT && (
    (modeArg === '--dry-run' && projectArg === '--project') || (modeArg === '--apply' && projectArg === '--confirm-project')
  ), 'Usa --dry-run --project ' + PROJECT + ' o --apply --confirm-project ' + PROJECT + '.');
  requireCheck(process.platform === 'win32' && process.env.LOCALAPPDATA
    && c.path.isAbsolute(process.env.LOCALAPPDATA) && !process.env.FIRESTORE_EMULATOR_HOST, 'Se requiere Windows, LocalAppData y Firestore de producción.');
  const root = c.fs.realpathSync(process.env.LOCALAPPDATA);
  requireCheck(!c.fs.realpathSync(c.root).toLowerCase().includes(root.toLowerCase()) && !root.toLowerCase().startsWith(c.root.toLowerCase() + c.path.sep),
    'La ubicación de los respaldos debe quedar fuera del repositorio.');
  const output = c.path.join(root, 'FocusClub', 'calendar-repair');
  c.fs.mkdirSync(output, { recursive: true });
  const actual = c.fs.realpathSync(output);
  requireCheck(actual.toLowerCase().startsWith(root.toLowerCase() + c.path.sep), 'El destino de auditoría sale de LocalAppData.');
  const directory = c.fs.mkdtempSync(c.path.join(actual, 'repair-' + new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  const file = c.path.join(directory, 'calendar-repair-audit.json');
  const mode = modeArg.slice(2);
  const report = {
    project: PROJECT, originalAuditHash: ORIGINAL_HASH, mode, startedAt: new Date().toISOString(),
    status: 'blocked', calendarBefore: null, calendarAfter: null, operations: [],
  };
  let db;
  try {
    const reviewed = readReviewedAudit();
    report.previousCalendarAudit = { readAt: reviewed.calendarReadAt,
      counts: CASES.map(item => ({ appointmentId: item.id, events: [item.keep, item.drop].filter(id => reviewed.etags.has(id)).length })) };
    c.readonlyFirestore();
    const initialized = await c.initialize(PROJECT);
    db = initialized.db;
    const credential = initialized.credential;
    let remote;
    await runRepair({ mode, reviewed, report, services: {
      firestore: () => snapshotFirestore(db, reviewed),
      runtime: () => verifyRuntime(credential),
      calendar: async () => { remote = calendarClient(await calendarToken()); return remote; },
      backup: events => backupEvents(directory, events),
      journal: entry => durableWrite(c.path.join(directory, 'operations.ndjson'), JSON.stringify(entry) + '\n', 'a'),
      lock: (snapshot, run) => lockTargetDocs(credential, snapshot, run),
      checkDetails: async (details, timeout) => !details.length || new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), timeout);
        db.getAll(...details.map(doc => doc.ref)).then(docs =>
          resolve(docs.every((doc, index) => version(doc) === version(details[index]))), () => resolve(false)).finally(() => clearTimeout(timer));
      }),
      verifyCalendar: async () => {
        const [inventory, ...direct] = await Promise.all([remote.inventory(), ...EVENT_IDS.map(async id => ({ id, ...await remote.call('GET', id) }))]);
        return { inventory, direct };
      },
    } });
  } catch (error) { report.failure ??= { stage: 'setup', reason: safeError(error) }; }
  finally {
    report.finishedAt = new Date().toISOString();
    durableWrite(file, JSON.stringify(report, null, 2) + '\n', 'wx');
    if (db) await db.terminate();
    console.log(JSON.stringify({ report: file, status: report.status, attempted: report.operations.length, failure: report.failure ?? null }));
  }
  if (!['dry-run-passed', 'verified'].includes(report.status)) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
module.exports = { CASES, calendarClient, lockTargetDocs, readReviewedAudit, runRepair, backupEvents };
