#!/usr/bin/env node
const common = require('./release-common.cjs');
const { arg, readJson, writeJson, readonlyFirestore, initialize } = common;
async function main() {
  const mode = arg('--mode') ?? 'audit';
  if (!['audit', 'apply', 'verify'].includes(mode)) throw new Error('Usa audit, apply o verify.');
  const report = arg('--reviewed-report') ? readJson(arg('--reviewed-report')) : undefined;
  const project = arg('--project') ?? arg('--confirm-project');
  if (!project || (report && report.projectId !== project)) throw new Error('Indica el proyecto explícitamente y comprueba el informe.');
  if (mode !== 'audit' && (!report || arg('--confirm-project') !== project)) throw new Error('apply y verify requieren --reviewed-report y --confirm-project.');
  if (mode === 'apply' && (!arg('--approved-report-hash') || !arg('--reviewer-uid'))) throw new Error('Faltan el hash aprobado y el UID revisor.');
  if (mode === 'audit') readonlyFirestore();
  const { db, credential } = await initialize(project);
  try {
    if(mode !== 'audit' && project === 'focus-club-f73b8') {
      const manifest=readJson(arg('--manifest')??require('node:path').join(common.root,'release/manifest.json'));
      common.assertManifest(manifest);
      await require('./release-controls.cjs').verifyFunctions(credential,project,manifest,'final');
      await require('./release-controls.cjs').verifyRules(credential,project,require('node:path').join(common.root,'firestore.rules'));
      await require('./release-controls.cjs').verifyIndexes(credential,project);
      await require('./release-controls.cjs').verifyHosting(credential,project);
    }
    const engine = require('../functions/lib/slotOccupancyAudit.js');
    if (mode === 'audit') {
      if (!arg('--out')) throw new Error('audit requiere --out; no se sobrescriben informes existentes.');
      const audit = await engine.auditSlotOccupancy(db, project);
      writeJson(arg('--out'), audit);
      console.log(JSON.stringify({ reportHash: audit.reportHash, ...audit.summary, issues: audit.issues, overCapacity: audit.overCapacity.length, frozen: audit.frozen }, null, 2));
    } else if (mode === 'apply') console.log(await engine.applyReviewedSlotOccupancyAudit(db, report, {
      confirmProject: project, approvedReportHash: arg('--approved-report-hash'), reviewerUid: arg('--reviewer-uid'),
    }));
    else { await engine.verifySlotOccupancyAudit(db, report); console.log('Ocupación verificada; versión 2 preparada. Mantenimiento cerrado.'); }
  } finally { await db.terminate(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
