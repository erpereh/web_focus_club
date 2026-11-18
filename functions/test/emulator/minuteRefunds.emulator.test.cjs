const assert = require('node:assert/strict');
const test = require('node:test');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
if (!host || !projectId.startsWith('demo-')) throw new Error('Minute refund tests require a demo-* Firestore emulator.');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { readFinanceContext, refundAppointmentMinutesInTransaction, deductAppointmentMinutesInTransaction } = require('../../lib/appointmentFinance.js');
const { settleMinuteRefund, drainMinuteRefunds, recoverDueMinuteRefunds, reservationIdentity, wakeMinuteRefunds } = require('../../lib/minuteRefunds.js');
const { auditMinuteRefunds, applyReviewedMinuteRefundAudit } = require('../../lib/minuteRefundAudit.js');
const { createAdminAppointmentStatusHandlers } = require('../../lib/adminAppointmentStatus.js');
const { createMinuteRefundAdminHandlers } = require('../../lib/minuteRefundAdmin.js');
initializeApp({ projectId });
const db = getFirestore();
const NOW = new Date('2026-11-13T12:00:00Z');
const DEDUCTED = '2026-11-01T10:00:00Z';
const callable = (data) => ({ auth: { uid: 'admin', token: { email: 'admin@example.test' } }, data });
const admin = createAdminAppointmentStatusHandlers({ db, requireAdmin: async () => undefined, getNowDate: () => NOW });
const refundAdmin = createMinuteRefundAdminHandlers({ db, requireAdmin: async () => undefined });
const source = (extra = {}) => ({ userId: 'u', bonoId: 'b', status: 'rejected', duration: '60', appointmentType: 'training',
  minutesDeducted: true, minutesDeductedAmount: 60, minutesDeductedAt: DEDUCTED, ...extra });
const bono = (extra = {}) => ({ userId: 'u', estado: 'activo', tamano: 240, minutosTotales: 240, minutosRestantes: 240,
  fechaAsignacion: '2026-11-01T00:00:00Z', fechaExpiracion: '2099-12-31T22:59:59Z', createdAt: '2026-11-01T00:00:00Z', historial: [], ...extra });
async function reset(extra = {}) {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok, true);
  const batch = db.batch();
  for (const [path, data] of Object.entries({ 'users/admin': { role: 'admin' }, 'users/u': { role: 'user' },
    'site_config/main': { automaticMinuteRefundsEnabled: false, startHour: 7, endHour: 22, slotInterval: 15, maxCapacity: 4 },
    'bonos/b': bono(), 'appointments/a': source(), ...extra })) batch.set(db.doc(path), data);
  await batch.commit();
}
async function request(id = 'a') {
  return db.runTransaction(async (tx) => {
    const ref = db.collection('appointments').doc(id);
    const snap = await tx.get(ref);
    const finance = await readFinanceContext(tx, db, snap.data());
    return refundAppointmentMinutesInTransaction(tx, ref, snap.data(), finance, NOW.toISOString());
  });
}
async function data(path) { return (await db.doc(path).get()).data(); }
async function enable() { await db.doc('site_config/main').update({ automaticMinuteRefundsEnabled: true }); }
const refundId = (id = 'a', overrides = {}) => reservationIdentity(id, source(overrides));

test('flag off: a full bono records 60 owed, zero credited, no misleading history; restart then activation credits exactly once', async () => {
  await reset();
  await Promise.all([request(), request(), request()]);
  const id = refundId();
  let debt = await data(`minute_refunds/${id}`);
  assert.deepEqual([debt.requestedMinutes, debt.creditedMinutes, debt.pendingMinutes], [60, 0, 60]);
  assert.equal((await data('appointments/a')).minutesRefundedAt, null);
  assert.equal((await data('appointments/a')).minutesRefunded, false);
  assert.deepEqual((await data('bonos/b')).historial, []);
  assert.equal((await settleMinuteRefund(db, id, NOW)).credited, 0);
  assert.equal((await data('minute_refund_accounts/u')).pendingMinutes, 60);
  await enable();
  await Promise.all(Array.from({ length: 5 }, () => settleMinuteRefund(db, id, NOW)));
  debt = await data(`minute_refunds/${id}`);
  assert.deepEqual([debt.creditedMinutes, debt.pendingMinutes], [60, 0]);
  const b = await data('bonos/b');
  assert.deepEqual([b.tamano, b.minutosExtraRecuperados, b.minutosTotales, b.minutosRestantes], [240, 60, 300, 300]);
  assert.equal(b.historial.length, 1);
  assert.equal((await db.collection(`minute_refunds/${id}/movements`).get()).size, 2);
  await request();
  assert.equal((await data('bonos/b')).minutosRestantes, 300);
});

test('flag off: an ordinary original-bono refund works; partial capacity records only the actual amount in history', async () => {
  await reset({ 'bonos/b': bono({ minutosRestantes: 210 }) });
  await request();
  const debt = await data(`minute_refunds/${refundId()}`);
  assert.deepEqual([debt.requestedMinutes, debt.creditedMinutes, debt.pendingMinutes], [60, 30, 30]);
  assert.equal((await data('bonos/b')).historial[0].duracion, '30');
  assert.equal((await data('appointments/a')).minutesRefunded, false);
  await enable();
  await settleMinuteRefund(db, refundId(), NOW);
  const b = await data('bonos/b');
  assert.deepEqual([b.minutosRestantes, b.minutosTotales, b.minutosExtraRecuperados], [270, 270, 30]);
  assert.equal((await data('appointments/a')).minutesRefundedAmount, 60);
});

test('transfers add recovered capacity even when there is spare room, preserving historical extensions', async () => {
  await reset({ 'bonos/old': bono({ estado: 'agotado', replacedByBonoId: 'b', minutosRestantes: 0, createdAt: '2026-10-01' }),
    'bonos/b': bono({ minutosTotales: 270, minutosRestantes: 120 }), 'appointments/a': source({ bonoId: 'old' }) });
  await request();
  assert.equal((await data('bonos/b')).minutosRestantes, 120);
  await enable();
  await settleMinuteRefund(db, refundId('a', { bonoId: 'old' }), NOW);
  const b = await data('bonos/b');
  assert.deepEqual([b.tamano, b.minutosCapacidadBase, b.minutosTotales, b.minutosRestantes], [240, 270, 330, 180]);
});

test('a legacy capped refund stays blocked after activation, retry and deletion; debt has no expiration', async () => {
  await reset({ 'appointments/a': source({ minutesRefunded: true, minutesRefundedAmount: 60, minutesRefundedAt: '2026-11-06T12:00:00Z',
    minutesRefundCappedAmount: 60, minutesRefundPendingAmount: 60, minutesRefundPendingReview: true }) });
  await enable();
  await request();
  await assert.rejects(refundAdmin.retryMinuteRefundFromAdmin(callable({ refundId: refundId() })), /informe revisado/);
  await admin.deleteAppointmentsFromAdmin(callable({ appointmentIds: ['a'] }));
  await db.doc(`minute_refunds/${refundId()}`).update({ reviewApproved: true });
  await settleMinuteRefund(db, refundId(), NOW);
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
  const archive = await data('appointment_deletions/a');
  assert.equal(archive.finance.pendingRefundMinutes, 60);
  assert.equal(archive.expiresAt, undefined);
  assert.equal((await data(`minute_refunds/${refundId()}`)).sourceDeleted, true);
});

test('deleted fresh debts remain payable once and disappear from canonical statistics', async () => {
  await reset();
  await request();
  await admin.deleteAppointmentsFromAdmin(callable({ appointmentIds: ['a'] }));
  const before = await refundAdmin.getMinuteRefundSummaryFromAdmin(callable({}));
  assert.equal(before.minutes, 60);
  assert.equal(before.count, 1);
  await enable();
  await Promise.all([settleMinuteRefund(db, refundId(), NOW), settleMinuteRefund(db, refundId(), NOW)]);
  const after = await refundAdmin.getMinuteRefundSummaryFromAdmin(callable({}));
  assert.equal(after.minutes, 0);
  assert.equal(after.count, 0);
  assert.equal((await data('appointment_deletions/a')).finance.pendingRefundMinutes, 0);
});

test('no valid destination sleeps without losing debt; assignment wakes it; expired paid extras do not become new debt', async () => {
  await reset({ 'bonos/b': bono({ estado: 'expirado', fechaExpiracion: '2026-11-02T00:00:00Z' }) });
  await request(); await enable();
  await drainMinuteRefunds(db, 'u', NOW);
  assert.equal((await data(`minute_refunds/${refundId()}`)).state, 'waiting_bono');
  assert.equal((await data('minute_refund_accounts/u')).nextAttemptAt, null);
  await admin.assignBonoFromAdmin(callable({ userId: 'u', requestId: 'renewal-test-0001', tamano: 240,
    fechaAsignacion: '2026-11-01T00:00:00Z', fechaExpiracion: '2099-12-31T22:59:59Z' }));
  await wakeMinuteRefunds(db, 'u', NOW);
  await drainMinuteRefunds(db, 'u', NOW);
  assert.equal((await data('bonos/renewal-test-0001')).minutosRestantes, 300);
  await db.doc('bonos/renewal-test-0001').update({ estado: 'expirado' });
  await settleMinuteRefund(db, refundId(), NOW);
  assert.equal((await data(`minute_refunds/${refundId()}`)).pendingMinutes, 0);
});

test('latest exhausted but valid bono is reactivated; several active bonos block every compensation', async () => {
  await reset({ 'bonos/b': bono({ estado: 'agotado', minutosRestantes: 0 }) });
  await request();
  assert.equal((await data('bonos/b')).estado, 'activo'); // ordinary restoration works while flag is off
  await reset({ 'bonos/other': bono({ createdAt: '2026-11-02T00:00:00Z' }) });
  await request(); await enable();
  const result = await settleMinuteRefund(db, refundId(), NOW);
  assert.equal(result.state, 'blocked');
  assert.equal((await data(`minute_refunds/${refundId()}`)).reason, 'multiple_active_bonos');
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
});

test('concurrent consumption and compensation preserve both movements and effective capacity', async () => {
  await reset(); await request(); await enable();
  await Promise.all([settleMinuteRefund(db, refundId(), NOW), db.runTransaction(async (tx) => {
    const snap = await tx.get(db.doc('bonos/b'));
    const ref = db.doc('appointments/new-reservation');
    deductAppointmentMinutesInTransaction(tx, ref, { userId: 'u' }, snap, 30, NOW.toISOString());
  })]);
  const b = await data('bonos/b');
  assert.deepEqual([b.minutosRestantes, b.minutosTotales], [270, 300]);
  assert.equal(b.historial.length, 2);
});

test('simultaneous assignments and a racing compensation leave one active bono and one credit', async () => {
  await reset(); await request(); await enable();
  const assign = (id) => admin.assignBonoFromAdmin(callable({ userId: 'u', requestId: id, tamano: 240,
    fechaAsignacion: '2026-11-01T00:00:00Z', fechaExpiracion: '2099-12-31T22:59:59Z' }));
  await Promise.all([assign('renew-race-0001'), assign('renew-race-0002'), settleMinuteRefund(db, refundId(), NOW)]);
  assert.equal((await db.collection('bonos').where('userId', '==', 'u').where('estado', '==', 'activo').get()).size, 1);
  const bonos = await db.collection('bonos').get();
  assert.equal(bonos.docs.reduce((sum, d) => sum + Number(d.data().minutosExtraRecuperados ?? 0), 0), 60);
});

test('a future start schedules one wake; flag off suppresses scheduled recovery', async () => {
  await reset({ 'bonos/b': bono({ fechaAsignacion: '2026-12-01T00:00:00Z' }) });
  // Future bonos must not receive ordinary refunds either: use a transfer.
  await db.doc('bonos/old').set(bono({ estado: 'agotado', replacedByBonoId: 'b', minutosRestantes: 0, createdAt: '2026-10-01' }));
  await db.doc('appointments/a').set(source({ bonoId: 'old' }));
  await request();
  assert.equal(await recoverDueMinuteRefunds(db, NOW), 0);
  await enable(); await drainMinuteRefunds(db, 'u', NOW);
  assert.equal((await data('minute_refund_accounts/u')).nextAttemptAt, '2026-12-01T00:00:00.000Z');
});

test('25-claim pages continue only while work remains; settled accounts have no timer', async () => {
  await reset({ 'bonos/old': bono({ estado: 'agotado', replacedByBonoId: 'b', minutosTotales: 2400, tamano: 2400, minutosRestantes: 0, createdAt: '2026-10-01' }) });
  await db.doc('appointments/a').delete();
  for (let i = 0; i < 26; i += 1) { await db.doc(`appointments/a${i}`).set(source({ bonoId: 'old' })); await request(`a${i}`); }
  await enable();
  assert.equal(await drainMinuteRefunds(db, 'u', NOW), 25 * 60);
  assert.equal((await data('minute_refund_accounts/u')).pendingMinutes, 60);
  assert.equal(await drainMinuteRefunds(db, 'u', NOW), 60);
  assert.equal((await data('minute_refund_accounts/u')).nextAttemptAt, null);
});

test('reviewed historical import checks hash and current evidence, is repeatable, then credits once', async () => {
  const legacy = source({ bonoId: 'old', minutesRefunded: true, minutesRefundedAmount: 60, minutesRefundedAt: '2026-11-06T12:00:00Z',
    minutesRefundedToBonoId: 'b', minutesRefundCappedAmount: 60, minutesRefundPendingAmount: 60 });
  await reset({ 'appointments/a': legacy, 'bonos/old': bono({ estado: 'agotado', minutosRestantes: 0, replacedByBonoId: 'b', createdAt: '2026-10-01',
    historial: [{ appointmentId: 'a', fecha: DEDUCTED, accion: 'descuento_cita', duracion: '60' }] }),
    'bonos/b': bono({ minutosRestantes: 180, historial: [{ appointmentId: 'a', fecha: '2026-11-06T12:00:00Z', accion: 'devolucion_cita', duracion: '60' },
      { appointmentId: 'spent', fecha: '2026-11-11T12:00:00Z', accion: 'descuento_cita', duracion: '60' }] }) });
  const report = await auditMinuteRefunds(db, ['a'], projectId, NOW);
  assert.equal(report.cases[0].eligibleForReviewedImport, true, JSON.stringify(report.cases[0].issues));
  assert.deepEqual([report.cases[0].credited, report.cases[0].pending, report.cases[0].proposedCapacity], [0, 60, 300]);
  const options = { confirmProject: projectId, approvedReportHash: report.reportHash, reviewerUid: 'admin' };
  await assert.rejects(applyReviewedMinuteRefundAudit(db, { ...report, reportHash: 'tampered' }, options));
  await db.doc('bonos/b').update({ minutosRestantes: 150 });
  await assert.rejects(applyReviewedMinuteRefundAudit(db, report, options), /Audit changed/);
  await db.doc('bonos/b').update({ minutosRestantes: 180 });
  const fresh = await auditMinuteRefunds(db, ['a'], projectId, NOW);
  const approved = { ...options, approvedReportHash: fresh.reportHash };
  await applyReviewedMinuteRefundAudit(db, fresh, approved);
  assert.equal((await data('bonos/b')).minutosRestantes, 180);
  await enable();
  await settleMinuteRefund(db, refundId('a', { bonoId: 'old' }), NOW);
  await applyReviewedMinuteRefundAudit(db, fresh, approved);
  assert.deepEqual([(await data('bonos/b')).minutosRestantes, (await data('bonos/b')).minutosTotales], [240, 300]);
});

test('manual additions never extend capacity, are idempotent and audited', async () => {
  await reset({ 'bonos/b': bono({ minutosRestantes: 210 }) });
  const input = { bonoId: 'b', requestId: 'manual-test-0001', action: 'adjust', delta: 30 };
  await Promise.all([refundAdmin.mutateBonoFromAdmin(callable(input)), refundAdmin.mutateBonoFromAdmin(callable(input))]);
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
  assert.equal((await data('bonos/b')).historial.length, 1);
  await assert.rejects(refundAdmin.mutateBonoFromAdmin(callable({ ...input, requestId: 'manual-test-0002' })), /capacidad/);
  assert.equal((await data('bonos/b')).minutosTotales, 240);
});

test('worker rechecks the flag after its preliminary enabled read', async () => {
  await reset(); await request(); await enable();
  const wrapped = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return async (callback) => {
      await db.doc('site_config/main').update({ automaticMinuteRefundsEnabled: false });
      return db.runTransaction(callback);
    };
    const member = Reflect.get(target, key, target);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  assert.equal(await drainMinuteRefunds(wrapped, 'u', NOW), 0);
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
  assert.equal((await data(`minute_refunds/${refundId()}`)).pendingMinutes, 60);
});

test('transient failure stores backoff; inconsistent accounting blocks without a timer', async () => {
  await reset(); await request(); await enable();
  const wrapped = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return async () => { throw new Error('temporary transport failure'); };
    const member = Reflect.get(target, key, target);
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  await assert.rejects(drainMinuteRefunds(wrapped, 'u', NOW), /transport/);
  const account = await data('minute_refund_accounts/u');
  assert.equal(account.attempts, 1);
  assert.equal(account.nextAttemptAt, '2026-11-13T12:02:00.000Z');
  await db.doc(`minute_refunds/${refundId()}`).update({ creditedMinutes: 999 });
  await drainMinuteRefunds(db, 'u', new Date(NOW.getTime() + 180_000));
  assert.equal((await data(`minute_refunds/${refundId()}`)).state, 'blocked');
  assert.equal((await data('minute_refund_accounts/u')).nextAttemptAt, null);
});

test('a late refund never overwrites a new debit cycle of the same appointment', async () => {
  await reset(); await request();
  await db.runTransaction(async (tx) => {
    const [appointment, b] = await Promise.all([tx.get(db.doc('appointments/a')), tx.get(db.doc('bonos/b'))]);
    deductAppointmentMinutesInTransaction(tx, db.doc('appointments/a'), appointment.data(), b, 30, '2026-11-13T13:00:00Z');
  });
  await enable(); await settleMinuteRefund(db, refundId(), NOW);
  const appointment = await data('appointments/a');
  assert.equal(appointment.minutesDeductedAmount, 30);
  assert.equal(appointment.minuteRefundId, null);
  assert.equal(appointment.minutesRefundedAt, null);
  assert.equal((await data('bonos/b')).minutosRestantes, 270);
});

test('two un-replaced exhausted bonos cannot both be reactivated by ordinary refunds', async () => {
  await reset({ 'bonos/b': bono({ estado: 'agotado', minutosRestantes: 0, createdAt: '2026-11-01T00:00:00Z' }),
    'bonos/newest': bono({ estado: 'agotado', minutosRestantes: 0, createdAt: '2026-11-02T00:00:00Z' }),
    'appointments/newest-source': source({ bonoId: 'newest' }) });
  await Promise.all([request(), request('newest-source')]);
  assert.equal((await db.collection('bonos').where('estado', '==', 'activo').get()).size, 1);
  assert.equal((await data('bonos/newest')).estado, 'activo');
  assert.equal((await data(`minute_refunds/${refundId()}`)).pendingMinutes, 60);
});

test('scheduled recovery handles at most 50 due clients, leaving the rest durable', async () => {
  await reset(); await enable();
  const batch = db.batch();
  for (let i = 0; i < 51; i += 1) {
    const userId = `waiting-${i}`;
    const id = reservationIdentity(userId, source({ userId }));
    batch.set(db.doc(`minute_refunds/${id}`), { userId, appointmentId: userId, reservationId: id, sourceBonoId: 'missing',
      deductedAt: DEDUCTED, requestedMinutes: 60, creditedMinutes: 0, pendingMinutes: 60, state: 'ready', reason: null,
      historical: false, reviewApproved: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), lastCreditedAt: null, targetBonoId: null, version: 0 });
    batch.set(db.doc(`minute_refund_accounts/${userId}`), { pendingMinutes: 60, generation: 1, nextAttemptAt: NOW.toISOString() });
  }
  await batch.commit();
  assert.equal(await recoverDueMinuteRefunds(db, NOW), 0);
  assert.equal((await db.collection('minute_refund_accounts').where('nextAttemptAt', '>', '').where('nextAttemptAt', '<=', NOW.toISOString()).get()).size, 1);
  assert.equal((await db.collection('minute_refunds').where('state', '==', 'waiting_bono').get()).size, 50);
});

test('exactly 25 refunds finish without an empty continuation or recurring recovery timer', async () => {
  await reset({ 'bonos/old': bono({ estado: 'agotado', replacedByBonoId: 'b', minutosTotales: 2400, tamano: 2400, minutosRestantes: 0, createdAt: '2026-10-01' }) });
  await db.doc('appointments/a').delete();
  for (let i = 0; i < 25; i += 1) { await db.doc(`appointments/a${i}`).set(source({ bonoId: 'old' })); await request(`a${i}`); }
  await enable();
  assert.equal(await drainMinuteRefunds(db, 'u', NOW), 25 * 60);
  const account = await data('minute_refund_accounts/u');
  assert.equal(account.pendingMinutes, 0);
  assert.equal(account.nextAttemptAt, null);
  assert.equal(await recoverDueMinuteRefunds(db, NOW), 0);
});

test('a mismatched original bono owner is an inconsistency, never an automatic credit', async () => {
  await reset({ 'bonos/b': bono({ userId: 'someone-else' }), 'bonos/valid': bono() });
  await request(); await enable();
  const result = await settleMinuteRefund(db, refundId(), NOW);
  assert.equal(result.state, 'blocked');
  assert.equal((await data('bonos/valid')).minutosRestantes, 240);
  assert.equal((await data(`minute_refunds/${refundId()}`)).reason, 'bono_owner_mismatch');
});

test('an audited partial legacy refund of a deleted appointment preserves its prior actual credit', async () => {
  await reset({ 'bonos/old': bono({ estado: 'agotado', replacedByBonoId: 'b', minutosRestantes: 0, createdAt: '2026-10-01',
    historial: [{ appointmentId: 'a', fecha: DEDUCTED, accion: 'descuento_cita', duracion: '60' }] }),
    'bonos/b': bono({ minutosRestantes: 210, historial: [
      { appointmentId: 'spent-before', fecha: DEDUCTED, accion: 'descuento_cita', duracion: '30' },
      { appointmentId: 'a', fecha: '2026-11-06T12:00:00Z', accion: 'devolucion_cita', duracion: '60' },
      { appointmentId: 'spent-after', fecha: '2026-11-10T12:00:00Z', accion: 'descuento_cita', duracion: '30' },
    ] }),
    'appointment_deletions/a': { userId: 'u', deletedAt: NOW.toISOString(), finance: {
      bonoId: 'old', minutesDeducted: true, minutesDeductedAt: DEDUCTED, minutesDeductedAmount: 60,
      refundedAmount: 30, pendingRefundMinutes: 30, cappedMinutes: 30,
    } } });
  await db.doc('appointments/a').delete();
  const report = await auditMinuteRefunds(db, ['a'], projectId, NOW);
  assert.equal(report.cases[0].eligibleForReviewedImport, true, JSON.stringify(report.cases[0].issues));
  assert.deepEqual([report.cases[0].requested, report.cases[0].credited, report.cases[0].pending], [60, 30, 30]);
  await applyReviewedMinuteRefundAudit(db, report, { confirmProject: projectId, approvedReportHash: report.reportHash, reviewerUid: 'admin' });
  await enable(); await settleMinuteRefund(db, refundId('a', { bonoId: 'old' }), NOW);
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
  assert.equal((await data('appointment_deletions/a')).finance.refundedAmount, 60);
  assert.equal((await data('appointment_deletions/a')).finance.pendingRefundMinutes, 0);
});

test('cancelling an already released reopened request with charge keeps zero additional minutes', async () => {
  await reset(); await request();
  await db.doc('appointments/a').update({ status: 'pending' });
  const result = await admin.updateAppointmentStatusFromAdmin(callable({ appointmentId: 'a', expectedStatus: 'pending', status: 'cancelled', cancellationCharge: 'charged' }));
  assert.equal(result.chargedMinutes, 0);
  assert.equal((await data('bonos/b')).minutosRestantes, 240);
  assert.equal((await data(`minute_refunds/${refundId()}`)).pendingMinutes, 60);
});
