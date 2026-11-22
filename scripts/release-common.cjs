const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const requireFunctions = createRequire(path.join(root, 'functions/package.json'));
const sdk = requireFunctions('firebase-admin/firestore');
const appSdk = requireFunctions('firebase-admin/app');
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(name);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value, exclusive = true) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' });
}
function readonlyFirestore() {
  const runTransaction = sdk.Firestore.prototype.runTransaction;
  Object.defineProperty(sdk.Firestore.prototype, 'runTransaction', {
    value(callback, options) {
      if (options?.readOnly !== true) throw new Error('Read-only: runTransaction requires readOnly: true');
      return runTransaction.call(this, callback, { readOnly: true, ...(options.readTime ? { readTime: options.readTime } : {}) });
    }, configurable: false, writable: false,
  });
  for (const [prototype, methods] of [
    [sdk.DocumentReference.prototype, ['set', 'update', 'delete', 'create']],
    [sdk.CollectionReference.prototype, ['add']],
    [sdk.Transaction.prototype, ['set', 'update', 'delete', 'create']],
    [sdk.WriteBatch.prototype, ['set', 'update', 'delete', 'create', 'commit']],
    [sdk.BulkWriter.prototype, ['set', 'update', 'delete', 'create', 'flush', 'close']],
    [sdk.Firestore.prototype, ['batch', 'bulkWriter', 'recursiveDelete']],
  ]) for (const method of methods) Object.defineProperty(prototype, method, {
    value() { throw new Error(`Read-only: ${method} is disabled`); }, configurable: false, writable: false,
  });
}
async function credential() {
  const adc = appSdk.applicationDefault();
  try { await adc.getAccessToken(); return adc; } catch (error) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) throw error;
  }
  // Reuse the operator's Firebase CLI identity without printing or exporting tokens.
  const candidates = [process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'),
    '/usr/local/lib/node_modules/firebase-tools/lib/auth.js', '/opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js'].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error('Configura credenciales ADC o GOOGLE_APPLICATION_CREDENTIALS. No se ha escrito en producción.');
  const auth = require(file);
  const api = require(path.join(path.dirname(file), 'api.js'));
  const account = auth.getProjectDefaultAccount(root);
  if (!account?.tokens?.refresh_token) throw new Error('No hay identidad administrativa. Ejecuta firebase login o configura ADC.');
  return { sdkCredential: appSdk.applicationDefault(), firestoreCredentials: {
    type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
  }, async getAccessToken() {
    const result = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']);
    return { access_token: result.access_token, expires_in: result.expires_in ?? 3600 };
  } };
}
async function initialize(projectId) {
  if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId)) throw new Error('Es obligatorio indicar un proyecto válido.');
  if (process.env.FIRESTORE_EMULATOR_HOST && !projectId.startsWith('demo-')) throw new Error('El emulador requiere un proyecto demo-*.');
  const cred = process.env.FIRESTORE_EMULATOR_HOST ? undefined : await credential();
  const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp({ projectId, ...(cred ? { credential: cred.sdkCredential ?? cred } : {}) });
  const db = sdk.getFirestore(app);
  if (cred?.firestoreCredentials) db.settings({ credentials: cred.firestoreCredentials });
  return { db, credential: cred };
}
async function googleGet(cred, url, binary = false) {
  const token = await cred.getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!response.ok) throw new Error(`Lectura de Google rechazada (${response.status}): ${new URL(url).pathname}`);
  return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
}
async function deployedFunctions(cred, projectId) {
  let pageToken;
  const result = [];
  do {
    const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const response = await googleGet(cred, `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions${query}`);
    result.push(...(response.functions ?? []));
    pageToken = response.nextPageToken;
  } while (pageToken);
  return result;
}
function assertManifest(manifest) {
  if (manifest.schema !== 'focus-coordinated-release-v1' || manifest.projectId !== 'focus-club-f73b8' || manifest.maxFunctionBatchSize !== 5) throw new Error('Manifiesto incompatible.');
  const { manifestHash, ...body } = manifest;
  if (hash(JSON.stringify(body)) !== manifestHash) throw new Error('La huella del manifiesto no coincide. Regenerarlo.');
  for (const input of manifest.inputs) {
    if (hash(fs.readFileSync(path.resolve(root, input.path))) !== input.sha256) throw new Error(`Artefacto modificado: ${input.path}`);
  }
}
module.exports = { fs, path, root, requireFunctions, sdk, arg, flag, hash, readJson, writeJson, readonlyFirestore, initialize, googleGet, deployedFunctions, assertManifest };
