const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyFirestoreIndexes } = require('../../scripts/firestore-index-verifier.cjs');
const declared = require('../../firestore.indexes.json');
const project = 'test-project';
const database = `projects/${project}/databases/(default)`;
const base = `https://firestore.googleapis.com/v1/${database}/collectionGroups/`;
const clone = (value) => structuredClone(value);

function composite(index, id = 'index-1') {
  const fields = clone(index.fields);
  if (fields.at(-1).fieldPath !== '__name__') fields.push({ fieldPath: '__name__', order: fields.at(-1).order ?? 'ASCENDING' });
  return { name: `${database}/collectionGroups/${index.collectionGroup}/indexes/${id}`,
    queryScope: index.queryScope, fields, state: 'READY', apiScope: 'ANY_API', density: 'SPARSE_ALL' };
}
function fieldResource(field) {
  return { name: `${database}/collectionGroups/${field.collectionGroup}/fields/${field.fieldPath}`,
    indexConfig: { indexes: field.indexes.map(({ queryScope, ...mode }) => ({ queryScope,
      fields: [{ fieldPath: field.fieldPath, ...mode }], state: 'READY' })) } };
}
function fixture(spec = declared) {
  const expected = clone(spec), indexes = expected.indexes.map(composite), fields = new Map();
  for (const field of expected.fieldOverrides ?? []) {
    fields.set(`${base}${encodeURIComponent(field.collectionGroup)}/fields/${encodeURIComponent(field.fieldPath)}`, fieldResource(field));
  }
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    assert.equal(new URL(url).searchParams.has('pageSize'), false, 'pageSize must be omitted, not merely reduced');
    if (url === `${base}-/indexes`) return { indexes: clone(indexes) };
    assert.ok(fields.has(url), `Unexpected request: ${url}`);
    return clone(fields.get(url));
  };
  return { spec: expected, indexes, fields, calls, get, verify: (transport = get) => verifyFirestoreIndexes(transport, project, expected) };
}

test('verifies every declared composite and field override with the API default page size', async () => {
  const f = fixture();
  assert.deepEqual(await f.verify(), { compositeIndexes: 15, fieldOverrides: 2, fieldIndexes: 8 });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0], `${base}-/indexes`);
  assert.ok(f.calls.some((url) => url.endsWith('/fcmTokens/fields/token')));
  assert.ok(f.calls.some((url) => url.endsWith('/fcmTokens/fields/updatedAt')));
});

test('reads all pages, including an empty intermediate page, and escapes page tokens', async () => {
  const f = fixture(), token = 'next +/?=&π', requested = [];
  const get = async (url) => {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith('/indexes')) return f.get(url);
    requested.push(url);
    assert.equal(parsed.searchParams.has('pageSize'), false);
    const cursor = parsed.searchParams.get('pageToken');
    if (!cursor) return { indexes: f.indexes.slice(0, 2), nextPageToken: token };
    if (cursor === token) return { indexes: [], nextPageToken: 'last-page' };
    assert.equal(cursor, 'last-page');
    return { indexes: f.indexes.slice(2) };
  };
  assert.deepEqual(await f.verify(get), { compositeIndexes: 15, fieldOverrides: 2, fieldIndexes: 8 });
  assert.equal(requested.length, 3);
  assert.equal(requested[1], `${base}-/indexes?pageToken=${encodeURIComponent(token)}`);
});

test('a failed later page cannot certify the earlier READY indexes or fall back to a partial list', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(f.verify(async () => {
    if (++calls === 1) return { indexes: f.indexes, nextPageToken: 'more' };
    throw new Error('HTTP 400: later page unavailable');
  }), /HTTP 400/);
  assert.equal(calls, 2);
});

for (const tokens of [['same', 'same'], ['a', 'b', 'a']]) {
  test(`rejects repeated/cyclic pagination: ${tokens.join(' -> ')}`, async () => {
    const f = fixture(); let calls = 0;
    await assert.rejects(f.verify(async () => ({ indexes: f.indexes, nextPageToken: tokens[calls++] })), /paginación repetido/);
    assert.equal(calls, tokens.length);
  });
}

for (const response of [null, [], { indexes: {} }, { indexes: [null] }, { nextPageToken: 3 }]) {
  test(`invalid API response fails closed: ${JSON.stringify(response)}`, async () => {
    await assert.rejects(fixture().verify(async () => response));
  });
}

test('an omitted index list is an empty result, not success or a skipped check', async () => {
  const f = fixture();
  await assert.rejects(f.verify((url) => url.endsWith('/indexes') ? {} : f.get(url)), /no encontrado/);
  assert.equal(f.calls.length, 2, 'both field overrides are still checked');
});

for (const state of ['CREATING', 'NEEDS_REPAIR', 'STATE_UNSPECIFIED', undefined]) {
  test(`a matching composite without READY is rejected: ${state}`, async () => {
    const f = fixture(); f.indexes[0].state = state;
    await assert.rejects(f.verify(), /appointments/);
    assert.equal(f.calls.length, 3);
  });
}

const differentComposites = {
  'missing index': (indexes) => indexes.shift(),
  'wrong collection': (indexes) => { indexes[0].name = indexes[0].name.replace('/appointments/', '/other/'); },
  'wrong query scope': (indexes) => { indexes[0].queryScope = 'COLLECTION_GROUP'; },
  'wrong field order': (indexes) => { [indexes[0].fields[0], indexes[0].fields[1]] = [indexes[0].fields[1], indexes[0].fields[0]]; },
  'wrong direction': (indexes) => { indexes[0].fields[1].order = 'ASCENDING'; },
  'wrong array mode': (indexes) => { indexes[0].fields[0] = { fieldPath: 'userId', arrayConfig: 'CONTAINS' }; },
  'wrong implicit __name__ direction': (indexes) => { indexes[0].fields.at(-1).order = 'ASCENDING'; },
  'missing __name__': (indexes) => indexes[0].fields.pop(),
  'different API scope': (indexes) => { indexes[0].apiScope = 'DATASTORE_MODE_API'; },
  'different density': (indexes) => { indexes[0].density = 'DENSE'; },
};
for (const [name, mutate] of Object.entries(differentComposites)) {
  test(`does not confuse a different READY composite with the required index: ${name}`, async () => {
    const f = fixture(); mutate(f.indexes);
    await assert.rejects(f.verify(), /no encontrado/);
  });
}

test('preserves an explicitly declared __name__ direction instead of inferring or ignoring it', async () => {
  const spec = { indexes: [{ collectionGroup: 'things', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'createdAt', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
  ] }] };
  const f = fixture(spec);
  await f.verify();
  f.indexes[0].fields.at(-1).order = 'DESCENDING';
  await assert.rejects(f.verify(), /no encontrado/);
});

test('the implicit __name__ of a last array field is ascending', async () => {
  const f = fixture({ indexes: [{ collectionGroup: 'things', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'type', order: 'DESCENDING' }, { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
  ] }] });
  await f.verify();
  f.indexes[0].fields.at(-1).order = 'DESCENDING';
  await assert.rejects(f.verify(), /no encontrado/);
});

test('additional unrelated composite indexes do not hide missing requirements or block a valid specification', async () => {
  const f = fixture();
  f.indexes.push({ ...composite({ ...f.spec.indexes[0], collectionGroup: 'unrelated' }), state: 'CREATING' });
  await f.verify();
  f.indexes.shift();
  await assert.rejects(f.verify(), /no encontrado/);
});

test('a response from another project/database is not accepted', async () => {
  const f = fixture(); f.indexes[0].name = f.indexes[0].name.replace(project, 'another-project');
  await assert.rejects(f.verify(), /otro proyecto o base/);
});

const differentOverrides = {
  'missing mode': (resource) => resource.indexConfig.indexes.pop(),
  'wrong scope': (resource) => { resource.indexConfig.indexes[3].queryScope = 'COLLECTION'; },
  'wrong field path': (resource) => { resource.indexConfig.indexes[0].fields[0].fieldPath = 'wrong'; },
  'wrong mode': (resource) => { resource.indexConfig.indexes[2].fields[0] = { fieldPath: 'token', order: 'ASCENDING' }; },
  'duplicate mode': (resource) => resource.indexConfig.indexes.push(clone(resource.indexConfig.indexes[0])),
  'unready field index': (resource) => { resource.indexConfig.indexes[0].state = 'CREATING'; },
  'failed field index': (resource) => { resource.indexConfig.indexes[0].state = 'NEEDS_REPAIR'; },
  'inherited config': (resource) => { resource.indexConfig.usesAncestorConfig = true; },
  'reverting config': (resource) => { resource.indexConfig.reverting = true; },
  'malformed inherited flag': (resource) => { resource.indexConfig.usesAncestorConfig = 'true'; },
  'malformed reverting flag': (resource) => { resource.indexConfig.reverting = 'true'; },
  'missing config': (resource) => { delete resource.indexConfig; },
  'wrong resource': (resource) => { resource.name += '-different'; },
  'invalid indexes': (resource) => { resource.indexConfig.indexes = {}; },
  'not a single-field index': (resource) => resource.indexConfig.indexes[0].fields.push({ fieldPath: '__name__', order: 'ASCENDING' }),
};
for (const [name, mutate] of Object.entries(differentOverrides)) {
  test(`field override cannot pass on partial or incompatible evidence: ${name}`, async () => {
    const f = fixture(); mutate([...f.fields.values()][0]);
    await assert.rejects(f.verify(), /fcmTokens.token/);
    assert.equal(f.calls.length, 3, 'the other override must also be read');
  });
}

test('a failed field read does not skip the remaining override or produce success', async () => {
  const f = fixture();
  await assert.rejects(f.verify((url) => {
    if (url.endsWith('/fields/token')) throw new Error('HTTP 403');
    return f.get(url);
  }), /fcmTokens.token: HTTP 403/);
  assert.ok(f.calls.some((url) => url.endsWith('/fields/updatedAt')));
});

test('reports composite and both field failures together', async () => {
  const f = fixture(); f.indexes.shift();
  for (const resource of f.fields.values()) resource.indexConfig.reverting = true;
  await assert.rejects(f.verify(), (error) => {
    for (const name of ['appointments', 'fcmTokens.token', 'fcmTokens.updatedAt']) assert.ok(error.message.includes(name));
    return true;
  });
});

test('an empty override requires explicitly disabled indexing, not merely zero READY indexes', async () => {
  const f = fixture({ indexes: [], fieldOverrides: [{ collectionGroup: 'things', fieldPath: 'large', indexes: [] }] });
  const resource = [...f.fields.values()][0];
  delete resource.indexConfig.indexes; // Proto JSON omits an empty array.
  assert.deepEqual(await f.verify(), { compositeIndexes: 0, fieldOverrides: 1, fieldIndexes: 0 });
  resource.indexConfig.usesAncestorConfig = true;
  await assert.rejects(f.verify(), /heredada/);
  delete resource.indexConfig.usesAncestorConfig;
  resource.indexConfig.indexes = [{ state: 'CREATING', queryScope: 'COLLECTION', fields: [{ fieldPath: 'large', order: 'ASCENDING' }] }];
  await assert.rejects(f.verify(), /sin estado READY/);
});

test('escapes field and collection names in request URLs while validating the actual resource identity', async () => {
  const f = fixture({ indexes: [], fieldOverrides: [{ collectionGroup: 'special group', fieldPath: '`a/b c`',
    indexes: [{ queryScope: 'COLLECTION', order: 'ASCENDING' }] }] });
  await f.verify();
  assert.ok(f.calls.some((url) => url.endsWith('/special%20group/fields/%60a%2Fb%20c%60')));
});

for (const spec of [
  { indexes: null },
  { indexes: [], fieldOverrides: null },
  { indexes: [], unverified: true },
  { indexes: [{ ...declared.indexes[0], unsupported: true }] },
  { indexes: [{ ...declared.indexes[0], fields: [{ fieldPath: 'vector', vectorConfig: { dimension: 3, flat: {} } }] }] },
  { indexes: [declared.indexes[0], declared.indexes[0]] },
  { indexes: [], fieldOverrides: [{ ...declared.fieldOverrides[0], ttl: true }] },
  { indexes: [], fieldOverrides: [{ ...declared.fieldOverrides[0], indexes: [declared.fieldOverrides[0].indexes[0], declared.fieldOverrides[0].indexes[0]] }] },
]) {
  test(`never silently skips malformed, duplicate or unsupported configuration: ${JSON.stringify(spec)}`, async () => {
    let reads = 0;
    await assert.rejects(verifyFirestoreIndexes(async () => { reads++; return {}; }, project, spec));
    assert.equal(reads, 0, 'validate the whole declared specification before requesting data');
  });
}
