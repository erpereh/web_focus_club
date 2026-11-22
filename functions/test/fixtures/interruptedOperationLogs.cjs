const { CASES, REVISION, SERVICE } = require('../../../scripts/interrupted-operations.cjs');

function incidentLogs() {
  const resource = { type: 'cloud_run_revision', labels: { revision_name: REVISION, service_name: SERVICE } };
  const entries = [];
  for (const item of CASES) {
    const labels = { instanceId: 'instance-' + item.terminationId };
    const at = Date.parse(item.startedAt);
    entries.push({
      insertId: item.requestId, logName: 'logs/run.googleapis.com%2Frequests',
      timestamp: new Date(at - 1000).toISOString(), trace: 'projects/test/traces/' + item.eventId,
      httpRequest: { status: 200, latency: '1.1s' }, resource,
      labels: { ...labels, 'run.googleapis.com/cloud_event_id': item.eventId },
    });
    if (!entries.some(entry => entry.insertId === item.terminationId)) {
      entries.push({
        insertId: item.terminationId, logName: 'logs/run.googleapis.com%2Fvarlog%2Fsystem',
        timestamp: new Date(at + 700).toISOString(), resource, labels,
        textPayload: 'Memory limit of 256 MiB exceeded with 259 MiB used.',
      });
    }
  }
  return entries;
}

module.exports = { incidentLogs };
