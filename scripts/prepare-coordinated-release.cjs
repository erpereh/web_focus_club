#!/usr/bin/env node
// All network requests in this tool are GETs. It writes local artifacts only.
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const c = require('./release-common.cjs');
const { fs, path, root, arg, flag, hash, readJson, writeJson, initialize, googleGet, deployedFunctions } = c;
const { exportedFunctionNames } = require('../functions/scripts/deploy-filter.cjs');
const { specializePortalBootstrap, repairPortalBootstrap } = require('./portal-bootstrap-repair.cjs');
const ts = c.requireFunctions('typescript');
const RELEASE_ID = 'occupancy-v2-refunds-20261118';

function zipFiles(buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Archivo ZIP no válido.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), total = 0;
  const result = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Directorio ZIP no válido.');
    const method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24), nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    offset += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || name.includes(':') || name.split('/').includes('..') || result.has(name)) throw new Error('Ruta ZIP insegura o repetida.');
    total += size;
    if (total > 256 * 1024 * 1024 || size > 32 * 1024 * 1024) throw new Error('Archivo fuente demasiado grande.');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(bytes) : method === 8 ? zlib.inflateRawSync(bytes, { maxOutputLength: size + 1 }) : null;
    if (!data || data.length !== size) throw new Error('Compresión ZIP no admitida.');
    result.set(name, data);
  }
  return result;
}
function wrapBootstrap(source) {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const guards = new Set();
  let typedRequest = false;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call)) continue;
      const kind = call.expression.getText(file), name = declaration.name.getText(file), handler = call.arguments[1];
      if (!handler || !/^(onCall|onSchedule|onDocument\w+)$/.test(kind)) continue;
      let body = handler.getText(file);
      if (kind === 'onCall' && ts.isArrowFunction(handler) && handler.parameters[0] && !handler.parameters[0].type) {
        typedRequest = true;
        const parameter = handler.parameters[0], type = call.typeArguments?.[0]?.getText(file) ?? 'unknown';
        const start = parameter.getStart(file) - handler.getStart(file), end = parameter.getEnd() - handler.getStart(file);
        body = body.slice(0, start) + `${parameter.name.getText(file)}: ReleaseCallableRequest<${type}>` + body.slice(end);
      }
      guards.add(kind === 'onCall' ? 'guardCallable' : 'guardBackground');
      edits.push({ start: handler.getStart(file), end: handler.getEnd(), text: `${kind === 'onCall' ? 'guardCallable' : 'guardBackground'}(db, "${name}", ${body})` });
    }
  }
  if (!edits.length) throw new Error('No se puede acreditar el punto de entrada de la versión desplegada.');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return `import { ${[...guards].join(", ")} } from "./releaseMaintenance.js";\n${typedRequest ? 'import type { CallableRequest as ReleaseCallableRequest } from "firebase-functions/v2/https";\n' : ""}import { setGlobalOptions as setReleaseOptions } from "firebase-functions/v2";\nsetReleaseOptions({ labels: { focus_release: "${RELEASE_ID}", focus_phase: "bootstrap" } });\n` + source;
}
function maintenanceRules(source) {
  if (source.includes('function releaseIsOpen()')) throw new Error('La base ya contiene mantenimiento. Revisar su versión antes de preparar otro bootstrap.');
  const helper = `\n    function releaseIsOpen() {\n      let gate = /databases/$(database)/documents/system_controls/release;\n      return !exists(gate) || get(gate).data.phase == 'open';\n    }\n`;
  source = source.replace(/(match \/databases\/\{database\}\/documents \{)/, '$1' + helper);
  return source.replace(/(allow (?:create|update|delete|write)(?:,\s*(?:create|update|delete|write))*:\s*if\s*)([^;]+);/g, '$1releaseIsOpen() && ($2);');
}
function inventory(directory, relative, result, includeAll = false) {
  if (!fs.existsSync(directory)) return;
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (['node_modules', '.git', '.dart_tool', 'build', '.next', 'out'].includes(item.name)) continue;
    const file = path.join(directory, item.name), name = `${relative}/${item.name}`;
    if (item.isDirectory()) inventory(file, name, result, includeAll);
    else if (includeAll || (/\.(ts|tsx|js|cjs|dart|yaml|json|rules|html|css|ps1)$/.test(item.name) && !item.name.endsWith('.map'))) result.push({ path: name, sha256: hash(fs.readFileSync(file)) });
  }
}
async function main() {
  const project = arg('--project');
  if (project !== 'focus-club-f73b8') throw new Error('Usa explícitamente --project focus-club-f73b8.');
  const output = path.resolve(arg('--out') ?? path.join(root, 'release'));
  if (output !== path.join(root, 'release')) throw new Error('Los artefactos deben permanecer en release dentro del proyecto.');
  const web = exportedFunctionNames(fs.readFileSync(path.join(root, 'functions/src/index.ts'), 'utf8'));
  const inputs = [];
  for (const directory of ['functions/src', 'functions/lib', 'src', 'scripts', '../app_focus_club/lib', '../app_focus_club/functions/src', '../app_focus_club/functions/lib']) inventory(path.resolve(root, directory), directory, inputs);
  inventory(path.join(root, 'out'), 'out', inputs, true);
  for (const file of ['firebase.json', 'firestore.rules', 'firestore.indexes.json', 'functions/package.json', 'functions/package-lock.json',
    '../app_focus_club/pubspec.yaml', '../app_focus_club/pubspec.lock', '../app_focus_club/functions/package.json', '../app_focus_club/functions/package-lock.json',
    'docs/despliegue-integrado-aforo-devoluciones.md', 'release/auditoria-historica.md', 'release/test-results.json']) inputs.push({ path: file, sha256: hash(fs.readFileSync(path.resolve(root, file))) });
  const mobile = /version:\s*([^\s+]+)\+(\d+)/.exec(fs.readFileSync(path.resolve(root, '../app_focus_club/pubspec.yaml'), 'utf8'));
  const manifest = { schema: 'focus-coordinated-release-v1', projectId: project, releaseId: RELEASE_ID, maxFunctionBatchSize: 5,
    mobile: { version: mobile[1], build: Number(mobile[2]), storesVerified: false },
    webFunctions: web, portalFunctions: ['deleteOwnAccount'], batches: Array.from({ length: Math.ceil(web.length / 5) }, (_, i) => web.slice(i * 5, i * 5 + 5)),
    inputs, bootstrap: { captured: false, artifacts: [], webFunctions: [] },
  };
  const previousManifest = fs.existsSync(path.join(output, 'manifest.json')) ? readJson(path.join(output, 'manifest.json')) : undefined;
  if (flag('--repair-portal-bootstrap')) {
    if (!flag('--offline') || !previousManifest?.bootstrap?.captured) throw new Error('La reparación exige --offline y la captura existente.');
    const { manifestHash, ...body } = previousManifest;
    if (hash(JSON.stringify(body)) !== manifestHash) throw new Error('La huella del manifiesto anterior no coincide.');
  }
  if (!flag('--offline') && !previousManifest?.bootstrap?.captured) {
    const { db, credential } = await initialize(project);
    try {
      const deployed = (await deployedFunctions(credential, project)).filter((fn) => web.includes(fn.name.split('/').at(-1)) || fn.name.endsWith('/deleteOwnAccount'));
      const groups = new Map();
      for (let start = 0; start < deployed.length; start += 5) {
        const page = deployed.slice(start, start + 5);
        const sources = await Promise.all(page.map(async (fn) => {
          const source = fn.buildConfig?.source?.storageSource;
          if (fn.state !== 'ACTIVE' || !source || fn.buildConfig.runtime !== 'nodejs22') throw new Error(`Función no preparada para capturar: ${fn.name}`);
          const bytes = await googleGet(credential, `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, true);
          return { fn, files: zipFiles(bytes), source };
        }));
        for (const item of sources) {
          const digest = hash([...item.files].sort(([a],[b]) => a.localeCompare(b)).map(([name, data]) => `${name}:${hash(data)}`).join('\n'));
          if (!groups.has(digest)) groups.set(digest, { files: item.files, functions: [], sourceVersions: [] });
          const group = groups.get(digest);
          group.functions.push(item.fn.name.split('/').at(-1));
          group.sourceVersions.push({ name: item.fn.name, updateTime: item.fn.updateTime, source: item.source });
        }
      }
      for (const [digest, group] of groups) {
        const folder = path.join(output, 'bootstrap', digest.slice(0, 20)), functionsFolder = path.join(folder, 'functions');
        if (fs.existsSync(folder)) throw new Error(`Ya existe ${folder}. Conserva la captura y usa --refresh-manifest para actualizar solo el manifiesto.`);
        for (const [name, data] of group.files) {
          const target = path.resolve(functionsFolder, name);
          if (!target.startsWith(functionsFolder + path.sep)) throw new Error('Ruta de extracción fuera del artefacto.');
          fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data, { flag: 'wx' });
        }
        const portal = group.functions.includes('deleteOwnAccount');
        if (portal && group.functions.length !== 1) throw new Error('Codebases mezclados en una captura.');
        const entry = path.join(functionsFolder, 'src/index.ts');
        const wrapped = wrapBootstrap(fs.readFileSync(entry, 'utf8'));
        fs.writeFileSync(entry, portal ? specializePortalBootstrap(wrapped).source : wrapped);
        const maintenance = fs.readFileSync(path.join(root, 'functions/src/releaseMaintenance.ts'), 'utf8').replace('REQUIRE_OCCUPANCY_V2 = true', 'REQUIRE_OCCUPANCY_V2 = false');
        fs.writeFileSync(path.join(functionsFolder, 'src/releaseMaintenance.ts'), maintenance);
        writeJson(path.join(folder, 'firebase.json'), { functions: { source: 'functions', ...(portal ? { codebase: 'portal' } : {}) } });
        manifest.bootstrap.artifacts.push({ config: path.relative(root, path.join(folder, 'firebase.json')).replaceAll('\\','/'), functions: group.functions.sort(), portal, originalSourceHash: digest, sourceVersions: group.sourceVersions });
      }
      const release = await googleGet(credential, `https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
      const ruleset = await googleGet(credential, `https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
      const originalRules = ruleset.source.files.find((file) => file.name.endsWith('.rules'))?.content;
      if (!originalRules) throw new Error('No se han podido acreditar las reglas de producción.');
      fs.mkdirSync(path.join(output, 'bootstrap'), { recursive: true });
      fs.writeFileSync(path.join(output, 'bootstrap/firestore.rules'), maintenanceRules(originalRules), { flag: 'wx' });
      fs.writeFileSync(path.join(output, 'bootstrap/previous-firestore.rules'), originalRules, { flag: 'wx' });
      writeJson(path.join(output, 'bootstrap/firebase.json'), { firestore: { database: '(default)', rules: 'firestore.rules' } });
      manifest.bootstrap.captured = true;
      manifest.bootstrap.webFunctions = manifest.bootstrap.artifacts.filter((item) => !item.portal).flatMap((item) => item.functions).sort();
      manifest.bootstrap.rulesetName = release.rulesetName;
      console.log(`Capturadas ${deployed.length} Functions en ${groups.size} artefactos compatibles. Ninguna escritura remota.`);
    } finally { await db.terminate(); }
  } else if (previousManifest?.bootstrap?.captured) {
    manifest.bootstrap = previousManifest.bootstrap;
  }
  if (flag('--repair-portal-bootstrap')) {
    repairPortalBootstrap(previousManifest);
    console.log('Paquete portal reparado y descubierto sin secretos. Los otros paquetes se conservan. Ninguna lectura o escritura remota.');
  }
  if (!flag('--repair-portal-bootstrap') && !flag('--skip-bootstrap-build')) for (const artifact of manifest.bootstrap.artifacts) {
    const folder = path.resolve(root, path.dirname(artifact.config), 'functions');
    fs.writeFileSync(path.join(folder,'src/releaseMaintenance.ts'),fs.readFileSync(path.join(root,'functions/src/releaseMaintenance.ts'),'utf8').replace('REQUIRE_OCCUPANCY_V2 = true','REQUIRE_OCCUPANCY_V2 = false'));
    const lock = path.join(folder, 'package-lock.json');
    const candidates = [path.join(root, 'functions'), path.resolve(root, '../app_focus_club/functions')];
    if (!fs.existsSync(path.join(folder, 'node_modules'))) {
      const cached = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'node_modules')) && fs.existsSync(lock) && hash(fs.readFileSync(lock)) === hash(fs.readFileSync(path.join(candidate, 'package-lock.json'))));
      if (cached) fs.symlinkSync(path.join(cached, 'node_modules'), path.join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      else {
        const install = process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ci --ignore-scripts'], { cwd: folder, encoding: 'utf8' }) : spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: folder, encoding: 'utf8' });
        if (install.status !== 0) throw new Error(`No se han podido instalar las dependencias de ${artifact.config}.`);
      }
    }
    const compiler = path.join(folder, 'node_modules/typescript/bin/tsc');
    const build = spawnSync(process.execPath, [compiler], { cwd: folder, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`Bootstrap no compila: ${artifact.config}\n${build.stdout}\n${build.stderr}`);
    artifact.compiled = true;
  }
  // Bootstrap files are immutable inputs too; include them in the operator checks.
  inventory(path.join(output, 'bootstrap'), 'release/bootstrap', manifest.inputs);
  manifest.manifestHash = hash(JSON.stringify(manifest));
  writeJson(path.join(output, 'manifest.json'), manifest, false);
  console.log(`Manifiesto local preparado: ${web.length} Functions compartidas, tandas de 5 y build móvil ${manifest.mobile.build}.`);
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { zipFiles, wrapBootstrap, maintenanceRules, inventory, RELEASE_ID, main };
