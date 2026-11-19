// Local-only repair of the captured portal package. Never reads or writes production.
const { spawnSync } = require('node:child_process');
const c = require('./release-common.cjs');
const ts = c.requireFunctions('typescript');
const REPAIR_ID = 'portal-delete-own-account-without-legacy-make-v1';
const SOURCE_HASH = 'feaf41d65ada677f809c84bd595837fc5714346817e1e59dbabff8db1ca9db97';

function specializePortalBootstrap(source) {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error('La captura portal no es TypeScript válido.');
  const declarations = new Map(), effects = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isExpressionStatement(statement)) {
      const call = statement.expression;
      if (!ts.isCallExpression(call) || !['initializeApp', 'setReleaseOptions'].includes(call.expression.getText(file))) {
        throw new Error('Efecto global portal no revisado.');
      }
      effects.push(statement); continue;
    }
    const name = ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      ? statement.declarationList.declarations[0].name : statement.name;
    if (!name || !ts.isIdentifier(name) || declarations.has(name.text)) throw new Error('Declaración portal no revisada.');
    declarations.set(name.text, statement);
  }
  const entry = declarations.get('deleteOwnAccount');
  if (!entry || !/^export const deleteOwnAccount = onCall\(\{region\}, guardCallable\(db, "deleteOwnAccount", handleDeleteOwnAccount\)\);$/.test(entry.getText(file))) {
    throw new Error('El contrato o bloqueo de deleteOwnAccount ha cambiado.');
  }
  if (effects.length !== 2 || !effects.some(s => s.getText(file).includes('focus_phase: "bootstrap"'))) {
    throw new Error('Faltan la inicialización o las etiquetas Bootstrap.');
  }
  const identifiers = new Set(), retained = new Set();
  function visit(node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, visit);
  }
  effects.forEach(visit);
  const queue = ['deleteOwnAccount'];
  while (queue.length) {
    const name = queue.pop();
    if (retained.has(name)) continue;
    retained.add(name); visit(declarations.get(name));
    for (const dependency of identifiers) if (declarations.has(dependency) && !retained.has(dependency)) queue.push(dependency);
  }
  const imports = [];
  for (const statement of file.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.name) throw new Error('Importación portal no revisada.');
    const names = clause.namedBindings.elements.filter(element => identifiers.has(element.name.text));
    if (names.length) imports.push(`import ${clause.isTypeOnly ? 'type ' : ''}{ ${names.map(n => n.getText(file)).join(', ')} } from ${statement.moduleSpecifier.getText(file)};`);
  }
  const preservedDeclarations = [...retained].sort().map(name => ({ name, sha256: c.hash(declarations.get(name).getText(file)) }));
  const body = file.statements.filter(statement => effects.includes(statement) || [...retained].some(name => declarations.get(name) === statement));
  const result = imports.join('\n') + '\n\n' + body.map(statement => statement.getText(file)).join('\n\n') + '\n';
  if (/MAKE_|defineSecret|notifyMake|onSchedule|guardBackground/.test(result)) throw new Error('La reparación todavía contiene dependencias ajenas al borrado.');
  return { source: result, preservedDeclarations };
}

function inspectPortalPackage(folder) {
  const script = `const path=require('node:path');process.env.GCLOUD_PROJECT='demo-focus-bootstrap-inspection';
    const folder=process.argv[1];const {loadStack}=require(path.join(folder,'node_modules/firebase-functions/lib/runtime/loader.js'));
    loadStack(folder).then(stack=>process.stdout.write(JSON.stringify(stack))).catch(e=>{console.error(e.message);process.exitCode=1});`;
  const result = spawnSync(process.execPath, ['-e', script, folder], { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`No se puede descubrir el paquete portal: ${result.stderr}`);
  const stack = JSON.parse(result.stdout);
  const endpoint = stack.endpoints?.deleteOwnAccount;
  if (JSON.stringify(Object.keys(stack.endpoints ?? {})) !== '["deleteOwnAccount"]' || (stack.params ?? []).length
    || !endpoint?.callableTrigger || (endpoint.secretEnvironmentVariables ?? []).length
    || endpoint.labels?.focus_phase !== 'bootstrap' || JSON.stringify(endpoint.region) !== '["europe-west1"]') {
    throw new Error('El SDK descubre puntos de entrada o parámetros no autorizados en portal.');
  }
  return { endpoints: Object.keys(stack.endpoints), params: stack.params ?? [], secretBindings: endpoint.secretEnvironmentVariables ?? [] };
}

function repairPortalBootstrap(manifest) {
  const artifact = manifest.bootstrap.artifacts.find(item => item.originalSourceHash === SOURCE_HASH);
  if (!artifact?.portal || JSON.stringify(artifact.functions) !== '["deleteOwnAccount"]') throw new Error('No está la captura portal revisada.');
  const prefix = c.path.dirname(artifact.config) + '/functions/';
  const folder = c.path.resolve(c.root, prefix);
  const bootstrapInputs = manifest.inputs.filter(input => input.path.startsWith('release/bootstrap/'));
  for (const input of bootstrapInputs) if (c.hash(c.fs.readFileSync(c.path.resolve(c.root, input.path))) !== input.sha256) throw new Error(`Bootstrap modificado antes de reparar: ${input.path}`);
  const prior = artifact.amendments?.find(item => item.id === REPAIR_ID);
  if (prior) {
    for (const input of prior.afterInputs) if (c.hash(c.fs.readFileSync(c.path.resolve(c.root, input.path))) !== input.sha256) throw new Error('La reparación portal ha cambiado.');
    inspectPortalPackage(folder);
    return prior;
  }
  const beforeInputs = bootstrapInputs.filter(input => input.path.startsWith(prefix));
  const entry = c.path.join(folder, 'src/index.ts');
  const result = specializePortalBootstrap(c.fs.readFileSync(entry, 'utf8'));
  const backup = c.path.join(c.root, 'release/test-logs', REPAIR_ID);
  const saved = new Map();
  for (const input of beforeInputs) saved.set(input.path.slice(prefix.length), c.fs.readFileSync(c.path.resolve(c.root, input.path)));
  for (const name of ['lib/index.js.map', 'lib/releaseMaintenance.js.map']) if (c.fs.existsSync(c.path.join(folder, name))) saved.set(name, c.fs.readFileSync(c.path.join(folder, name)));
  for (const [name, bytes] of saved) {
    const target = c.path.join(backup, name);
    c.fs.mkdirSync(c.path.dirname(target), { recursive: true });
    if (c.fs.existsSync(target)) {
      if (c.hash(c.fs.readFileSync(target)) !== c.hash(bytes)) throw new Error('La copia anterior de la reparación difiere.');
    } else c.fs.writeFileSync(target, bytes, { flag: 'wx' });
  }
  try {
    c.fs.writeFileSync(entry, result.source);
    const build = spawnSync(process.execPath, [c.path.join(folder, 'node_modules/typescript/bin/tsc')], { cwd: folder, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`La reparación portal no compila: ${build.stdout}\n${build.stderr}`);
    const discovery = inspectPortalPackage(folder);
    for (const input of bootstrapInputs.filter(input => !input.path.startsWith(prefix))) {
      if (c.hash(c.fs.readFileSync(c.path.resolve(c.root, input.path))) !== input.sha256) throw new Error(`Otro paquete Bootstrap ha cambiado: ${input.path}`);
    }
    const afterInputs = beforeInputs.map(input => ({ path: input.path, sha256: c.hash(c.fs.readFileSync(c.path.resolve(c.root, input.path))) }));
    const allowed = new Set([prefix + 'src/index.ts', prefix + 'lib/index.js']);
    if (afterInputs.some((input, index) => input.sha256 !== beforeInputs[index].sha256 && !allowed.has(input.path))) throw new Error('Se ha modificado otra dependencia del paquete portal.');
    const amendment = { id: REPAIR_ID, reason: 'Remove obsolete discovery-time Make dependency; preserve captured account deletion and maintenance.',
      originalSourceHash: artifact.originalSourceHash, beforeInputs, afterInputs, preservedDeclarations: result.preservedDeclarations, discovery };
    artifact.amendments = [...(artifact.amendments ?? []), amendment];
    artifact.compiled = true;
    c.writeJson(c.path.join(c.root, 'release/bootstrap-repair-audit.json'), amendment, false);
    return amendment;
  } catch (error) {
    for (const [name, bytes] of saved) c.fs.writeFileSync(c.path.join(folder, name), bytes);
    throw error;
  }
}

module.exports = { specializePortalBootstrap, inspectPortalPackage, repairPortalBootstrap, REPAIR_ID };
