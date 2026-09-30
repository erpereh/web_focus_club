// In-memory Firestore / FCM / Brevo fakes for the notification tests.

function getPath(data, fieldPath) {
  return fieldPath.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data);
}

function matches(data, filters) {
  return filters.every(({ field, op, value }) => {
    const current = getPath(data, field);
    if (op === "==") return current === value;
    if (op === "in") return value.includes(current);
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

  function query(path, filters = [], max = Infinity) {
    return {
      where: (field, op, value) => query(path, [...filters, { field, op, value }], max),
      limit: (count) => query(path, filters, count),
      get: async () => {
        const prefix = `${path}/`;
        const docs = [...documents.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .filter((key) => matches(documents.get(key), filters))
          .slice(0, max)
          .map(snapshot);
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
