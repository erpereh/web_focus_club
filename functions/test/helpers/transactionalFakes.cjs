// In-memory Firestore with transactional semantics close enough for the
// booking handlers: reads must precede writes, `create` fails on existing
// documents, staged writes only land when the callback resolves, and
// FieldValue.delete() removes fields on merge.

function isFieldTransform(value) {
  return /Transform$/.test(value?.constructor?.name ?? "");
}

/** Deep copy that keeps FieldValue sentinels (structuredClone would strip their class). */
function clone(value) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (isFieldTransform(value)) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function getPath(data, fieldPath) {
  return fieldPath.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data);
}

function matches(data, { field, operator, value }) {
  const actual = getPath(data, field);
  if (operator === "==") return actual === value;
  if (operator === "in") return value.includes(actual);
  if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
  if (operator === ">=") return actual >= value;
  if (operator === "<=") return actual <= value;
  throw new Error(`unsupported operator ${operator}`);
}

function isDeleteTransform(value) {
  return value?.constructor?.name === "DeleteTransform";
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Applies FieldValue sentinels the way Firestore does on write. */
function resolveFieldValue(current, value) {
  const kind = value?.constructor?.name;
  if (kind === "NumericIncrementTransform") return (typeof current === "number" ? current : 0) + value.operand;
  if (kind === "ArrayUnionTransform") {
    const base = Array.isArray(current) ? [...current] : [];
    for (const element of value.elements) {
      if (!base.some((item) => deepEqual(item, element))) base.push(clone(element));
    }
    return base;
  }
  if (kind === "ArrayRemoveTransform") {
    return (Array.isArray(current) ? current : []).filter((item) => !value.elements.some((element) => deepEqual(item, element)));
  }
  return value;
}

class TransactionConflictError extends Error {}

class FakeDocumentReference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split("/").at(-1);
    this.kind = "doc";
  }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() { return this.db.snapshot(this.path); }
  async set(value, options) { this.db.apply([{ ref: this, value: clone(value), merge: options?.merge === true }]); }
  async delete() { this.db.apply([{ ref: this, remove: true }]); }
}

class FakeQuery {
  constructor(db, collectionName, filters = [], maximum) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
    this.maximum = maximum;
    this.kind = "query";
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, operator, value }], this.maximum);
  }
  limit(maximum) { return new FakeQuery(this.db, this.collectionName, this.filters, maximum); }
  async get() { return this.db.runQuery(this); }
}

class FakeCollection extends FakeQuery {
  doc(id) {
    return new FakeDocumentReference(this.db, `${this.collectionName}/${id ?? `auto-${++this.db.autoId}`}`);
  }
}

class FakeFirestore {
  constructor(documents = {}) {
    this.documents = new Map(Object.entries(clone(documents)));
    this.autoId = 0;
    this.writes = [];
    this.versions = new Map();
    this.collectionVersions = new Map();
    this.conflicts = 0;
    /** Optional hook run after the transaction callback, before committing (race simulation). */
    this.beforeCommit = undefined;
  }

  collection(name) { return new FakeCollection(this, name); }

  doc(path) { return this.documents.get(path); }

  snapshot(path) {
    const data = this.documents.get(path);
    return {
      id: path.split("/").at(-1),
      ref: new FakeDocumentReference(this, path),
      exists: data !== undefined,
      data: () => clone(data),
    };
  }

  runQuery(query) {
    const prefix = `${query.collectionName}/`;
    const docs = [...this.documents.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => this.snapshot(path))
      .filter((snap) => query.filters.every((filter) => matches(snap.data(), filter)));
    const limited = query.maximum === undefined ? docs : docs.slice(0, query.maximum);
    return { docs: limited, empty: limited.length === 0, size: limited.length };
  }

  apply(staged) {
    staged.forEach(({ ref, value, merge, create, remove }) => {
      const collection = ref.path.split("/").slice(0, -1).join("/");
      this.versions.set(ref.path, (this.versions.get(ref.path) ?? 0) + 1);
      this.collectionVersions.set(collection, (this.collectionVersions.get(collection) ?? 0) + 1);
      if (remove) {
        this.documents.delete(ref.path);
        this.writes.push({ path: ref.path, deleted: true });
        return;
      }
      if (create && this.documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
      const previous = merge ? (this.documents.get(ref.path) ?? {}) : {};
      const next = { ...previous };
      Object.entries(value).forEach(([field, fieldValue]) => {
        if (isDeleteTransform(fieldValue)) delete next[field];
        else next[field] = resolveFieldValue(previous[field], fieldValue);
      });
      this.documents.set(ref.path, next);
      this.writes.push({ path: ref.path, value });
    });
  }

  /**
   * Optimistic concurrency like Firestore: a transaction whose read documents
   * (or queried collections) changed before commit is retried from scratch.
   */
  async runTransaction(callback, { maxAttempts = 5 } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      const staged = [];
      const readDocs = new Map();
      const readCollections = new Map();
      let wrote = false;
      const transaction = {
        get: async (target) => {
          if (wrote) throw new Error("read after write");
          if (target.kind === "doc") {
            readDocs.set(target.path, this.versions.get(target.path) ?? 0);
            return this.snapshot(target.path);
          }
          readCollections.set(target.collectionName, this.collectionVersions.get(target.collectionName) ?? 0);
          return this.runQuery(target);
        },
        set: (ref, value, options) => {
          wrote = true;
          staged.push({ ref, value: clone(value), merge: options?.merge === true });
        },
        create: (ref, value) => {
          wrote = true;
          staged.push({ ref, value: clone(value), merge: false, create: true });
        },
        delete: (ref) => {
          wrote = true;
          staged.push({ ref, remove: true });
        },
      };
      const result = await callback(transaction);
      if (this.beforeCommit) await this.beforeCommit();
      const conflict = [...readDocs].some(([path, version]) => (this.versions.get(path) ?? 0) !== version)
        || [...readCollections].some(([name, version]) => (this.collectionVersions.get(name) ?? 0) !== version);
      if (conflict) {
        this.conflicts += 1;
        if (attempt >= maxAttempts) throw new TransactionConflictError("transaction contention");
        continue;
      }
      this.apply(staged);
      return result;
    }
  }
}

/** Callable request as the handlers receive it. */
function callable(uid, data, { emailVerified = true } = {}) {
  return { auth: uid ? { uid, token: { email_verified: emailVerified, email: `${uid}@example.com` } } : undefined, data };
}

async function rejectsWithReason(promise, reason, code) {
  try {
    await promise;
  } catch (error) {
    if (error?.details?.reason !== reason) {
      throw new Error(`expected reason ${reason}, got ${error?.details?.reason} (${error?.message})`);
    }
    if (code && error.code !== code) throw new Error(`expected code ${code}, got ${error.code}`);
    return error;
  }
  throw new Error(`expected rejection with reason ${reason}`);
}

module.exports = { FakeFirestore, TransactionConflictError, callable, rejectsWithReason };
