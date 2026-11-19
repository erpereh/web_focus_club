#!/usr/bin/env node
const c = require('./release-common.cjs');
const { fs, path, root, arg, flag, hash, readJson, writeJson, initialize, googleGet, deployedFunctions, assertManifest } = c;
const { zipFiles } = require('./prepare-coordinated-release.cjs');
const CONTROL = 'system_controls/release', QUEUE = 'system_controls/deferred';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const httpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };

async function verifyFunctions(credential, project, manifest, phase) {
  if (!manifest.bootstrap.captured || manifest.bootstrap.artifacts.some(item => !item.compiled)) throw new Error('Falta capturar y compilar la versión preparatoria real.');
  const functions = await deployedFunctions(credential, project);
  const expected = phase === 'bootstrap'
    ? manifest.bootstrap.artifacts.flatMap((artifact) => artifact.functions.map((name) => ({ name, prefix: path.dirname(artifact.config) + '/functions/', phase: 'bootstrap' })))
    : [...manifest.webFunctions.map((name) => ({ name, prefix: 'functions/', phase: 'final' })),
      { name: 'deleteOwnAccount', prefix: '../app_focus_club/functions/', phase: 'final' }];
  const cachePath = path.join(root, `release/verification-${phase}.json`);
  const cache = fs.existsSync(cachePath) ? readJson(cachePath) : { functions: {} };
  if (cache.manifestHash !== manifest.manifestHash) cache.functions = {};
  for (let start = 0; start < expected.length; start += 5) await Promise.all(expected.slice(start, start + 5).map(async (item) => {
    const fn = functions.find((candidate) => candidate.name.endsWith('/' + item.name));
    if (fn?.state !== 'ACTIVE' || !fn.name.includes('/locations/europe-west1/') || fn.serviceConfig?.allTrafficOnLatestRevision !== true
      || fn.labels?.focus_release !== manifest.releaseId || fn.labels?.focus_phase !== item.phase) throw new Error(`Versión incorrecta, tráfico antiguo o función no activa: ${item.name}`);
    const source = fn.buildConfig?.source?.storageSource;
    const identity = JSON.stringify(source);
    if (cache.functions[item.name] === identity) return;
    if (!source) throw new Error(`No se puede acreditar el código de ${item.name}`);
    const bytes = await googleGet(credential, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, true);
    const files = zipFiles(bytes);
    const inputs = manifest.inputs.filter((input) => input.path.startsWith(item.prefix));
    if (!inputs.length || inputs.some((input) => !files.has(input.path.slice(item.prefix.length)) || hash(files.get(input.path.slice(item.prefix.length))) !== input.sha256)) {
      throw new Error(`El código publicado de ${item.name} no coincide con el artefacto revisado.`);
    }
    cache.functions[item.name] = identity;
  }));
  writeJson(cachePath, { manifestHash: manifest.manifestHash, functions: cache.functions }, false);
  return functions.filter((fn) => expected.some((item) => fn.name.endsWith('/' + item.name)));
}
async function verifyRules(credential, project, expectedFile) {
  const release = await googleGet(credential, `https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
  const ruleset = await googleGet(credential, `https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  const source = ruleset.source.files.find((file) => file.name.endsWith('.rules'))?.content;
  if (source !== fs.readFileSync(expectedFile, 'utf8')) throw new Error('Las reglas publicadas no coinciden con las revisadas.');
}
async function verifyIndexes(credential, project) {
  let pageToken, indexes = [];
  do {
    const result = await googleGet(credential, `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes?pageSize=1000${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
    indexes.push(...(result.indexes ?? [])); pageToken = result.nextPageToken;
  } while (pageToken);
  const definition = (index) => JSON.stringify({ collection: index.collectionGroup ?? index.name.split('/collectionGroups/')[1].split('/')[0],
    scope: index.queryScope, fields: index.fields.filter((field) => field.fieldPath !== '__name__').map(field=>({fieldPath:field.fieldPath,mode:field.order??field.arrayConfig})) });
  const ready = new Set(indexes.filter((index) => index.state === 'READY').map(definition));
  const missing = readJson(path.join(root, 'firestore.indexes.json')).indexes.filter((index) => !ready.has(definition(index)));
  if (missing.length) throw new Error(`${missing.length} índices todavía no están disponibles. Esperar antes de continuar.`);
  for (const field of readJson(path.join(root, 'firestore.indexes.json')).fieldOverrides ?? []) {
    const actual = await googleGet(credential, `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/${encodeURIComponent(field.collectionGroup)}/fields/${encodeURIComponent(field.fieldPath)}`);
    const available = new Set((actual.indexConfig?.indexes ?? []).filter((index) => index.state === 'READY')
      .flatMap((index) => index.fields.filter((item) => item.fieldPath === field.fieldPath)
        .map((item) => `${index.queryScope}:${item.order ?? item.arrayConfig}`)));
    if (field.indexes.some((index) => !available.has(`${index.queryScope}:${index.order ?? index.arrayConfig}`))) {
      throw new Error(`Índice de campo todavía no disponible: ${field.collectionGroup}.${field.fieldPath}.`);
    }
  }
}
async function verifyHosting(credential, project) {
  const result = await googleGet(credential, `https://firebasehosting.googleapis.com/v1beta1/sites/${project}/releases?pageSize=1`);
  if (!result.releases?.[0]?.version?.name) throw new Error('No se ha podido acreditar la publicación de Hosting.');
  // Content verification is performed against the served static files, not a CLI exit code alone.
  for (const route of ['admin/devoluciones', 'portal']) {
    const file = path.join(root, 'out', route + '.html');
    if (!fs.existsSync(file)) throw new Error('Falta la compilación estática de Hosting.');
    const response = await fetch(`https://${project}.web.app/${route}`, { cache: 'no-store' });
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(fs.readFileSync(file))) throw new Error(`Hosting no coincide en /${route}.`);
  }
}
async function verifyFinal(credential, project, manifest) {
  await verifyFunctions(credential, project, manifest, 'final');
  await verifyRules(credential, project, path.join(root, 'firestore.rules'));
  await verifyIndexes(credential, project);
  await verifyHosting(credential, project);
}
async function drain(db, manifest) {
  const gate = (await db.doc(CONTROL).get()).data();
  if (gate?.phase !== 'frozen' || gate.releaseId !== manifest.releaseId) throw new Error('La recuperación exige mantenimiento completamente cerrado.');
  const deadline = Date.now() + 20 * 60_000;
  let processed = 0;
  while (Date.now() < deadline) {
    const pending = await db.collection('release_deferred_events').where('state', '==', 'pending').limit(50).get();
    for (const job of pending.docs) {
      if (job.data().needsReview && !flag('--retry-reviewed')) throw new Error(`El trabajo ${job.id} falló. Revisar su causa antes de usar --retry-reviewed.`);
      await db.runTransaction(async (tx) => {
        const [current, control] = await Promise.all([tx.get(job.ref), tx.get(db.doc(CONTROL))]);
        if (current.data()?.state !== 'pending') return;
        if (control.data()?.phase !== 'frozen' || control.data()?.epoch !== gate.epoch) throw new Error('El mantenimiento cambió.');
        tx.update(job.ref, { state: 'ready', approvedReleaseId: gate.releaseId, approvedEpoch: gate.epoch, requestedAt: new Date().toISOString() });
      });
      processed++;
    }
    const recovering = await db.collection('release_deferred_events').where('state', '==', 'recovering').limit(50).get();
    for (const job of recovering.docs) if (job.data().leaseUntil < new Date().toISOString()) {
      if (!flag('--retry-expired')) throw new Error(`Recuperación interrumpida: ${job.id}. Revisar antes de usar --retry-expired.`);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (current.data()?.state === 'recovering' && current.data()?.leaseUntil < new Date().toISOString()) tx.update(job.ref, { state: 'pending', needsReview: true });
      });
    }
    const summary = (await db.doc(QUEUE).get()).data();
    if (Number(summary?.pending ?? 0) === 0) return { processed, remaining: 0 };
    await sleep(2000);
  }
  throw new Error('La recuperación no ha terminado. Se conserva el trabajo y el mantenimiento permanece cerrado.');
}
async function main() {
  const command = process.argv[2];
  const readOnly = ['status', 'preflight', 'assert-stage', 'verify-bootstrap', 'verify-release', 'verify-before-open', 'verify-indexes'].includes(command);
  const mutations = ['maintenance-close', 'maintenance-open', 'drain-deferred', 'set-minimum-builds', 'enable-automatic-refunds', 'disable-automatic-refunds', 'resolve-completed-operation'];
  if (!readOnly && !mutations.includes(command)) throw new Error('Orden de control no válida.');
  const project = readOnly ? arg('--project') : arg('--confirm-project');
  if (project !== 'focus-club-f73b8') throw new Error('Indica explícitamente el proyecto focus-club-f73b8.');
  const manifest = !['status', 'disable-automatic-refunds'].includes(command) ? readJson(arg('--manifest') ?? path.join(root, 'release/manifest.json')) : undefined;
  if (manifest) assertManifest(manifest);
  const { db, credential } = await initialize(project);
  try {
    const gateRef = db.doc(CONTROL), configRef = db.collection('site_config').doc('main');
    if (command === 'status') {
      const [gate, config, queue, active] = await Promise.all([gateRef.get(), configRef.get(), db.doc(QUEUE).get(), db.collection('release_operations').where('state','==','active').limit(50).get()]);
      console.log(JSON.stringify({ maintenance: gate.data() ?? null, automaticRefunds: config.data()?.automaticMinuteRefundsEnabled === true,
        minimumAndroid: config.data()?.minAndroidBuild, minimumIos: config.data()?.minIosBuild,
        deferred: queue.data()?.pending ?? 0, activeOperations: active.docs.map((snap) => ({ id: snap.id, ...snap.data() })) }, null, 2)); return;
    }
    if (command === 'preflight') {
      if (!manifest.bootstrap.captured || manifest.bootstrap.artifacts.some(item=>!item.compiled)) throw new Error('Falta capturar y compilar la base real de producción.');
      if ((await configRef.get()).data()?.automaticMinuteRefundsEnabled === true) throw new Error('La compensación automática debe estar desactivada antes de publicar.');
      const deployed=await deployedFunctions(credential,project);
      const managed=new Set([...manifest.webFunctions,...manifest.portalFunctions]);
      for(const fn of deployed){
        const name=fn.name.split('/').at(-1);
        if(!managed.has(name))throw new Error(`Función externa sin revisar: ${fn.name}. No asumir que queda bloqueada.`);
        if(managed.has(name)&&!fn.name.includes('/locations/europe-west1/'))throw new Error(`Endpoint de otra región sin revisar: ${fn.name}`);
      }
      for(const artifact of manifest.bootstrap.artifacts)for(const before of artifact.sourceVersions){
        const current=deployed.find(fn=>fn.name===before.name);
        if(!current || (JSON.stringify(current.buildConfig?.source?.storageSource)!==JSON.stringify(before.source)
          && current.labels?.focus_release!==manifest.releaseId))throw new Error(`La versión de producción ha cambiado desde la captura: ${before.name}`);
      }
      console.log('Manifiesto y base de producción acreditados. Ninguna escritura remota.'); return;
    }
    if(command==='assert-stage'){
      const stage=arg('--stage'),gate=(await gateRef.get()).data(),config=(await configRef.get()).data();
      if(config?.automaticMinuteRefundsEnabled===true)throw new Error('Las devoluciones automáticas deben seguir desactivadas.');
      if(stage==='Bootstrap'){
        if(gate?.occupancyVersion===2 || (gate?.phase && gate.phase!=='open'))throw new Error('No repetir el bootstrap sobre una publicación definitiva o un mantenimiento cerrado.');
      }else{
        if(gate?.phase!=='frozen'||gate?.releaseId!==manifest.releaseId)throw new Error('Esta etapa exige mantenimiento congelado.');
        if(['Hosting','Rules'].includes(stage))await verifyFunctions(credential,project,manifest,'final');
        if(stage==='Rules')await verifyHosting(credential,project);
        if(!['Functions','Hosting','Rules'].includes(stage))throw new Error('Etapa no válida.');
      }
      console.log('Etapa autorizada por el estado de la publicación.');return;
    }
    if (command === 'verify-indexes') { await verifyIndexes(credential, project); console.log('Índices disponibles.'); return; }
    if (command === 'verify-bootstrap') {
      await verifyFunctions(credential, project, manifest, 'bootstrap');
      await verifyRules(credential, project, path.join(root, 'release/bootstrap/firestore.rules'));
      console.log('Bloqueo preparatorio publicado y acreditado.'); return;
    }
    if (command === 'maintenance-close') {
      // Accept the preparatory or the final release when closing again after launch.
      const current = (await gateRef.get()).data();
      if (current?.occupancyVersion === 2) {
        await verifyFunctions(credential, project, manifest, 'final');
        await verifyRules(credential, project, path.join(root, 'firestore.rules'));
      }
      else {
        const functions = await verifyFunctions(credential, project, manifest, 'bootstrap');
        await verifyRules(credential, project, path.join(root, 'release/bootstrap/firestore.rules'));
        if (!current?.phase || current.phase === 'open') {
          const settleUntil = Math.max(...functions.map((fn) => Date.parse(fn.updateTime) + (Number(fn.serviceConfig?.timeoutSeconds ?? 60) + 30) * 1000));
          if (!Number.isFinite(settleUntil) || Date.now() < settleUntil) throw new Error('Esperar el timeout máximo de las revisiones anteriores más 30 segundos después del último bootstrap, y comprobar que ya no ejecutan trabajo.');
          if (!flag('--legacy-executions-reviewed')) throw new Error('Revisa en Cloud Logging que las revisiones anteriores terminaron y confirma --legacy-executions-reviewed. Las ejecuciones anteriores al bootstrap no tienen concesión.');
        }
      }
      await db.runTransaction(async (tx) => {
        const [gate, config] = await Promise.all([tx.get(gateRef), tx.get(configRef)]);
        if (config.data()?.automaticMinuteRefundsEnabled === true) throw new Error('Desactiva expresamente las devoluciones automáticas antes de cerrar.');
        if (gate.data()?.phase && gate.data().phase !== 'open') {
          if (gate.data().releaseId !== manifest.releaseId) throw new Error('Hay otra publicación en curso.');
          return;
        }
        tx.set(gateRef, { ...gate.data(), phase: 'draining', releaseId: manifest.releaseId, epoch: Number(gate.data()?.epoch ?? 0) + 1,
          occupancyVerifiedEpoch: null, occupancyAuditHash: null, manifestHash: manifest.manifestHash, closedAt: new Date().toISOString() });
        tx.set(configRef, { maintenanceMode: true }, { merge: true });
        tx.create(db.collection('release_control_audits').doc(),{command:'maintenance-close',releaseId:manifest.releaseId,manifestHash:manifest.manifestHash,at:new Date().toISOString()});
      });
      const deadline = Date.now() + 15 * 60_000;
      while (true) {
        const active = await db.collection('release_operations').where('state','==','active').limit(1).get();
        if (active.empty) break;
        if (!flag('--wait') || Date.now() > deadline) throw new Error('Quedan operaciones admitidas. No se presume que hayan terminado. Mantener cerrado y revisar status.');
        await sleep(2000);
      }
      await db.runTransaction(async (tx) => {
        const [gate, active] = await Promise.all([tx.get(gateRef), tx.get(db.collection('release_operations').where('state','==','active').limit(1))]);
        if (gate.data()?.releaseId !== manifest.releaseId || gate.data()?.phase === 'open' || !active.empty) throw new Error('No se puede congelar el mantenimiento.');
        tx.set(gateRef, { phase: 'frozen', frozenAt: new Date().toISOString() }, { merge: true });
      });
      console.log('Mantenimiento congelado. No hay operaciones admitidas en ejecución.'); return;
    }
    if(command==='resolve-completed-operation'){
      const id=arg('--operation-id');
      if(!/^[0-9a-f-]{36}$/.test(id??''))throw new Error('Indica el identificador exacto de la operación.');
      const token=await credential.getAccessToken();
      // Logging entries:list is a read operation; no execution is stopped or assumed expired.
      const response=await fetch('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({resourceNames:[`projects/${project}`],filter:`jsonPayload.releaseOperationId="${id}" AND jsonPayload.releaseOperationState="handler_finished"`,pageSize:1,orderBy:'timestamp desc'})});
      if(!response.ok)throw new Error('No se ha podido verificar el registro de finalización del servidor.');
      const entry=(await response.json()).entries?.[0];
      if(!entry?.insertId)throw new Error('No existe prueba de finalización. No se elimina la concesión por tiempo transcurrido.');
      await db.runTransaction(async tx=>{
        const ref=db.collection('release_operations').doc(id);
        const [gate,operation]=await Promise.all([tx.get(gateRef),tx.get(ref)]);
        if(gate.data()?.phase!=='draining'||!operation.exists||Date.parse(operation.data()?.startedAt)>Date.parse(entry.timestamp))throw new Error('Operación o mantenimiento no válidos.');
        tx.create(db.collection('release_control_audits').doc(),{command,operationId:id,evidenceLogInsertId:entry.insertId,evidenceTimestamp:entry.timestamp,at:new Date().toISOString()});
        tx.delete(ref);
      });
      console.log('Concesión cerrada con prueba de finalización. Repetir maintenance-close --wait.');return;
    }
    if (command === 'verify-release') { await verifyFinal(credential, project, manifest); console.log('Functions, Hosting, reglas e índices acreditados.'); return; }
    if (command === 'drain-deferred') { await verifyFunctions(credential, project, manifest, 'final'); console.log(await drain(db, manifest)); return; }
    if (['verify-before-open', 'maintenance-open'].includes(command)) {
      await verifyFinal(credential, project, manifest);
      await db.runTransaction(async (tx) => {
        const [gate, config, queue, active] = await Promise.all([tx.get(gateRef), tx.get(configRef), tx.get(db.doc(QUEUE)), tx.get(db.collection('release_operations').where('state','==','active').limit(1))]);
        if (gate.data()?.phase !== 'frozen' || gate.data()?.releaseId !== manifest.releaseId || gate.data()?.occupancyVersion !== 2 || !gate.data()?.occupancyAuditHash || gate.data()?.occupancyVerifiedEpoch !== gate.data()?.epoch
          || Number(queue.data()?.pending ?? 0) !== 0 || !active.empty || config.data()?.automaticMinuteRefundsEnabled === true) throw new Error('No se cumplen las condiciones de reapertura. Mantener cerrado.');
        if (command === 'maintenance-open') {
          tx.set(gateRef, { phase: 'open', openedAt: new Date().toISOString() }, { merge: true });
          tx.set(configRef, { maintenanceMode: false }, { merge: true });
          tx.create(db.collection('release_control_audits').doc(),{command:'maintenance-open',releaseId:manifest.releaseId,manifestHash:manifest.manifestHash,at:new Date().toISOString()});
        }
      });
      console.log(command === 'maintenance-open' ? 'Operaciones reabiertas. Devoluciones automáticas desactivadas.' : 'Condiciones de reapertura comprobadas.'); return;
    }
    if (command === 'set-minimum-builds') {
      if (!flag('--stores-verified')) throw new Error('Verifica ambas tiendas e indica --stores-verified.');
      const android = Number(arg('--android-build')), ios = Number(arg('--ios-build'));
      if (android !== manifest.mobile.build || ios !== manifest.mobile.build) throw new Error('Los mínimos deben coincidir con el build común revisado.');
      await db.runTransaction(async (tx) => {
        const [gate, config] = await Promise.all([tx.get(gateRef), tx.get(configRef)]);
        if (gate.data()?.phase !== 'open' || gate.data()?.occupancyVersion !== 2 || !httpsUrl(config.data()?.androidStoreUrl) || !httpsUrl(config.data()?.iosStoreUrl)
          || android < Number(config.data()?.minAndroidBuild ?? 0) || ios < Number(config.data()?.minIosBuild ?? 0)) throw new Error('Mantenimiento, URLs o mínimos anteriores incompatibles.');
        tx.set(configRef, { minAndroidBuild: android, minIosBuild: ios }, { merge: true });
        tx.set(gateRef, { storesVerifiedBuild: android, storesVerifiedAt: new Date().toISOString() }, { merge: true });
        tx.create(db.collection('release_control_audits').doc(),{command,build:android,releaseId:manifest.releaseId,manifestHash:manifest.manifestHash,at:new Date().toISOString()});
      });
    } else if (command === 'enable-automatic-refunds') {
      await verifyFinal(credential, project, manifest);
      await db.runTransaction(async (tx) => {
        const [gate, config] = await Promise.all([tx.get(gateRef), tx.get(configRef)]);
        if (gate.data()?.phase !== 'open' || gate.data()?.occupancyVersion !== 2 || gate.data()?.storesVerifiedBuild !== manifest.mobile.build
          || config.data()?.minAndroidBuild < manifest.mobile.build || config.data()?.minIosBuild < manifest.mobile.build
          || !httpsUrl(config.data()?.androidStoreUrl) || !httpsUrl(config.data()?.iosStoreUrl)) throw new Error('Falta verificar ambas apps y la actualización obligatoria.');
        tx.set(configRef, { automaticMinuteRefundsEnabled: true }, { merge: true });
        tx.create(db.collection('release_control_audits').doc(),{command,releaseId:manifest.releaseId,manifestHash:manifest.manifestHash,at:new Date().toISOString()});
      });
    } else if (command === 'disable-automatic-refunds') await db.runTransaction(async tx=>{
      await tx.get(configRef);
      tx.set(configRef,{automaticMinuteRefundsEnabled:false},{merge:true});
      tx.create(db.collection('release_control_audits').doc(),{command,at:new Date().toISOString()});
    });
    console.log('Cambio explícito de configuración confirmado y auditado. No se han modificado saldos.');
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyFunctions, verifyIndexes, verifyHosting, verifyRules, drain, main };
