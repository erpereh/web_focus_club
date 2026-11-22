const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (!host || !projectId.startsWith('demo-')) throw new Error('EMULATOR ONLY: demo-* project and FIRESTORE_EMULATOR_HOST required.');
initializeApp({ projectId });
const db = getFirestore();
const { createCustomerBookingHandlers } = require('../../lib/customerBooking.js');
const { createAdminAppointmentStatusHandlers } = require('../../lib/adminAppointmentStatus.js');
const { createAdminAppointmentCreateHandlers } = require('../../lib/adminAppointmentCreate.js');
const { runAppointmentTransaction } = require('../../lib/appointmentTransaction.js');
const { guardCallable, guardBackground, createReleaseRecoveryHandler } = require('../../lib/releaseMaintenance.js');
const { auditSlotOccupancy, applyReviewedSlotOccupancyAudit, verifySlotOccupancyAudit } = require('../../lib/slotOccupancyAudit.js');
const { getMadridDateKey } = require('../../lib/appointmentLifecycle.js');
const { CASES, auditInterruptedOperations, resolveInterruptedOperations, FUNCTION_NAME } = require('../../../scripts/interrupted-operations.cjs');
const { freezeMaintenance } = require('../../../scripts/release-controls.cjs');
const { hash } = require('../../../scripts/release-common.cjs');
const { incidentLogs } = require('../fixtures/interruptedOperationLogs.cjs');
const DAY = getMadridDateKey(new Date(Date.now() + 10 * 86400000));
const request = (uid, data) => ({ auth: { uid, token: { email_verified: true, email: `${uid}@example.com` } }, data });
const booking = createCustomerBookingHandlers({ db, getNowDate: () => new Date() });
const admin = createAdminAppointmentStatusHandlers({ db, requireAdmin: async () => {}, getNowDate: () => new Date() });
const creator = createAdminAppointmentCreateHandlers({ db, requireAdmin: async () => {}, getNowDate: () => new Date() });
const read = async (path) => (await db.doc(path).get()).data();
const seats = async (time) => (await read(`slot_occupancy/${DAY}_${time}`))?.count ?? 0;
const book = (uid, time='10:00', duration='60') => booking.createAppointment(request(uid, { duration, preferredSlot: { date: DAY, time }, reason: '' }));
async function seed(documents) { const batch = db.batch(); for (const [path,data] of Object.entries(documents)) batch.set(db.doc(path),data); await batch.commit(); }
async function reset() {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(response.ok);
  await seed({
    'system_controls/release': { phase: 'open', releaseId: 'test-release', epoch: 1, occupancyVersion: 2, occupancyVerifiedEpoch:1, occupancyAuditHash:'initial' },
    'site_config/main': { startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 2, automaticMinuteRefundsEnabled: false },
    'users/admin': { role: 'admin', name: 'Admin', email: 'admin@example.com' },
    'services/training': { title: 'Entrenamiento', active: true },
    'trainers/t': { uid: 't', name: 'Trainer', active: true },
    ...Object.fromEntries(['u1','u2','u3'].flatMap((uid) => [
      [`users/${uid}`, { role:'user', name:uid, email:`${uid}@example.com` }],
      [`bonos/${uid}`, { userId:uid, estado:'activo', tamano:600, minutosTotales:600, minutosRestantes:600, fechaExpiracion:'2099-12-31', historial:[] }],
    ])),
  });
}
test.beforeEach(reset);
test.after(async () => db.terminate());

const incidentManifest = { projectId, releaseId: 'occupancy-v2-refunds-20261118', manifestHash: 'new-reviewed-manifest' };
async function seedIncident() {
  const writes = {
    'system_controls/release': { phase: 'draining', releaseId: incidentManifest.releaseId, epoch: 1,
      closedAt: '2026-11-22T21:10:05.322Z', manifestHash: 'old-reviewed-manifest' },
    'system_controls/deferred': { pending: 2 },
    'site_config/main': { maintenanceMode: true, automaticMinuteRefundsEnabled: false },
    'appointments/unchanged': { userId: 'u1', status: 'approved' },
  };
  for (const item of CASES) {
    writes['release_operations/' + item.id] = { operation: FUNCTION_NAME, state: 'active', releaseId: 'bootstrap', startedAt: item.startedAt };
    if (item.notice !== 'complete') continue;
    const key = 'appt:' + item.eventId;
    const id = hash(key);
    writes['notification_deliveries/' + id] = { uid: 'u1', dedupeKey: key, status: 'complete',
      channels: { history: { status: 'sent' }, email: { status: 'sent' }, push: { status: 'sent' } } };
    writes['email_dispatches/' + hash(key + ':email')] = { status: 'sent', messageId: '<sent-fixture>' };
    writes['push_dispatches/' + hash(key + ':push')] = { status: 'sent' };
    writes['users/u1/notifications/' + id] = { type: 'appointment_status' };
  }
  await seed(writes);
  return Object.keys(writes).filter(key => key !== 'system_controls/release' && !key.startsWith('release_operations/'));
}
const readIncidentLogs = async () => incidentLogs();
const approveIncident = report => ({
  approvedHash: report.reportHash, reviewerUid: 'admin', acknowledged: true,
  readLogs: readIncidentLogs, verifyBootstrap: async () => {},
});

test('incident resolution preserves deliveries and finances, closes atomically, and permits freezing', async () => {
  const preservedPaths = [...await seedIncident(), 'bonos/u1'];
  const before = await db.getAll(...preservedPaths.map(key => db.doc(key)));
  await assert.rejects(freezeMaintenance(db, incidentManifest.releaseId), /congelar/);
  const report = await auditInterruptedOperations(db, incidentManifest, readIncidentLogs);
  assert.deepEqual([report.completeNotices, report.followUpNotices], [7, 2]);
  const results = await Promise.all([1, 2].map(() => resolveInterruptedOperations(db, incidentManifest, report, approveIncident(report))));
  assert.deepEqual(results.map(result => result.alreadyResolved).sort(), [false, true]);
  assert.equal((await db.collection('release_operations').where('state', '==', 'active').get()).size, 0);
  assert.equal((await db.collection('release_operations').where('state', '==', 'interrupted').get()).size, 9);
  const receipts = await db.collection('release_control_audits').where('reportHash', '==', report.reportHash).get();
  assert.equal(receipts.size, 9);
  assert.ok(receipts.docs.every(receipt => receipt.get('replayed') === false && receipt.get('reviewerUid') === 'admin'));
  assert.equal(receipts.docs.filter(receipt => receipt.get('evidence.notice') === 'follow_up').length, 2);
  await freezeMaintenance(db, incidentManifest.releaseId);
  assert.equal((await read('system_controls/release')).phase, 'frozen');
  assert.equal((await resolveInterruptedOperations(db, incidentManifest, report, approveIncident(report))).alreadyResolved, true);
  const after = await db.getAll(...preservedPaths.map(key => db.doc(key)));
  assert.deepEqual(after.map(snap => snap.updateTime), before.map(snap => snap.updateTime));
  const callable = guardCallable(db, 'createAppointment', () => { throw new Error('Must remain locked'); });
  await assert.rejects(callable({}), error => error.details?.reason === 'maintenance');
});

test('stale incident evidence never retires a subset or writes receipts', async () => {
  await seedIncident();
  const report = await auditInterruptedOperations(db, incidentManifest, readIncidentLogs);
  await db.doc('email_dispatches/' + hash('appt:' + CASES[0].eventId + ':email')).update({ note: 'evidence changed' });
  await assert.rejects(resolveInterruptedOperations(db, incidentManifest, report, approveIncident(report)), /evidencia cambió/);
  assert.equal((await db.collection('release_operations').where('state', '==', 'active').get()).size, 9);
  assert.equal((await db.collection('release_control_audits').get()).size, 0);
  await assert.rejects(resolveInterruptedOperations(db, incidentManifest, { ...report, followUpNotices: 0 }, approveIncident(report)), /informe íntegro/);
  await assert.rejects(resolveInterruptedOperations(db, incidentManifest, report, { ...approveIncident(report), reviewerUid: 'u1' }), /administrador/);
});

test('an unrelated active operation or a new ambiguous delivery blocks incident resolution', async () => {
  await seedIncident();
  const report = await auditInterruptedOperations(db, incidentManifest, readIncidentLogs);
  await db.doc('release_operations/unrelated').set({ state: 'active', operation: 'other' });
  await assert.rejects(resolveInterruptedOperations(db, incidentManifest, report, approveIncident(report)), /conjunto/);
  await db.doc('release_operations/unrelated').delete();
  const unresolved = CASES.find(item => item.notice === 'follow_up');
  await db.doc('notification_deliveries/' + hash('appt:' + unresolved.eventId)).set({ status: 'pending' });
  await assert.rejects(resolveInterruptedOperations(db, incidentManifest, report, approveIncident(report)), /Apareció evidencia/);
  assert.equal((await db.collection('release_control_audits').get()).size, 0);
});

test('new background admissions record enough identity to correlate a terminated instance', async () => {
  const previousRevision = process.env.K_REVISION;
  process.env.K_REVISION = 'reviewed-cloud-run-revision';
  try {
    const handler = guardBackground(db, FUNCTION_NAME, async () => {
      const active = await db.collection('release_operations').where('state', '==', 'active').get();
      assert.equal(active.size, 1);
      assert.equal(active.docs[0].get('eventId'), 'stable-cloud-event');
      assert.equal(active.docs[0].get('eventKey'), hash(FUNCTION_NAME + ':stable-cloud-event'));
      assert.equal(active.docs[0].get('revision'), 'reviewed-cloud-run-revision');
    });
    await handler({ id: 'stable-cloud-event' });
    assert.equal((await db.collection('release_operations').get()).size, 0);
  } finally {
    if (previousRevision === undefined) delete process.env.K_REVISION;
    else process.env.K_REVISION = previousRevision;
  }
});

test('reopening verification can run with the read-only protection and leaves the gate frozen', async () => {
  await seed({
    'system_controls/release': { phase: 'frozen', releaseId: 'test-release', epoch: 1,
      occupancyVersion: 2, occupancyVerifiedEpoch: 1, occupancyAuditHash: 'verified-audit' },
    'system_controls/deferred': { pending: 0 },
  });
  const commonPath = require.resolve('../../../scripts/release-common.cjs');
  const controlsPath = require.resolve('../../../scripts/release-controls.cjs');
  const source = `
    const assert = require('node:assert/strict');
    const common = require(${JSON.stringify(commonPath)});
    const { assertReopenState } = require(${JSON.stringify(controlsPath)});
    common.readonlyFirestore();
    (async () => {
      const { db } = await common.initialize(${JSON.stringify(projectId)});
      try {
        await db.runTransaction(tx => assertReopenState(tx, db, { releaseId: 'test-release' }), { readOnly: true });
        assert.throws(() => db.runTransaction(async () => {}), /requires readOnly/);
        await assert.rejects(db.runTransaction(async tx => tx.set(db.doc('system_controls/release'), { phase: 'open' }), { readOnly: true }), /Read-only/);
      } finally { await db.terminate(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });`;
  await promisify(execFile)(process.execPath, ['-e', source], { timeout: 20_000 });
  assert.equal((await read('system_controls/release')).phase, 'frozen');
});

test('legacy mobile payload creates a pending seat; approval and retries keep exactly that seat', async () => {
  const legacy = guardCallable(db, 'createAppointment', booking.createAppointment);
  const {appointmentId} = await legacy(request('u1',{duration:'45',preferredSlot:{date:DAY,time:'10:00'},reason:''}));
  assert.equal(await seats('10:00'),1); assert.equal(await seats('10:15'),1); assert.equal(await seats('10:30'),1); assert.equal(await seats('10:45'),0);
  const approve = () => admin.updateAppointmentStatusFromAdmin(request('admin',{appointmentId,status:'approved',expectedStatus:'pending'}));
  const results = await Promise.all([approve(),approve()]);
  assert.deepEqual(results.map((result)=>result.changed).sort(),[false,true]);
  assert.equal(await seats('10:00'),1); assert.equal((await read('bonos/u1')).minutosRestantes,555);
  assert.equal((await db.collection('release_operations').get()).size,0);
});

test('two pending bookings racing for the last special-date seat cannot both commit', async () => {
  await db.doc(`capacity_exceptions/${DAY}`).set({date:DAY,maxCapacity:1});
  const results = await Promise.allSettled([book('u1','10:00','60'),book('u2','10:30','45')]);
  assert.equal(results.filter((item)=>item.status==='fulfilled').length,1);
  assert.equal(results.find((item)=>item.status==='rejected').reason.details.reason,'slot_full');
  assert.equal(await seats('10:30'),1);
  const remaining = ['u1','u2'].map(async uid=>(await read(`bonos/${uid}`)).minutosRestantes);
  assert.equal((await Promise.all(remaining)).filter(n=>n===600).length,1,'the rejected booking debits nothing');
});

test('pending rejection racing deletion releases once and refunds once with flag off', async () => {
  const {appointmentId} = await book('u1');
  await Promise.allSettled([
    admin.updateAppointmentStatusFromAdmin(request('admin',{appointmentId,status:'rejected',expectedStatus:'pending'})),
    admin.deleteAppointmentsFromAdmin(request('admin',{appointmentIds:[appointmentId]})),
  ]);
  assert.equal(await seats('10:00'),0); assert.equal(await seats('10:45'),0);
  assert.equal((await read('bonos/u1')).minutosRestantes,600);
  const refunds=await db.collection('minute_refunds').get();
  assert.equal(refunds.size,1); assert.equal(refunds.docs[0].data().creditedMinutes,60);
});

test('charged cancellation releases a pending seat and never returns its minutes', async () => {
  const {appointmentId}=await book('u1');
  const data={appointmentId,status:'cancelled',expectedStatus:'pending',cancellationCharge:'charged'};
  await admin.updateAppointmentStatusFromAdmin(request('admin',data));
  await admin.updateAppointmentStatusFromAdmin(request('admin',data));
  assert.equal(await seats('10:00'),0); assert.equal((await read('bonos/u1')).minutosRestantes,540);
  assert.equal((await db.collection('minute_refunds').get()).size,0);
});

test('moving pending preserves shared blocks and rolls back completely if a new block is full', async () => {
  const {appointmentId}=await book('u1');
  const ref=db.doc(`appointments/${appointmentId}`);
  await runAppointmentTransaction(db,async tx=>tx.set(ref,{preferredSlots:[{date:DAY,time:'10:30'}],date:DAY,time:'10:30'},{merge:true}));
  assert.equal(await seats('10:00'),0); assert.equal(await seats('10:15'),0);
  for(const time of ['10:30','10:45','11:00','11:15'])assert.equal(await seats(time),1);
  await db.doc(`capacity_exceptions/${DAY}`).set({date:DAY,maxCapacity:1});
  await book('u2','12:00','30');
  await assert.rejects(runAppointmentTransaction(db,async tx=>tx.set(ref,{preferredSlots:[{date:DAY,time:'12:00'}]},{merge:true})),e=>e.details.reason==='slot_full');
  assert.equal((await read(ref.path)).preferredSlots[0].time,'10:30'); assert.equal(await seats('10:30'),1);
});

test('capacity reductions grandfather existing pending appointments without cancelling or adding a seat', async () => {
  const first=await book('u1'), second=await book('u2');
  await db.doc(`capacity_exceptions/${DAY}`).set({date:DAY,maxCapacity:1});
  for(const item of [first,second]) await admin.updateAppointmentStatusFromAdmin(request('admin',{appointmentId:item.appointmentId,status:'approved',expectedStatus:'pending'}));
  assert.equal(await seats('10:00'),2);
  await assert.rejects(book('u3'),e=>e.details.reason==='slot_full');
});

test('admin can add a seat over capacity only after acknowledging the exact restrictions', async () => {
  await book('u1'); await db.doc(`capacity_exceptions/${DAY}`).set({date:DAY,maxCapacity:1});
  const data={requestId:'00000000-0000-4000-8000-000000000001',userId:'u2',serviceType:'Entrenamiento',durationMinutes:30,date:DAY,time:'10:00',status:'approved',assignedTrainer:'t',comment:''};
  let refusal;
  try{await creator.createAppointmentFromAdmin(request('admin',data));}catch(error){refusal=error;}
  assert.equal(refusal?.details?.reason,'admin_override_required'); assert.equal(await seats('10:00'),1);
  await creator.createAppointmentFromAdmin(request('admin',{...data,acknowledgedRestrictions:refusal.details.fingerprint}));
  assert.equal(await seats('10:00'),2);
  const logs=await db.collection('activity_logs').where('action','==','appointment_created_by_admin').get();
  assert.equal(logs.size,1); assert.ok(logs.docs[0].data().adminOverride || logs.docs[0].data().overriddenRestrictions || (await db.collection('appointments').where('userId','==','u2').get()).docs[0].data().adminOverride);
});

test('server maintenance rejects legacy calls and aborts an admitted transaction when it closes', async () => {
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}), barrier=new Promise(resolve=>{release=resolve;});
  const operation=guardCallable(db,'createAppointment',async()=>{
    entered(); await barrier;
    return runAppointmentTransaction(db,async tx=>{
      await tx.get(db.doc('bonos/u1')); tx.set(db.doc('bonos/u1'),{minutosRestantes:0},{merge:true});
    });
  });
  const outcome=operation(request('u1',{})).then(()=>null,error=>error);
  await started;
  await db.doc('system_controls/release').set({phase:'draining'},{merge:true}); release();
  assert.equal((await outcome).details.reason,'maintenance'); assert.equal((await read('bonos/u1')).minutosRestantes,600);
  assert.equal((await db.collection('release_operations').get()).size,0);
  const oldCall=guardCallable(db,'createAppointment',booking.createAppointment);
  await assert.rejects(oldCall(request('u1',{duration:'30',preferredSlot:{date:DAY,time:'13:00'}})),error=>error.code==='unavailable');
});

test('the actual portal deleteOwnAccount entrypoint also rejects requests while frozen', async () => {
  await db.doc('system_controls/release').set({phase:'frozen'},{merge:true});
  const path=require('node:path'),{createRequire}=require('node:module');
  const portalRequire=createRequire(path.resolve(__dirname,'../../../../app_focus_club/functions/package.json'));
  const entry=portalRequire('./lib/index.js');
  try {
    await assert.rejects(entry.deleteOwnAccount.run(request('u1',{})),error=>error.code==='unavailable');
    assert.equal((await read('users/u1')).name,'u1');
    assert.equal((await read('bonos/u1')).minutosRestantes,600);
  } finally { await portalRequire('firebase-admin/firestore').getFirestore().terminate(); }
});

test('an admitted background event aborted by closing maintenance is saved before acknowledgement', async () => {
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),barrier=new Promise(resolve=>{release=resolve;});
  const target=guardBackground(db,'testFinance',async()=>{
    entered();await barrier;
    await runAppointmentTransaction(db,async tx=>{
      await tx.get(db.doc('bonos/u1'));tx.set(db.doc('bonos/u1'),{minutosRestantes:0},{merge:true});
    });
  });
  const running=target({id:'closing-race',params:{}});
  await started;await db.doc('system_controls/release').set({phase:'draining'},{merge:true});release();await running;
  assert.equal((await read('bonos/u1')).minutosRestantes,600);
  assert.equal((await db.collection('release_deferred_events').get()).size,1);
  assert.equal((await read('system_controls/deferred')).pending,1);
  assert.equal((await db.collection('release_operations').get()).size,0);
});

test('a verification from a previous maintenance epoch cannot authorize old app calls', async()=>{
  await db.doc('system_controls/release').set({phase:'open',epoch:2,occupancyVerifiedEpoch:1},{merge:true});
  const target=guardCallable(db,'createAppointment',booking.createAppointment);
  await assert.rejects(target(request('u1',{duration:'30',preferredSlot:{date:DAY,time:'10:00'}})),error=>error.details.reason==='occupancy_not_ready');
  assert.equal((await read('bonos/u1')).minutosRestantes,600);
  assert.equal((await db.collection('appointments').get()).size,0);
});

test('paused events are durable, deduplicated and recovered exactly once by the server dispatcher', async () => {
  await db.doc('system_controls/release').set({phase:'frozen'},{merge:true});
  let executions=0;
  const target=guardBackground(db,'testFinance',async()=>{
    executions++;
    await runAppointmentTransaction(db,async tx=>{
      const ref=db.doc('test_effects/event'); const previous=await tx.get(ref); if(!previous.exists)tx.create(ref,{applied:true});
    });
  });
  const event={id:'event-1',params:{}};
  await Promise.all([target(event),target(event)]);
  assert.equal(executions,0); assert.equal((await read('system_controls/deferred')).pending,1);
  const job=(await db.collection('release_deferred_events').get()).docs[0];
  await job.ref.update({state:'ready',approvedReleaseId:'test-release',approvedEpoch:1});
  const recover=createReleaseRecoveryHandler(db,()=>({testFinance:{run:target}}));
  await Promise.all([recover({params:{jobId:job.id}}),recover({params:{jobId:job.id}})]);
  assert.equal(executions,1); assert.equal((await read('system_controls/deferred')).pending,0);
  assert.equal((await job.ref.get()).data().state,'completed');
});

test('failed recovery keeps its job, debt signal and review requirement for an explicit retry', async () => {
  await db.doc('system_controls/release').set({phase:'frozen'},{merge:true});
  const target=guardBackground(db,'testFinance',async()=>{throw new Error('simulated outage');});
  await target({id:'failure',params:{}});
  const job=(await db.collection('release_deferred_events').get()).docs[0];
  await job.ref.update({state:'ready',approvedReleaseId:'test-release',approvedEpoch:1});
  const recover=createReleaseRecoveryHandler(db,()=>({testFinance:{run:target}}));
  await assert.rejects(recover({params:{jobId:job.id}}),/simulated outage/);
  assert.equal((await job.ref.get()).data().state,'pending'); assert.equal((await job.ref.get()).data().needsReview,true);
  assert.equal((await read('system_controls/deferred')).pending,1); assert.equal((await read('system_controls/release')).phase,'frozen');
});

test('history/consumption events do not queue reconciliation work or create operation leases', async()=>{
  await db.doc('system_controls/release').set({phase:'frozen'},{merge:true});
  const wrap=data=>({exists:true,data:()=>data});let executions=0;
  const target=guardBackground(db,'onBonoRefundDestinationChanged',async()=>executions++);
  await target({id:'consume',data:{before:wrap({userId:'u1',estado:'activo',minutosRestantes:600}),after:wrap({userId:'u1',estado:'activo',minutosRestantes:540})}});
  assert.equal(executions,0);assert.equal((await db.collection('release_deferred_events').get()).size,0);assert.equal((await db.collection('release_operations').get()).size,0);
});

test('occupancy audit includes legacy pending shapes, preserves overbooking, and replays without changes',async()=>{
  await seed({'system_controls/release':{phase:'frozen',releaseId:'test-release',epoch:1,occupancyVersion:1},
    'appointments/legacy':{userId:'u1',status:'pending',duration:'45',preferredSlots:[{date:DAY,time:'10:00'}],approvedSlot:{date:DAY,time:'18:00'}},
    [`capacity_exceptions/${DAY}`]:{date:DAY,maxCapacity:1}});
  // Add a second active appointment with the legacy top-level slot shape.
  await db.doc('appointments/approved').set({userId:'u2',status:'approved',duration:'60',date:DAY,time:'10:00'});
  const report=await auditSlotOccupancy(db,projectId);
  assert.equal(report.issues.length,0);assert.ok(report.overCapacity.length);assert.equal(await seats('10:00'),0);
  const options={confirmProject:projectId,approvedReportHash:report.reportHash,reviewerUid:'admin'};
  await assert.rejects(applyReviewedSlotOccupancyAudit(db,report,{...options,approvedReportHash:'wrong'}));
  await applyReviewedSlotOccupancyAudit(db,report,options);assert.equal(await seats('10:00'),2);assert.equal(await seats('18:00'),0);
  const replay=await applyReviewedSlotOccupancyAudit(db,report,options);assert.equal(replay.replayed,1);
  await verifySlotOccupancyAudit(db,report);assert.equal((await read('system_controls/release')).occupancyVersion,2);
  assert.equal((await read('appointments/legacy')).status,'pending');
});

test('audit application aborts on changed evidence and cannot mark a failed reconciliation ready',async()=>{
  await db.doc('system_controls/release').set({phase:'frozen',occupancyVersion:1},{merge:true});
  await db.doc('appointments/legacy').set({status:'pending',duration:'30',date:DAY,time:'10:00'});
  const report=await auditSlotOccupancy(db,projectId);
  await db.doc('appointments/legacy').update({time:'11:00'});
  await assert.rejects(applyReviewedSlotOccupancyAudit(db,report,{confirmProject:projectId,approvedReportHash:report.reportHash,reviewerUid:'admin'}),/citas han cambiado/);
  await assert.rejects(verifySlotOccupancyAudit(db,report));assert.equal((await read('system_controls/release')).occupancyVersion,1);
  assert.equal((await db.collection('slot_occupancy').get()).size,0);
});

test('recovery after verification invalidates readiness and requires an empty queue before verifying again',async()=>{
  await db.doc('system_controls/release').set({phase:'frozen'},{merge:true});
  const report=await auditSlotOccupancy(db,projectId);
  await applyReviewedSlotOccupancyAudit(db,report,{confirmProject:projectId,approvedReportHash:report.reportHash,reviewerUid:'admin'});
  await verifySlotOccupancyAudit(db,report);
  assert.equal((await read('system_controls/release')).occupancyVerifiedEpoch,1);
  const target=guardBackground(db,'testFinance',async()=>{});
  await target({id:'after-verification',params:{}});
  await assert.rejects(verifySlotOccupancyAudit(db,report),/eventos por recuperar/);
  const job=(await db.collection('release_deferred_events').get()).docs[0];
  await job.ref.update({state:'ready',approvedReleaseId:'test-release',approvedEpoch:1});
  await createReleaseRecoveryHandler(db,()=>({testFinance:{run:target}}))({params:{jobId:job.id}});
  assert.equal((await read('system_controls/release')).occupancyVerifiedEpoch,null);
  await verifySlotOccupancyAudit(db,report);
  assert.equal((await read('system_controls/release')).occupancyVerifiedEpoch,1);
});

test('a reconciliation interrupted after 400 writes resumes from receipts without double counting',async()=>{
  await db.doc('system_controls/release').set({phase:'frozen',occupancyVersion:1},{merge:true});
  const docs={};for(let index=0;index<201;index++){
    const date=new Date(Date.UTC(2027,0,1+index)).toISOString().slice(0,10);
    docs[`appointments/legacy-${index}`]={status:'pending',duration:'60',date,time:'10:00'};
  }await seed(docs);
  const report=await auditSlotOccupancy(db,projectId),options={confirmProject:projectId,approvedReportHash:report.reportHash,reviewerUid:'admin'};
  const original=db.runTransaction.bind(db);let transactions=0;
  db.runTransaction=async(...args)=>{if(++transactions===2)throw new Error('simulated interruption');return original(...args);};
  try{await assert.rejects(applyReviewedSlotOccupancyAudit(db,report,options),/simulated interruption/);}finally{db.runTransaction=original;}
  assert.equal((await db.collection('slot_occupancy').get()).size,400);
  await assert.rejects(verifySlotOccupancyAudit(db,report));assert.equal((await read('system_controls/release')).occupancyVersion,1);
  const resumed=await applyReviewedSlotOccupancyAudit(db,report,options);assert.equal(resumed.replayed,1);assert.equal(resumed.chunks,3);
  await verifySlotOccupancyAudit(db,report);assert.equal((await db.collection('slot_occupancy').get()).size,804);
  for(const snap of (await db.collection('slot_occupancy').get()).docs)assert.equal(snap.data().count,1);
});
