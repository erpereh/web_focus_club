// In-memory Firestore with transactional semantics close enough for the
// booking handlers: reads must precede writes, `create` fails on existing
// documents, staged writes only land when the callback resolves, and
// FieldValue.delete() removes fields on merge.

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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
    staged.forEach(({ ref, value, merge, create }) => {
      if (create && this.documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
      const next = merge ? { ...(this.documents.get(ref.path) ?? {}), ...value } : { ...value };
      Object.entries(value).forEach(([field, fieldValue]) => {
        if (isDeleteTransform(fieldValue)) delete next[field];
      });
      this.documents.set(ref.path, next);
      this.writes.push({ path: ref.path, value });
    });
  }

  async runTransaction(callback) {
    const staged = [];
    let wrote = false;
    const transaction = {
      get: async (target) => {
        if (wrote) throw new Error("read after write");
        return target.kind === "doc" ? this.snapshot(target.path) : this.runQuery(target);
      },
      set: (ref, value, options) => {
        wrote = true;
        staged.push({ ref, value: clone(value), merge: options?.merge === true });
      },
      create: (ref, value) => {
        wrote = true;
        staged.push({ ref, value: clone(value), merge: false, create: true });
      },
    };
    const result = await callback(transaction);
    if (this.beforeCommit) await this.beforeCommit();
    this.apply(staged);
    return result;
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

module.exports = { FakeFirestore, callable, rejectsWithReason };
