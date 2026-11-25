const { googleGet } = require('./release-common.cjs');
const { TARGETS, remainingArtifacts, assertLocalArtifact } = require('./remaining-selective.cjs');

const REGION = 'europe-west1';
const NUMBER = '1555015411';
const SERVICES = ['run.googleapis.com', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com'];

function quota(result, metric) {
  const buckets = result.metrics?.find(item => item.metric === metric)
    ?.consumerQuotaLimits?.flatMap(limit => limit.quotaBuckets ?? []) ?? [];
  const limit = Number(buckets.find(bucket => bucket.dimensions?.region === REGION)?.effectiveLimit);
  if (result.nextPageToken || !Number.isFinite(limit) || limit <= 0) throw new Error(`Cuota regional no acreditada: ${metric}.`);
  return limit;
}

function utilization(result, now, metric) {
  const values = new Map();
  for (const series of result.timeSeries ?? []) for (const point of series.points ?? []) {
    const time = Date.parse(point.interval.endTime);
    const value = Number(point.value.int64Value ?? point.value.doubleValue);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value < 0) throw new Error(`Lectura inválida de ${metric}.`);
    values.set(time, (values.get(time) ?? 0) + value);
  }
  const latest = Math.max(...values.keys());
  if (result.nextPageToken || !values.size || latest < now - 6 * 60_000) throw new Error(`Faltan métricas recientes de ${metric}.`);
  return { measuredAt: new Date(latest).toISOString(), latest: values.get(latest), peak: Math.max(...values.values()) };
}

async function preflight(credential, project, manifest, fn) {
  const name = fn?.name.split('/').at(-1);
  const artifact = remainingArtifacts(manifest).get(name);
  if (project !== 'focus-club-f73b8' || !artifact) throw new Error('Function o proyecto ajenos a la publicación.');
  assertLocalArtifact(artifact);
  const now = Date.now();
  const read = url => googleGet(credential, url);
  const sample = metric => {
    const params = new URLSearchParams({
      filter: `metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND resource.type="consumer_quota" AND resource.labels.service="run.googleapis.com" AND resource.labels.location="${REGION}" AND metric.labels.quota_metric="run.googleapis.com/${metric}"`,
      'interval.startTime': new Date(now - 6 * 3600_000).toISOString(), 'interval.endTime': new Date(now).toISOString(), view: 'FULL', pageSize: '1000',
    });
    return read(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${params}`).then(result => utilization(result, now, metric));
  };
  const buildFilter = encodeURIComponent('status="WORKING" OR status="QUEUED"');
  const [quotas, builds, cpu, memory, secret] = await Promise.all([
    Promise.all(SERVICES.map(service => read(`https://serviceusage.googleapis.com/v1beta1/projects/${NUMBER}/services/${service}/consumerQuotaMetrics?view=FULL&pageSize=200`))),
    read(`https://cloudbuild.googleapis.com/v1/projects/${project}/locations/${REGION}/builds?filter=${buildFilter}&pageSize=20`),
    sample('cpu_allocation'), sample('mem_allocation'),
    TARGETS[name].trigger ? read(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/BREVO_API_KEY/versions/latest`) : null,
  ]);
  const cpuLimit = Math.min(quota(quotas[0], 'run.googleapis.com/cpu_allocation'), quota(quotas[1], 'cloudfunctions.googleapis.com/cpu_allocation'));
  const memoryLimit = Math.min(quota(quotas[0], 'run.googleapis.com/mem_allocation'), quota(quotas[1], 'cloudfunctions.googleapis.com/mem_allocation'));
  const buildCpu = quota(quotas[2], 'cloudbuild.googleapis.com/concurrent_public_pool_build_cpus');
  const runWrites = quota(quotas[0], 'run.googleapis.com/write_regional');
  const functionWrites = quota(quotas[1], 'cloudfunctions.googleapis.com/v2_write_requests_regional');
  if (builds.nextPageToken || (builds.builds ?? []).length || cpuLimit - cpu.peak < 5000 || memoryLimit - memory.peak < 5 * 512 * 1024 * 1024) {
    throw new Error('Hay un build en curso o falta margen regional para solapar revisiones.');
  }
  if (TARGETS[name].trigger && (secret?.state !== 'ENABLED' || secret.name?.split('/').at(-1) !== '2')) {
    throw new Error('El despliegue cambiaría la referencia al secreto. Mantener el trigger vigente.');
  }
  return { name, config: artifact.config, cpu: { limit: cpuLimit, ...cpu }, memory: { limit: memoryLimit, ...memory }, buildCpu, runWrites, functionWrites };
}

module.exports = preflight;
