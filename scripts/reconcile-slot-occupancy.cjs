#!/usr/bin/env node
const common = require('./release-common.cjs');
const { arg, readJson, writeJson, readonlyFirestore, initialize } = common;
async function main() {
  const mode = arg('--mode') ?? 'audit';
  if (!['audit', 'apply', 'verify'].includes(mode)) throw new Error('Usa audit, apply o verify.');
  const scope = arg('--scope');
  if (scope !== undefined && scope !== 'reviewed-counts') throw new Error('Alcance de conciliación desconocido.');
  const reviewedCounts = scope === 'reviewed-counts';
  const report = arg('--reviewed-report') ? readJson(arg('--reviewed-report')) : undefined;
  const project = arg('--project') ?? arg('--confirm-project');
  if (!project || (report && report.projectId !== project)) throw new Error('Indica el proyecto explícitamente y comprueba el informe.');
  if (mode !== 'audit' && (!report || arg('--confirm-project') !== project)) throw new Error('apply y verify requieren --reviewed-report y --confirm-project.');
  if (mode === 'apply' && (!arg('--approved-report-hash') || !arg('--reviewer-uid'))) throw new Error('Faltan el hash aprobado y el UID revisor.');
  if (reviewedCounts && mode === 'apply' && !arg('--backup')) throw new Error('Falta el respaldo cifrado de los contadores.');
  if (mode === 'audit') readonlyFirestore();
  const { db, credential } = await initialize(project);
  try {
    if(mode !== 'audit' && project === 'focus-club-f73b8') {
      const manifest=readJson(arg('--manifest')??require('node:path').join(common.root,'release/manifest.json'));
      common.assertManifest(manifest, { skipMobile: reviewedCounts });
      if (manifest.remainingSelective && (!reviewedCounts || manifest.manifestHash !== report.manifestHash)) {
        throw new Error('Esta época exige el informe revisado de conteos y su manifiesto exacto.');
      }
      await require('./release-controls.cjs').verifyFinal(credential, project, manifest);
    }
    if (reviewedCounts) {
      const counts = require('../functions/lib/slotOccupancyCounts.js');
      const backupTool = require('./occupancy-count-backup.cjs');
      if (mode === 'audit') {
        const { report: audit, backup } = await counts.auditCounts(db, project);
        const out = arg('--out');
        const backupFile = arg('--backup');
        if (out || backupFile) {
          if (!out || !backupFile || audit.phase !== 'frozen' || !audit.idle || audit.issues.length) {
            throw new Error('Para conservar evidencia aplicable se requiere frozen, cola vacía, --out y --backup.');
          }
          const destination = backupTool.privatePath(out);
          const target = backupTool.privatePath(backupFile);
          if (destination.toLowerCase() === target.toLowerCase() || common.fs.existsSync(destination) || common.fs.existsSync(target)) {
            throw new Error('Usa dos rutas diferentes y nuevas para preservar la evidencia.');
          }
          const sealed = backupTool.writeBackup(target, backup);
          writeJson(destination, audit);
          console.log(JSON.stringify({ report: destination, backup: sealed }));
        }
        console.log(JSON.stringify(audit, null, 2));
      } else if (mode === 'apply') {
        console.log(await counts.applyCounts(db, report, backupTool.readBackup(arg('--backup')), {
          confirmProject: project, approvedReportHash: arg('--approved-report-hash'), reviewerUid: arg('--reviewer-uid'),
        }));
      } else {
        await counts.verifyCounts(db, report);
        console.log('Inventario completo verificado para esta época. Mantenimiento cerrado.');
      }
      return;
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
