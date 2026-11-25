#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const c = require('./release-common.cjs');
const { TARGETS, SELECTIVE_PHASE, selectiveArtifacts } = require('./occupancy-selective.cjs');
const { inventory } = require('./prepare-coordinated-release.cjs');
const { fs, path, root, hash, readJson, writeJson } = c;
const releaseRoot = 'release/occupancy-selective';

function replaceOnce(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`La captura ya no tiene el punto de cambio revisado: ${file}.`);
  fs.writeFileSync(file, source.replace(before, () => after));
}

function editPackage(folder, name) {
  const file = basename => path.join(folder, 'src', basename + '.ts');
  const transactionImport = 'import { runAppointmentTransaction } from "./appointmentTransaction.js";\n';
  fs.copyFileSync(path.join(root, 'functions/src/appointmentTransaction.ts'), file('appointmentTransaction'));
  replaceOnce(file('slotOccupancy'), 'export interface OccupancyAppointmentLike',
    'export function occupiesCapacity(status: unknown): boolean {\n  return status === "pending" || status === "approved";\n}\n\nexport interface OccupancyAppointmentLike');
  replaceOnce(file('releaseMaintenance'), 'export const REQUIRE_OCCUPANCY_V2 = false;', 'export const REQUIRE_OCCUPANCY_V2 = true;');
  replaceOnce(file('index'), 'focus_phase: "bootstrap"', `focus_phase: "${SELECTIVE_PHASE}"`);

  if (name === 'createRecurringAppointmentsFromAdmin') {
    const source = fs.readFileSync(file('recurringSeries'), 'utf8');
    const start = source.indexOf('    createRecurringAppointmentsFromAdmin:');
    const end = source.indexOf('\n    createRecurringAppointments:', start + 1);
    const before = 'const result = await db.runTransaction(async (transaction) => {';
    const adminCreate = source.slice(start, end);
    if (start < 0 || end < 0 || adminCreate.split(before).length !== 2) throw new Error('Cambió la creación recurrente capturada.');
    fs.writeFileSync(file('recurringSeries'), transactionImport + source.slice(0, start)
      + adminCreate.replace(before, 'const result = await runAppointmentTransaction(db, async (transaction) => {') + source.slice(end));
  } else if (name === 'deleteAppointmentsFromAdmin') {
    replaceOnce(file('adminAppointmentRuntime'), '() => db.runTransaction(async (transaction) => {',
      '() => runAppointmentTransaction(db, async (transaction) => {');
    fs.writeFileSync(file('adminAppointmentRuntime'), transactionImport + fs.readFileSync(file('adminAppointmentRuntime'), 'utf8'));
  } else {
    const source = fs.readFileSync(file('index'), 'utf8');
    const start = source.indexOf('export const updateOwnAppointmentSlot =');
    const end = source.indexOf('\nexport const ', start + 1);
    if (start < 0 || end < 0) throw new Error('No se encontró el método de cambio de cita capturado.');
    const original = source.slice(start, end);
    const checks = [
      ['{ region: REGION }', '{ region: REGION, memory: "512MiB", cpu: 1, concurrency: 1, maxInstances: 5, timeoutSeconds: 60 }'],
      ['await db.runTransaction(async (transaction) => {', 'await runAppointmentTransaction(db, async (transaction) => {'],
      ['const ownApprovedKeys = appointment.status === "approved" ? appointmentSlotKeys(appointment) : new Set<string>();',
        'const ownOccupancyKeys = appointmentSlotKeys(appointment);'],
      ['ownApprovedKeys.has(key), targetMaxCapacity)', 'ownOccupancyKeys.has(key), targetMaxCapacity)'],
    ];
    let result = original;
    for (const [before, after] of checks) {
      if (result.split(before).length !== 2) throw new Error('Cambió el contrato de la reprogramación capturada.');
      result = result.replace(before, after);
    }
    fs.writeFileSync(file('index'), transactionImport + source.slice(0, start) + result + source.slice(end));
  }

  const packagePath = path.join(folder, 'package.json');
  writeJson(packagePath, { ...readJson(packagePath), main: 'entry.cjs' }, false);
  fs.writeFileSync(path.join(folder, 'entry.cjs'),
    `const { ${name} } = require('./lib/index.js');\nmodule.exports = { ${name} };\n`, { flag: 'wx' });
}

function prepare(manifestPath = path.join(root, 'release/manifest.json')) {
  const previous = readJson(manifestPath);
  const { manifestHash, ...manifest } = previous;
  if (manifest.projectId !== 'focus-club-f73b8' || manifest.schema !== 'focus-coordinated-release-v1'
    || hash(JSON.stringify(manifest)) !== manifestHash || !manifest.bootstrap?.captured) {
    throw new Error('Se necesita el manifiesto íntegro y las capturas Bootstrap del proyecto.');
  }
  const localFiles = [
    'scripts/occupancy-selective.cjs', 'scripts/prepare-occupancy-selective.cjs', 'scripts/functions-resume.cjs',
    'scripts/release-common.cjs', 'scripts/release-controls.cjs', 'scripts/prepare-coordinated-release.cjs', 'scripts/deploy-release.ps1',
  ];
  const previousArtifacts = selectiveArtifacts(previous);
  const inputHashes = new Map();
  const artifacts = [];
  for (const name of Object.keys(TARGETS)) {
    const base = manifest.bootstrap.artifacts.find(a => !a.portal && a.compiled && a.functions.includes(name));
    if (!base || !/^release\/bootstrap\/[a-f0-9]{20}\/firebase\.json$/.test(base.config)) throw new Error(`Falta la captura de ${name}.`);
    const prefix = path.posix.dirname(base.config) + '/functions/';
    const baseFiles = manifest.inputs.filter(i => i.path.startsWith(prefix) && (/^src\//.test(i.path.slice(prefix.length))
      || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(i.path.slice(prefix.length))));
    if (!baseFiles.some(i => i.path === prefix + 'src/index.ts')) throw new Error(`Falta el código de la captura de ${name}.`);
    for (const input of baseFiles) {
      if (hash(fs.readFileSync(path.join(root, input.path))) !== input.sha256) throw new Error(`Captura alterada: ${input.path}.`);
    }
    const id = hash(JSON.stringify({
      name, baseFiles, builder: hash(fs.readFileSync(__filename)),
      transactor: hash(fs.readFileSync(path.join(root, 'functions/src/appointmentTransaction.ts'))),
    })).slice(0, 20);
    const relative = `${releaseRoot}/${id}`;
    const config = `${relative}/firebase.json`;
    const folder = path.join(root, relative, 'functions');
    const alreadyReviewed = previousArtifacts.get(name);
    if (fs.existsSync(path.join(root, relative))) {
      if (alreadyReviewed?.config !== config) throw new Error(`Directorio local inesperado: ${relative}.`);
      for (const input of manifest.inputs.filter(i => i.path.startsWith(relative + '/'))) {
        if (hash(fs.readFileSync(path.join(root, input.path))) !== input.sha256) throw new Error(`Paquete alterado: ${input.path}.`);
      }
    } else {
      const localModules = path.join(root, 'functions/node_modules');
      if (hash(fs.readFileSync(path.join(root, prefix, 'package-lock.json'))) !== hash(fs.readFileSync(path.join(root, 'functions/package-lock.json')))
        || !fs.existsSync(path.join(localModules, 'typescript/bin/tsc'))) {
        throw new Error(`Las dependencias instaladas no coinciden con la captura. Revisar ${name}.`);
      }
      for (const input of baseFiles) {
        const destination = path.resolve(folder, input.path.slice(prefix.length));
        if (!destination.startsWith(folder + path.sep)) throw new Error('Ruta de captura fuera del paquete.');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, input.path), destination, fs.constants.COPYFILE_EXCL);
      }
      editPackage(folder, name);
      fs.symlinkSync(localModules, path.join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const build = spawnSync(process.execPath, [path.join(localModules, 'typescript/bin/tsc')], { cwd: folder, encoding: 'utf8' });
      if (build.status !== 0) throw new Error(`Paquete ${name} no compilado:\n${build.stdout ?? ''}${build.stderr ?? ''}`);
      writeJson(path.join(root, config), { functions: { source: 'functions', ignore: ['node_modules'] } });
    }
    artifacts.push({ name, config, baseConfig: base.config });
    const inputs = [];
    inventory(path.join(root, relative), relative, inputs, true);
    for (const input of inputs) inputHashes.set(input.path, input.sha256);
  }
  for (const file of localFiles) inputHashes.set(file, hash(fs.readFileSync(path.join(root, file))));
  manifest.inputs = manifest.inputs.filter(input => !input.path.startsWith(releaseRoot + '/') && !inputHashes.has(input.path));
  manifest.inputs.push(...[...inputHashes].map(([path, sha256]) => ({ path, sha256 })));
  manifest.occupancySelective = { schema: 'focus-occupancy-selective-v1', artifacts };
  selectiveArtifacts(manifest);
  writeJson(manifestPath, { ...manifest, manifestHash: hash(JSON.stringify(manifest)) }, false);
  return artifacts;
}

if (require.main === module) {
  try { console.log(JSON.stringify(prepare(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
