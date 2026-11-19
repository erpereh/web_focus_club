const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { specializePortalBootstrap } = require('../../scripts/portal-bootstrap-repair.cjs');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/portal-bootstrap-index.ts.txt'), 'utf8');
const repaired = specializePortalBootstrap(fixture);
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }

function runtime({ phase = 'open', count = 1, profile = true, failAvatars = false, holdUserRead = false } = {}) {
  const docs = new Map([['system_controls/release', { phase }]]), calls = [], batches = [];
  if (profile) docs.set('users/u1', { name: 'Cliente', email: 'profile@example.com' });
  docs.set('users/u1/notifications/n1', { type: 'notice' });
  docs.set('users/u1/fcmTokens/t1', { token: 'opaque' });
  for (let i = 0; i < count; i++) docs.set(`appointments/a${i}`, { userId: 'u1', status: 'approved', duration: '60', name: 'Cliente', email: 'profile@example.com', phone: '123', reason: 'private' });
  docs.set('appointments/other', { userId: 'u2', name: 'Other' });
  docs.set('bonos/b1', { userId: 'u1', minutosRestantes: 120, minutosTotales: 240, historial: [{ descripcion: 'Private', minutos: 60, tipo: 'descuento' }, { minutos: 30 }, null] });
  docs.set('minute_refunds/r1', { userId: 'u1', pendingMinutes: 60 });
  let releaseRead; const waiting = new Promise(resolve => { releaseRead = resolve; });
  const ref = key => ({ path: key,
    async get() { calls.push('read:' + key); if (holdUserRead && key === 'users/u1') await waiting; return { data: () => docs.get(key) }; },
    async delete() { calls.push('delete:' + key); docs.delete(key); },
  });
  const db = {
    collection(name) { return { doc: id => ref(`${name}/${id}`),
      where: (field, operator, value) => ({ get: async () => { calls.push('query:' + name); return { docs: [...docs].filter(([key, data]) => key.startsWith(name + '/') && key.split('/').length === 2 && data[field] === value).map(([key, data]) => ({ ref: ref(key), data: () => data })) }; } }),
      async add(data) { calls.push('log'); docs.set('activity_logs/new', data); },
    }; },
    async runTransaction(action) { return action({ get: async reference => ({ data: () => docs.get(reference.path) }), create(reference, data) { calls.push('admit'); docs.set(reference.path, data); } }); },
    batch() { const updates = []; return { update(reference, data) { updates.push([reference.path, data]); }, async commit() { batches.push(updates.length); for (const [key, data] of updates) docs.set(key, { ...docs.get(key), ...data }); } }; },
    async recursiveDelete(reference) { calls.push('recursiveDelete'); for (const key of [...docs.keys()]) if (key === reference.path || key.startsWith(reference.path + '/')) docs.delete(key); },
  };
  const stubs = {
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, handler) => handler },
    'firebase-functions/logger': { info() {} },
    'firebase-functions/v2': { setGlobalOptions() {} },
    'firebase-admin/app': { initializeApp() {} },
    'firebase-admin/auth': { getAuth: () => ({ async deleteUser(uid) { calls.push('auth:' + uid); } }) },
    'firebase-admin/firestore': { getFirestore: () => db },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ async deleteFiles(options) { calls.push('avatars:' + options.prefix); if (failAvatars) throw new Error('avatars failed'); } }) }) },
  };
  function load(source) {
    const exports = {};
    new vm.Script(transpile(source)).runInNewContext({ exports, require: name => { if (name in stubs) return stubs[name]; if (name.startsWith('node:')) return require(name); throw new Error('Unexpected dependency: ' + name); }, console });
    return exports;
  }
  stubs['./releaseMaintenance.js'] = load(fs.readFileSync(path.resolve(__dirname, '../src/releaseMaintenance.ts'), 'utf8').replace('REQUIRE_OCCUPANCY_V2 = true', 'REQUIRE_OCCUPANCY_V2 = false'));
  return { docs, calls, batches, handler: load(repaired.source).deleteOwnAccount, releaseRead };
}
const request = { auth: { uid: 'u1', token: { email: 'token@example.com' } } };

test('repair retains the exact declaration texts and exports only captured deleteOwnAccount', () => {
  const before = ts.createSourceFile('before.ts', fixture, 99, true), after = ts.createSourceFile('after.ts', repaired.source, 99, true);
  for (const statement of after.statements.filter(statement => !ts.isImportDeclaration(statement))) {
    assert.ok(before.statements.some(original => original.getText(before) === statement.getText(after)));
  }
  assert.doesNotMatch(repaired.source, /MAKE_|defineSecret|approveAppointment|onSchedule|guardBackground/);
  assert.match(repaired.source, /guardCallable\(db, "deleteOwnAccount", handleDeleteOwnAccount\)/);
  assert.equal((repaired.source.match(/export const/g) ?? []).length, 1);
  assert.equal(specializePortalBootstrap(repaired.source).source, repaired.source);
});
for (const [name, input] of [
  ['missing maintenance wrapper', fixture.replace('guardCallable(db, "deleteOwnAccount", handleDeleteOwnAccount)', 'handleDeleteOwnAccount')],
  ['unknown global effect', fixture + '\nstartLegacyWorker();'],
  ['changed deployment phase', fixture.replace('focus_phase: "bootstrap"', 'focus_phase: "final"')],
]) test(`repair refuses ${name}`, () => assert.throws(() => specializePortalBootstrap(input)));
test('account deletion preserves anonymity, economic amounts, other users and immutable refund debt', async () => {
  const r = runtime(); const result = await r.handler(request); assert.equal(result.ok, true);
  const appointment = r.docs.get('appointments/a0'); assert.equal(appointment.name, 'Usuario eliminado'); assert.equal(appointment.email, ''); assert.equal(appointment.reason, ''); assert.equal(appointment.status, 'approved');
  const bono = r.docs.get('bonos/b1'); assert.equal(bono.minutosRestantes, 120); assert.equal(bono.minutosTotales, 240); assert.equal(bono.historial[0].minutos, 60); assert.equal(bono.historial[0].descripcion, 'Historial anonimizado por eliminación de cuenta'); assert.equal(bono.historial[1].minutos, 30); assert.equal(bono.historial[2], null);
  assert.equal(r.docs.get('appointments/other').name, 'Other'); assert.equal(r.docs.get('minute_refunds/r1').pendingMinutes, 60);
  assert.equal([...r.docs.keys()].some(key => key.startsWith('users/u1')), false);
  assert.equal(r.docs.get('activity_logs/new').email, 'profile@example.com');
  assert.ok(r.calls.indexOf('avatars:user-avatars/u1/') < r.calls.indexOf('recursiveDelete'));
  assert.ok(r.calls.indexOf('recursiveDelete') < r.calls.indexOf('log')); assert.ok(r.calls.indexOf('log') < r.calls.indexOf('auth:u1'));
  assert.equal([...r.docs.keys()].some(key => key.startsWith('release_operations/')), false);
});
test('original 450-write batches are preserved for large accounts', async () => {
  const r = runtime({ count: 901 }); await r.handler(request); assert.deepEqual(r.batches, [450, 450, 1, 1]);
});
test('missing profile keeps the original token email fallback', async () => {
  const r = runtime({ profile: false, count: 0 }); await r.handler(request); assert.equal(r.docs.get('activity_logs/new').email, 'token@example.com');
});
test('unauthenticated caller cannot begin destructive work and does not strand a lease', async () => {
  const r = runtime(); await assert.rejects(r.handler({}), error => error.code === 'unauthenticated');
  assert.equal(r.calls.some(call => call.startsWith('query:') || call === 'recursiveDelete' || call.startsWith('auth:')), false);
  assert.equal([...r.docs.keys()].some(key => key.startsWith('release_operations/')), false);
});
for (const phase of ['draining', 'frozen']) test(`${phase} blocks old-app account deletion before any account read or destructive operation`, async () => {
  const r = runtime({ phase }); await assert.rejects(r.handler(request), error => error.code === 'unavailable' && error.details.reason === 'maintenance');
  assert.deepEqual(r.calls, []); assert.ok(r.docs.has('users/u1'));
});
test('an admitted deletion retains its active lease if maintenance closes during work', async () => {
  const r = runtime({ holdUserRead: true }); const pending = r.handler(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...r.docs.keys()].filter(key => key.startsWith('release_operations/')).length, 1);
  r.docs.set('system_controls/release', { phase: 'draining' }); r.releaseRead(); await pending;
  assert.equal([...r.docs.keys()].filter(key => key.startsWith('release_operations/')).length, 0);
});
test('failure retains the Auth account, propagates and completes the admitted operation', async () => {
  const r = runtime({ failAvatars: true }); await assert.rejects(r.handler(request), /avatars failed/);
  assert.ok(r.docs.has('users/u1')); assert.equal(r.calls.includes('auth:u1'), false);
  assert.equal([...r.docs.keys()].some(key => key.startsWith('release_operations/')), false);
});
