#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { fs, path, root, hash, readJson, writeJson } = require('./release-common.cjs');
const { inventory } = require('./prepare-coordinated-release.cjs');
const { PHASE, TARGETS, remainingArtifacts } = require('./remaining-selective.cjs');
const releaseRoot = 'release/remaining-selective';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Cambió el punto de edición revisado en la captura.');
  return source.replace(before, () => after);
}

function editPackage(folder, name) {
  const maintenance = path.join(folder, 'src/releaseMaintenance.ts');
  const entry = path.join(folder, 'src/index.ts');
  fs.writeFileSync(maintenance, replaceOnce(fs.readFileSync(maintenance, 'utf8'),
    'export const REQUIRE_OCCUPANCY_V2 = false;', 'export const REQUIRE_OCCUPANCY_V2 = true;'));
  fs.writeFileSync(entry, replaceOnce(fs.readFileSync(entry, 'utf8'),
    'focus_phase: "bootstrap"', `focus_phase: "${PHASE}"`));
  if (name === 'updateMaxCapacityFromAdmin') {
    const file = path.join(folder, 'src/capacityExceptions.ts');
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('  async function updateMaxCapacityFromAdmin(');
    if (start < 0) throw new Error('Falta la actualización de aforo global.');
    fs.writeFileSync(file, 'import { assertMaintenanceTransaction } from "./releaseMaintenance.js";\n' + source.slice(0, start)
      + replaceOnce(source.slice(start), 'return db.runTransaction(async (transaction) => {',
        'return db.runTransaction(async (transaction) => {\n      await assertMaintenanceTransaction(transaction, db);'));
  }
  const packagePath = path.join(folder, 'package.json');
  writeJson(packagePath, { ...readJson(packagePath), main: 'entry.cjs' }, false);
  fs.writeFileSync(path.join(folder, 'entry.cjs'), `const { ${name} } = require('./lib/index.js');\nmodule.exports = { ${name} };\n`, { flag: 'wx' });
}

function prepare() {
  const manifestPath = path.join(root, 'release/manifest.json');
  const { manifestHash, ...manifest } = readJson(manifestPath);
  if (manifest.projectId !== 'focus-club-f73b8' || manifest.schema !== 'focus-coordinated-release-v1'
    || hash(JSON.stringify(manifest)) !== manifestHash || !manifest.bootstrap?.captured || !manifest.occupancySelective) {
    throw new Error('Falta el manifiesto íntegro de la publicación anterior.');
  }
  const previous = remainingArtifacts(manifest);
  const artifacts = [];
  const inputs = [];
  const modules = path.join(root, 'functions/node_modules');
  const lock = hash(fs.readFileSync(path.join(root, 'functions/package-lock.json')));
  const compiler = path.join(modules, 'typescript/bin/tsc');
  const builder = hash(fs.readFileSync(__filename));
  for (const name of Object.keys(TARGETS)) {
    const base = manifest.bootstrap.artifacts.find(item => !item.portal && item.compiled && item.functions.includes(name));
    if (!base || !/^release\/bootstrap\/[a-f0-9]{20}\/firebase\.json$/.test(base.config)) throw new Error(`Falta la captura de ${name}.`);
    const prefix = path.posix.dirname(base.config) + '/functions/';
    const files = manifest.inputs.filter(({ path: file }) => file.startsWith(prefix)
      && (/^src\//.test(file.slice(prefix.length)) || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(file.slice(prefix.length))));
    if (!files.some(i => i.path === prefix + 'src/index.ts') || !files.some(i => i.path === prefix + 'package-lock.json' && i.sha256 === lock)) {
      throw new Error(`La captura o las dependencias de ${name} no coinciden.`);
    }
    for (const file of files) {
      if (hash(fs.readFileSync(path.join(root, file.path))) !== file.sha256) throw new Error(`Captura alterada: ${file.path}.`);
    }
    const relative = releaseRoot + '/' + hash(JSON.stringify({ name, files, builder })).slice(0, 20);
    const config = relative + '/firebase.json';
    const folder = path.join(root, relative, 'functions');
    if (fs.existsSync(path.join(root, relative))) {
      if (previous.get(name)?.config !== config) throw new Error(`Directorio de paquete no acreditado: ${relative}.`);
      const inputConfig = manifest.inputs.find(input => input.path === config);
      const checked = [inputConfig, ...previous.get(name).inputs];
      for (const input of checked) if (!input || hash(fs.readFileSync(path.join(root, input.path))) !== input.sha256) {
        throw new Error(`El paquete de ${name} tiene archivos alterados.`);
      }
      const found = [];
      inventory(path.join(root, relative), relative, found, true);
      if (found.length !== checked.length || found.some(item => !checked.some(x => x.path === item.path))) {
        throw new Error(`El paquete de ${name} tiene archivos ajenos.`);
      }
    } else {
      for (const file of files) {
        const destination = path.resolve(folder, file.path.slice(prefix.length));
        if (!destination.startsWith(folder + path.sep)) throw new Error('Ruta de captura fuera del paquete.');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file.path), destination, fs.constants.COPYFILE_EXCL);
      }
      editPackage(folder, name);
      fs.symlinkSync(modules, path.join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const build = spawnSync(process.execPath, [compiler], { cwd: folder, encoding: 'utf8' });
      if (build.status !== 0) throw new Error(`No se pudo compilar ${name}:\n${build.stdout ?? ''}${build.stderr ?? ''}`);
      writeJson(path.join(root, config), { functions: { source: 'functions', ignore: ['node_modules'] } });
    }
    artifacts.push({ name, config, baseConfig: base.config });
    inventory(path.join(root, relative), relative, inputs, true);
  }
  const local = [
    'scripts/prepare-remaining-selective.cjs', 'scripts/remaining-selective.cjs', 'scripts/remaining-preflight.cjs', 'scripts/functions-resume.cjs',
    'scripts/release-controls.cjs', 'scripts/prepare-coordinated-release.cjs', 'scripts/deploy-release.ps1',
    'scripts/retired-operations.cjs', 'scripts/reconcile-slot-occupancy.cjs', 'scripts/occupancy-count-backup.cjs',
    'functions/src/slotOccupancyCounts.ts', 'functions/lib/slotOccupancyCounts.js',
  ].filter(file => fs.existsSync(path.join(root, file))).map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
  const refreshed = new Map(local.map(input => [input.path, input]));
  manifest.inputs = manifest.inputs.filter(input => !input.path.startsWith(releaseRoot + '/')).map(input => {
    const updated = refreshed.get(input.path);
    refreshed.delete(input.path);
    return updated ?? input;
  });
  manifest.inputs.push(...refreshed.values(), ...inputs);
  manifest.remainingSelective = { schema: 'focus-remaining-selective-v1', artifacts };
  remainingArtifacts(manifest);
  writeJson(manifestPath, { ...manifest, manifestHash: hash(JSON.stringify(manifest)) }, false);
  return artifacts;
}

if (require.main === module) {
  try { console.log(JSON.stringify(prepare(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
