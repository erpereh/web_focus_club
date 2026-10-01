// In-memory Firestore / FCM / Brevo fakes for the notification tests.

function getPath(data, fieldPath) {
  return fieldPath.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data);
}

function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return value;
}

// Range filters only match values of the same type, as in Firestore.
function sameType(a, b) {
  return typeof comparable(a) === typeof comparable(b) && comparable(a) !== null;
}

function matches(data, filters) {
  return filters.every(({ field, op, value }) => {
    const current = getPath(data, field);
    if (op === "==") return current === value;
    if (op === "in") return value.includes(current);
    if (op === "array-contains") return Array.isArray(current) && current.includes(value);
    if (op === "<=") return sameType(current, value) && comparable(current) <= comparable(value);
    if (op === "<") return sameType(current, value) && comparable(current) < comparable(value);
    throw new Error(`Unsupported operator ${op}`);
  });
}

function createFakeFirestore(initial = {}) {
  const documents = new Map(Object.entries(initial));
  let nextId = 1;
  const writes = [];

  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    exists: documents.has(path),
    ref: reference(path),
    data: () => documents.get(path),
  });

  function write(path, data, options) {
    const next = options?.merge ? { ...(documents.get(path) || {}), ...data } : { ...data };
    documents.set(path, next);
    writes.push({ path, data, options });
  }

  function reference(path) {
    return {
      id: path.split("/").at(-1),
      path,
      collection: (name) => collection(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data, options) => write(path, data, options),
      delete: async () => { documents.delete(path); writes.push({ path, deleted: true }); },
    };
  }

  function inScope(key, path, group) {
    if (group) {
      const parts = key.split("/");
      return parts.length % 2 === 0 && parts.at(-2) === path;
    }
    const prefix = `${path}/`;
    return key.startsWith(prefix) && !key.slice(prefix.length).includes("/");
  }

  function query(path, filters = [], max = Infinity, order, group = false) {
    return {
      where: (field, op, value) => query(path, [...filters, { field, op, value }], max, order, group),
      orderBy: (field, direction = "asc") => query(path, filters, max, { field, direction }, group),
      limit: (count) => query(path, filters, count, order, group),
      get: async () => {
        let keys = [...documents.keys()]
          .filter((key) => inScope(key, path, group))
          .filter((key) => matches(documents.get(key), filters));
        if (order) {
          const sign = order.direction === "desc" ? -1 : 1;
          keys = keys.sort((a, b) => sign * (comparable(getPath(documents.get(a), order.field))
            - comparable(getPath(documents.get(b), order.field))));
        }
        const docs = keys.slice(0, max).map(snapshot);
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  function collection(path) {
    return {
      ...query(path),
      doc: (id = `auto-${nextId++}`) => reference(`${path}/${id}`),
    };
  }

  const db = {
    collection,
    collectionGroup: (name) => query(name, [], Infinity, undefined, true),
    async recursiveDelete(ref) {
      for (const key of [...documents.keys()]) {
        if (key === ref.path || key.startsWith(`${ref.path}/`)) documents.delete(key);
      }
      writes.push({ path: ref.path, recursiveDeleted: true });
    },
    async runTransaction(callback) {
      return callback({
        get: async (target) => (typeof target.where === "function" && !target.path ? target.get() : snapshot(target.path)),
        set: (ref, data, options) => write(ref.path, data, options),
        create: (ref, data) => {
          if (documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          write(ref.path, data);
        },
        update: (ref, data) => write(ref.path, data, { merge: true }),
      });
    },
  };

  return { db, documents, writes };
}

function createFakeMessaging(behaviour) {
  const calls = [];
  return {
    calls,
    async sendEachForMulticast(message) {
      calls.push(message);
      if (behaviour) return behaviour(message, calls.length);
      return {
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map(() => ({ success: true })),
      };
    },
  };
}

function createFakeEmailClient(behaviour) {
  const calls = [];
  return {
    calls,
    async send(message, options) {
      calls.push({ message, options });
      if (behaviour) return behaviour(message, options, calls.length);
      return { messageId: `brevo-${calls.length}` };
    },
  };
}

/** A customer with push enabled and one registered device. */
function customerDocs(uid = "user-1", overrides = {}) {
  return {
    [`users/${uid}`]: {
      uid,
      name: "Lucía Pérez",
      email: "lucia@example.com",
      pushNotificationsEnabled: true,
      ...overrides,
    },
    [`users/${uid}/fcmTokens/token-1`]: { token: "token-1", platform: "android" },
  };
}

function silenceConsole() {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, original);
}

module.exports = {
  createFakeEmailClient,
  createFakeFirestore,
  createFakeMessaging,
  customerDocs,
  silenceConsole,
};
