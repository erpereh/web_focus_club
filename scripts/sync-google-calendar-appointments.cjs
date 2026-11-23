#!/usr/bin/env node
const c = require('./release-common.cjs');
const { readIncidentLogs } = require('./interrupted-operations.cjs');
const { calendarEventAppointmentIds, normalizeAppointmentStatus, resolveAppointmentSlot, stableCalendarEventId } = require('../functions/lib/googleCalendarSync.js');
const PROJECT = 'focus-club-f73b8';
const FUNCTION = 'syncAppointmentWithGoogleCalendar';
const SERVICE = FUNCTION.toLowerCase();
const CALENDAR = 'ffd17bde7a4d70439683c1e14f5c63f9d19cb3ad3d28d055005d3ad7c692ee89@group.calendar.google.com';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

function inspectCalendar(appointments, events, deletions = new Set()) {
  const byId = new Map(appointments.map(appointment => [appointment.id, appointment]));
  const references = new Map();
  for (const appointment of appointments) if (appointment.eventId) {
    const ids = references.get(appointment.eventId) ?? [];
    ids.push(appointment.id);
    references.set(appointment.eventId, ids);
  }
  const stable = new Map(appointments.map(a => [stableCalendarEventId(a.id), a.id]));
  const counts = new Map();
  const ambiguous = [], orphaned = [], inactive = [], drift = [];
  const liveIds = new Set();
  for (const event of events) {
    if (event.status === 'cancelled') continue;
    liveIds.add(event.id);
    const evidence = [...new Set([...calendarEventAppointmentIds(event), ...(references.get(event.id) ?? []), stable.get(event.id)].filter(Boolean))];
    if (evidence.length > 1) { ambiguous.push({ eventId: event.id, appointmentIds: evidence }); continue; }
    if (!evidence.length) continue;
    const appointmentId = evidence[0];
    const state = /^Aprobada\s*-/.test(event.summary ?? '') ? 'approved' : /^Pendiente\s*-/.test(event.summary ?? '') ? 'pending' : 'unknown';
    const record = { eventId: event.id, state, startsAt: event.start?.dateTime ?? event.start?.date ?? null, etag: event.etag ?? null };
    let group = counts.get(appointmentId);
    if (!group) counts.set(appointmentId, group = []);
    group.push(record);
    const appointment = byId.get(appointmentId);
    if (!appointment) orphaned.push({ appointmentId, deletionRecord: deletions.has(appointmentId), ...record });
    else if (!appointment.visible) inactive.push({ appointmentId, status: appointment.status, ...record });
    else if (state !== appointment.status) drift.push({ appointmentId, status: appointment.status, ...record });
  }
  const missingApproved = appointments.filter(a => a.status === 'approved' && !a.recurring && !a.eventId)
    .map(a => ({ ...a, stableEventId: stableCalendarEventId(a.id), matches: counts.get(a.id) ?? [] }));
  return {
    duplicates: [...counts].filter(([, matches]) => matches.length > 1).map(([appointmentId, matches]) => ({ appointmentId, matches })),
    orphaned, inactive, ambiguous, drift, missingApproved,
    danglingLinks: appointments.filter(a => a.visible && a.eventId && !liveIds.has(a.eventId)).map(a => ({ appointmentId: a.id, eventId: a.eventId })),
  };
}

async function listCalendarEvents(accessToken, { request = fetch } = {}) {
  const events = new Map(), tokens = new Set();
  let pageToken;
  do {
    const query = new URLSearchParams({ maxResults: '500', singleEvents: 'false', showDeleted: 'false',
      fields: 'accessRole,nextPageToken,items(id,etag,status,start,summary,description,extendedProperties/private)' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events?${query}`, {
      method: 'GET', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Google Calendar rechazó la lectura (HTTP ${response.status}).`);
    const page = await response.json();
    if (!['reader', 'writer', 'owner'].includes(page.accessRole) || !Array.isArray(page.items)
      || page.items.some(event => !event.id) || (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')) {
      throw new Error('Google Calendar no expone detalles suficientes o devolvió una página inválida.');
    }
    for (const event of page.items) {
      if (events.has(event.id) && events.get(event.id).etag !== event.etag) throw new Error('El calendario cambió durante la lectura. Repetir la auditoría.');
      events.set(event.id, event);
    }
    pageToken = page.nextPageToken;
    if (pageToken) {
      if (tokens.has(pageToken) || tokens.size >= 100) throw new Error('Paginación de Calendar incompleta.');
      tokens.add(pageToken);
    }
  } while (pageToken);
  return [...events.values()];
}

function logFilter(operations) {
  const windows = operations.map(({ startedAt }) => {
    const at = Date.parse(startedAt);
    return `(timestamp >= "${new Date(at - 70_000).toISOString()}" AND timestamp <= "${new Date(at + 70_000).toISOString()}")`;
  });
  return `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE}" AND resource.labels.location="europe-west1" AND (${[
    'textPayload:"Memory limit of 256 MiB exceeded"', ...windows, ...operations.map(({ id }) => `jsonPayload.releaseOperationId="${id}"`),
  ].join(' OR ')}) AND timestamp >= "2026-11-23T00:00:00Z"`;
}

function summarizeOperations(operations, entries, baselineRevision) {
  const instance = entry => entry.labels?.instanceId;
  const revision = entry => entry.resource?.labels?.revision_name;
  const eventId = entry => entry.labels?.['run.googleapis.com/cloud_event_id'];
  const evidence = entry => ({ insertId: entry.insertId, timestamp: entry.timestamp, logName: entry.logName,
    revision: revision(entry), instance: instance(entry), trace: entry.trace, eventId: eventId(entry),
    status: entry.httpRequest?.status, latency: entry.httpRequest?.latency, message: entry.httpRequest ? undefined : entry.textPayload });
  const terminations = entries.filter(entry => entry.logName?.endsWith('%2Fvarlog%2Fsystem') && /Memory limit of 256 MiB exceeded/.test(entry.textPayload ?? ''));
  const enriched = operations.map(operation => {
    const time = Date.parse(operation.startedAt);
    const direct = entries.filter(entry => entry.jsonPayload?.releaseOperationId === operation.id);
    const admitted = direct.filter(entry => entry.jsonPayload?.releaseOperationState === 'admitted');
    const finished = direct.filter(entry => entry.jsonPayload?.releaseOperationState === 'handler_finished');
    const revisionName = operation.revision ?? (admitted.length === 1 ? revision(admitted[0]) : baselineRevision);
    const overlapping = entries.filter(entry => {
      if (!entry.logName?.endsWith('%2Frequests') || revision(entry) !== revisionName || !instance(entry)) return false;
      const at = Date.parse(entry.timestamp), duration = Number.parseFloat(entry.httpRequest?.latency) * 1000;
      return at >= time - 65_000 && at <= time && (!Number.isFinite(duration) || at + duration >= time - 1200);
    });
    const exact = overlapping.filter(entry => operation.eventId ? eventId(entry) === operation.eventId : admitted.length === 1 && admitted[0].trace && entry.trace === admitted[0].trace);
    const possible = exact.length ? exact : overlapping;
    const candidates = possible.flatMap(request => terminations.filter(termination => revision(termination) === revisionName
      && instance(termination) === instance(request) && Date.parse(termination.timestamp) >= time - 1200
      && Date.parse(termination.timestamp) <= time + 2500).map(termination => ({ request: evidence(request), termination: evidence(termination) })));
    const unique = possible.length === 1 && candidates.length === 1;
    return { ...operation, direct: direct.map(entry => ({ ...evidence(entry), state: entry.jsonPayload.releaseOperationState })),
      disposition: finished.length ? 'handler_finished' : unique ? exact.length ? 'oom_correlated' : 'oom_inferred' : 'unproven',
      overlappingRequests: possible.map(evidence), candidates };
  });
  return { operations: enriched, terminations: terminations.map(evidence) };
}

async function main() {
  const project = c.arg('--project'), file = c.arg('--out');
  const useCalendar = c.flag('--calendar');
  if (project !== PROJECT || !file || c.flag('--execute')) throw new Error(`Usa --project ${PROJECT} --out <informe.json> [--calendar]. Solo lectura.`);
  c.readonlyFirestore();
  const { db, credential } = await c.initialize(project);
  try {
    const recorded = await db.runTransaction(async tx => {
      const [all, active, archive, gate, config] = await Promise.all([
        tx.get(db.collection('appointments').select('status', 'recurrenceSeriesId', 'googleCalendarEventId', 'googleCalendarSyncStatus', 'approvedSlot', 'preferredSlots', 'date', 'time')),
        tx.get(db.collection('release_operations').where('state', '==', 'active')),
        tx.get(db.collection('appointment_deletions').select()),
        tx.get(db.doc('system_controls/release')), tx.get(db.doc('site_config/main')),
      ]);
      const appointments = all.docs.map(d => {
        const data = d.data();
        const status = normalizeAppointmentStatus(data.status) ?? 'unknown';
        const recurring = Boolean(data.recurrenceSeriesId);
        return { id: d.id, status, recurring, visible: status === 'approved' || (status === 'pending' && !recurring),
          eventId: data.googleCalendarEventId || null, syncStatus: data.googleCalendarSyncStatus ?? null,
          slot: resolveAppointmentSlot(data) ?? null, updateTime: [d.updateTime.seconds, d.updateTime.nanoseconds] };
      });
      const operations = active.docs.filter(d => d.get('operation') === FUNCTION).map(d => ({ id: d.id, ...d.data(), updateTime: [d.updateTime.seconds, d.updateTime.nanoseconds] }));
      return { appointments, operations, deletions: new Set(archive.docs.map(d => d.id)), readTime: all.readTime.toDate().toISOString(),
        maintenance: { phase: gate.get('phase'), epoch: gate.get('epoch'), automaticRefunds: config.get('automaticMinuteRefundsEnabled') === true } };
    }, { readOnly: true });
    const fn = (await c.deployedFunctions(credential, project)).find(fn => fn.name.endsWith('/' + FUNCTION));
    if (!fn || !fn.serviceConfig?.revision) throw new Error('La Function no tiene una revisión en producción verificable.');
    const runUrl = `https://run.googleapis.com/v2/${fn.serviceConfig.service}`;
    const [entries, service] = await Promise.all([
      readIncidentLogs(credential, project, { filter: logFilter(recorded.operations) }),
      c.googleGet(credential, runUrl),
    ]);
    const servingRevision = service.latestReadyRevision?.split('/').at(-1);
    if (!servingRevision) throw new Error('Cloud Run no identifica una revisión disponible.');
    const revision = await c.googleGet(credential, `${runUrl}/revisions/${servingRevision}`);
    let calendar = { status: 'not-read', reason: 'Hace falta una identidad autorizada en Calendar y el modo --calendar.' };
    let findings = { missingApproved: inspectCalendar(recorded.appointments, []).missingApproved.map(a => ({ ...a, matches: null })) };
    let calendarError;
    if (useCalendar) {
      try {
        const { GoogleAuth } = c.requireFunctions('google-auth-library');
        const auth = new GoogleAuth({ scopes: [SCOPE] });
        const token = process.env.FOCUS_CALENDAR_READ_TOKEN || await auth.getAccessToken();
        if (!token) throw new Error('No se consiguió autorización de Calendar.');
        const events = await listCalendarEvents(token);
        findings = inspectCalendar(recorded.appointments, events, recorded.deletions);
        calendar = { status: 'read', calendar: CALENDAR, scope: SCOPE, events: events.length, readAt: new Date().toISOString() };
      } catch (error) {
        // Still save log/Firestore evidence, but do not signal success.
        calendarError = error;
        calendar = { status: 'not-read', reason: 'Falló el acceso de solo lectura a Google Calendar.' };
      }
    }
    const report = { schema: 'focus-calendar-audit-v1', projectId: project, firestoreReadTime: recorded.readTime, maintenance: recorded.maintenance,
      runtime: { revision: fn.serviceConfig.revision, servingRevision, memory: revision.containers?.[0]?.resources?.limits?.memory,
        cpu: revision.containers?.[0]?.resources?.limits?.cpu, readyState: service.terminalCondition?.state, readyReason: service.terminalCondition?.message?.split('\n')[0],
        concurrency: revision.maxInstanceRequestConcurrency, maxInstances: fn.serviceConfig.maxInstanceCount ?? null,
        timeoutSeconds: fn.serviceConfig.timeoutSeconds, retry: fn.eventTrigger?.retryPolicy, traffic: service.trafficStatuses },
      firestoreAppointments: recorded.appointments.length, calendar, findings, ...summarizeOperations(recorded.operations, entries, servingRevision) };
    c.writeJson(file, { ...report, reportHash: c.hash(JSON.stringify(report)) });
    if (calendarError) throw new Error(`${calendarError.message} El informe parcial se guardó en ${file}.`);
    console.log(`Informe local: ${file}. Calendar: ${calendar.status}.`);
  } finally { await db.terminate(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspectCalendar, listCalendarEvents, summarizeOperations, CALENDAR, FUNCTION };
