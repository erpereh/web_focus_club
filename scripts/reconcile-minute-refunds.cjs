#!/usr/bin/env node
// Audit is the default. No deploy, feature activation or historical credit is performed here.
const fs = require('node:fs');
const path = require('node:path');
const requireFunctions = require('node:module').createRequire(path.join(__dirname, '../functions/package.json'));
const firestore = requireFunctions('firebase-admin/firestore');
const value = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const mode = value('--mode') ?? 'audit';
if (!['audit', 'apply'].includes(mode)) throw new Error('Use --mode audit or --mode apply.');
const reportFile = value('--reviewed-report');
const input = mode === 'apply' && reportFile ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : undefined;
const projectId = value('--project') ?? input?.projectId;
if (!projectId) throw new Error('An explicit --project is required for audit.');
if (mode === 'apply' && (!input || value('--confirm-project') !== projectId || !value('--approved-report-hash') || !value('--reviewer-uid'))) {
  throw new Error('Apply requires the reviewed report, its approved hash, named reviewer and explicit matching project before connecting.');
}
if (mode === 'audit') {
  for (const [prototype, methods] of [
    [firestore.DocumentReference.prototype, ['set', 'update', 'delete', 'create']],
    [firestore.CollectionReference.prototype, ['add']],
    [firestore.Transaction.prototype, ['set', 'update', 'delete', 'create']],
    [firestore.WriteBatch.prototype, ['set', 'update', 'delete', 'create', 'commit']],
    [firestore.BulkWriter.prototype, ['set', 'update', 'delete', 'create', 'flush', 'close']],
    [firestore.Firestore.prototype, ['runTransaction', 'batch', 'bulkWriter', 'recursiveDelete']],
  ]) for (const method of methods) Object.defineProperty(prototype, method, {
    value() { throw new Error(`Read-only audit: ${method} is disabled`); }, configurable: false, writable: false,
  });
}
let db;
let credential;
const { auditMinuteRefunds, applyReviewedMinuteRefundAudit } = require('../functions/lib/minuteRefundAudit.js');
async function main() {
  ({db,credential} = await require('./release-common.cjs').initialize(projectId));
  if (mode === 'apply' && projectId === 'focus-club-f73b8') {
    const common = require('./release-common.cjs');
    const manifest = common.readJson(common.path.join(common.root,'release/manifest.json'));
    common.assertManifest(manifest);
    const controls = require("./release-controls.cjs");
    await controls.verifyFunctions(credential,projectId,manifest,"final");
    await controls.verifyRules(credential,projectId,common.path.join(common.root,"firestore.rules"));
    await controls.verifyIndexes(credential,projectId);
    await controls.verifyHosting(credential,projectId);
    const [gate,config] = await Promise.all([db.doc('system_controls/release').get(),db.doc('site_config/main').get()]);
    if(gate.data()?.phase!=='open' || gate.data()?.occupancyVersion!==2 || gate.data()?.occupancyVerifiedEpoch!==gate.data()?.epoch
      || gate.data()?.storesVerifiedBuild!==manifest.mobile.build || config.data()?.automaticMinuteRefundsEnabled!==true
      || config.data()?.minAndroidBuild<manifest.mobile.build || config.data()?.minIosBuild<manifest.mobile.build) {
      throw new Error('No aplicar históricos antes de publicar ambas apps, exigir la actualización y activar de forma autorizada las devoluciones.');
    }
  }

  if (mode === 'audit') {
    const ids = (value('--appointment-ids') ?? '').split(',').filter(Boolean);
    if (!ids.length || ids.length > 20 || ids.some((id) => id.includes('/'))) throw new Error('Specify 1–20 --appointment-ids separated by commas.');
    const report = await auditMinuteRefunds(db, ids, projectId);
    const out = value('--out');
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      console.log(`Read-only report written to ${path.resolve(out)}`);
    } else console.log(JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ projectId, reportHash: report.reportHash, cases: report.cases.map((c) => ({
      appointmentId: c.appointmentId, requested: c.requested, credited: c.credited, pending: c.pending,
      eligibleForReviewedImport: c.eligibleForReviewedImport, issues: c.issues,
    })) }, null, 2));
    return;
  }
  const confirmProject = value('--confirm-project');
  const approvedReportHash = value('--approved-report-hash');
  const reviewerUid = value('--reviewer-uid');
  if (!input || !confirmProject || !approvedReportHash || !reviewerUid) throw new Error('Apply requires --reviewed-report, --confirm-project, --approved-report-hash and --reviewer-uid.');
  const imported = await applyReviewedMinuteRefundAudit(db, input, { confirmProject, approvedReportHash, reviewerUid });
  console.log(JSON.stringify({ imported, note: 'Reviewed claims imported. Automatic settlement still requires the live feature flag.' }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db?.terminate());
