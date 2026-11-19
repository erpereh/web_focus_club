// Read-only Firestore Admin API verification. The transport is injected so the
// complete verifier can be tested without credentials or a production project.
const API = 'https://firestore.googleapis.com/v1';
const SCOPES = new Set(['COLLECTION', 'COLLECTION_GROUP']);
const ORDERS = new Set(['ASCENDING', 'DESCENDING']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return isObject(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label}: se esperaba un objeto.`);
}
function supportedKeys(value, keys, label) {
  requireObject(value, label);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new Error(`${label}: opciones sin verificación implementada: ${unknown.join(', ')}.`);
}
function segment(value, label) {
  if (typeof value !== 'string' || !value || value.includes('/')) throw new Error(`${label}: identificador no válido.`);
  return value;
}
function fieldsOf(index, label) {
  if (!Array.isArray(index.fields) || !index.fields.length || index.fields.some((field) => !isObject(field)
    || typeof field.fieldPath !== 'string' || !field.fieldPath)) throw new Error(`${label}: campos no válidos.`);
  return index.fields;
}
function validateMode(field, label) {
  const modes = ['order', 'arrayConfig'].filter((mode) => Object.hasOwn(field, mode));
  if (modes.length !== 1 || (modes[0] === 'order' ? !ORDERS.has(field.order) : field.arrayConfig !== 'CONTAINS')) {
    throw new Error(`${label}: modo de indexación no válido.`);
  }
}
function validateIndex(index, label, composite) {
  supportedKeys(index, composite ? ['collectionGroup', 'queryScope', 'fields'] : ['queryScope', 'order', 'arrayConfig'], label);
  if (!SCOPES.has(index.queryScope)) throw new Error(`${label}: ámbito no válido.`);
  if (!composite) { validateMode(index, label); return; }
  segment(index.collectionGroup, label);
  const fields = fieldsOf(index, label);
  for (const field of fields) {
    supportedKeys(field, ['fieldPath', 'order', 'arrayConfig'], label);
    validateMode(field, label);
  }
  if (new Set(fields.map((field) => field.fieldPath)).size !== fields.length
    || fields.some((field, position) => field.fieldPath === '__name__' && (position !== fields.length - 1 || !field.order))) {
    throw new Error(`${label}: campos duplicados o __name__ no válido.`);
  }
}
function compositeKey(collectionGroup, index, implicitName = false) {
  const fields = [...fieldsOf(index, collectionGroup)];
  // Only the declared spec needs expansion. REST indexes must actually contain
  // __name__, including its direction; it must never be discarded on comparison.
  if (implicitName && fields.at(-1).fieldPath !== '__name__') {
    fields.push({ fieldPath: '__name__', order: fields.at(-1).order ?? 'ASCENDING' });
  }
  return canonical({ collectionGroup, queryScope: index.queryScope, fields,
    apiScope: index.apiScope ?? 'ANY_API', density: index.density ?? 'SPARSE_ALL',
    multikey: index.multikey ?? false, unique: index.unique ?? false });
}
function fieldIndexKey(index, fieldPath) {
  return canonical({ queryScope: index.queryScope, fields: index.fields ?? [{ fieldPath,
    ...(index.order ? { order: index.order } : { arrayConfig: index.arrayConfig }) }],
    apiScope: index.apiScope ?? 'ANY_API', density: index.density ?? 'SPARSE_ALL',
    multikey: index.multikey ?? false, unique: index.unique ?? false });
}
function validateSpec(spec) {
  supportedKeys(spec, ['indexes', 'fieldOverrides'], 'firestore.indexes.json');
  if (!Array.isArray(spec.indexes) || (spec.fieldOverrides !== undefined && !Array.isArray(spec.fieldOverrides))) {
    throw new Error('La definición de índices o fieldOverrides no es válida.');
  }
  const keys = new Set();
  for (const index of spec.indexes) {
    validateIndex(index, 'Índice compuesto', true);
    const key = compositeKey(index.collectionGroup, index, true);
    if (keys.has(key)) throw new Error('Índice compuesto duplicado en la definición.');
    keys.add(key);
  }
  const paths = new Set();
  for (const field of spec.fieldOverrides ?? []) {
    supportedKeys(field, ['collectionGroup', 'fieldPath', 'indexes'], 'Field override');
    segment(field.collectionGroup, 'Field override');
    if (typeof field.fieldPath !== 'string' || !field.fieldPath || !Array.isArray(field.indexes)) throw new Error('Field override no válido.');
    const key = `${field.collectionGroup}/${field.fieldPath}`;
    if (paths.has(key)) throw new Error(`Field override duplicado: ${key}.`);
    paths.add(key);
    const indexKeys = new Set();
    for (const index of field.indexes) {
      validateIndex(index, key, false);
      const signature = fieldIndexKey(index, field.fieldPath);
      if (indexKeys.has(signature)) throw new Error(`Índice de campo duplicado: ${key}.`);
      indexKeys.add(signature);
    }
  }
}

async function listCompositeIndexes(get, database) {
  const indexes = [], tokens = new Set();
  let token;
  do {
    // This API currently accepts only pageSize=0 (the default), unlike other
    // Google list APIs. A positive pageSize returns HTTP 400. Still follow every
    // returned token, and never turn a failed later page into a partial success.
    const result = await get(`${API}/${database}/collectionGroups/-/indexes${token ? '?pageToken=' + encodeURIComponent(token) : ''}`);
    requireObject(result, 'Respuesta de índices');
    if (result.indexes !== undefined && !Array.isArray(result.indexes)) throw new Error('Respuesta de índices no válida.');
    indexes.push(...(result.indexes ?? []));
    token = result.nextPageToken;
    if (token !== undefined && typeof token !== 'string') throw new Error('Token de paginación no válido.');
    if (token && tokens.has(token)) throw new Error('Token de paginación repetido; no se puede acreditar la lista completa.');
    if (token) tokens.add(token);
  } while (token);
  return indexes;
}

async function verifyFirestoreIndexes(get, project, spec) {
  validateSpec(spec);
  if (typeof project !== 'string' || !/^[a-z][a-z0-9-]+$/.test(project)) throw new Error('Proyecto no válido.');
  const database = `projects/${project}/databases/(default)`;
  const indexes = await listCompositeIndexes(get, database), actualByKey = new Map();
  for (const index of indexes) {
    requireObject(index, 'Índice remoto');
    const prefix = `${database}/collectionGroups/`;
    if (typeof index.name !== 'string' || !index.name.startsWith(prefix)) throw new Error('Índice remoto de otro proyecto o base de datos.');
    const parts = index.name.slice(prefix.length).split('/');
    if (parts.length !== 3 || !parts[0] || parts[1] !== 'indexes' || !parts[2]) throw new Error('Identidad de índice remoto no válida.');
    const key = compositeKey(parts[0], index);
    actualByKey.set(key, [...(actualByKey.get(key) ?? []), index.state]);
  }
  const issues = [];
  for (const index of spec.indexes) {
    const states = actualByKey.get(compositeKey(index.collectionGroup, index, true)) ?? [];
    if (!states.includes('READY')) issues.push(`${index.collectionGroup} [${index.queryScope}; ${index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(', ')}]: ${states.join(', ') || 'no encontrado'}`);
  }
  for (const field of spec.fieldOverrides ?? []) {
    const resource = `${database}/collectionGroups/${encodeURIComponent(field.collectionGroup)}/fields/${encodeURIComponent(field.fieldPath)}`;
    const label = `${field.collectionGroup}.${field.fieldPath}`;
    try {
      const actual = await get(`${API}/${resource}`);
      requireObject(actual, label);
      // Resource names contain the unescaped field path, unlike request URLs.
      if (actual.name !== `${database}/collectionGroups/${field.collectionGroup}/fields/${field.fieldPath}`) throw new Error('identidad de campo incorrecta');
      const config = actual.indexConfig;
      if (!isObject(config) || config.usesAncestorConfig === true || config.reverting === true) throw new Error('configuración heredada, ausente o en reversión');
      if (['usesAncestorConfig', 'reverting'].some((key) => config[key] !== undefined && typeof config[key] !== 'boolean')) throw new Error('estado de configuración no válido');
      if (config.indexes !== undefined && !Array.isArray(config.indexes)) throw new Error('lista de índices no válida');
      const current = config.indexes ?? [];
      for (const index of current) {
        requireObject(index, label);
        const fields = fieldsOf(index, label);
        if (fields.length !== 1 || fields[0].fieldPath !== field.fieldPath || index.state !== 'READY') throw new Error('índice de campo incorrecto o sin estado READY');
      }
      const expectedKeys = field.indexes.map((index) => fieldIndexKey(index, field.fieldPath)).sort();
      const actualKeys = current.map((index) => fieldIndexKey(index, field.fieldPath)).sort();
      if (canonical(expectedKeys) !== canonical(actualKeys)) throw new Error('el conjunto de índices no coincide con el field override declarado');
    } catch (error) { issues.push(`${label}: ${error.message}`); }
  }
  if (issues.length) throw new Error(`Índices no verificados:\n- ${issues.join('\n- ')}`);
  return { compositeIndexes: spec.indexes.length, fieldOverrides: (spec.fieldOverrides ?? []).length,
    fieldIndexes: (spec.fieldOverrides ?? []).reduce((total, field) => total + field.indexes.length, 0) };
}

module.exports = { verifyFirestoreIndexes };
