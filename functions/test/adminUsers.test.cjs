const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createUserFromAdminCore,
  parseCreateUserFromAdminCommonData,
  toIsoFromAuthCreationTime,
} = require("../lib/adminUsers.js");

const NOW = new Date("2026-09-09T12:00:00.000Z");
const AUTH_CREATED_AT = "2024-01-15T10:00:00.000Z";

function snapshot(data, ref) {
  return {
    exists: data !== undefined,
    data: () => data,
    ref,
    id: ref.id,
  };
}

function createFirestoreFixture(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const writes = [];
  let nextId = 1;
  let failTrainerQuery = false;
  let failUsersSet = false;

  function reference(path) {
    const ref = {
      id: path.split("/").at(-1),
      path,
      async get() {
        return snapshot(documents.get(path), ref);
      },
      async set(data, options) {
        if (failUsersSet && path.startsWith("users/")) {
          throw new Error("firestore-failed");
        }
        const next = options?.merge ? { ...(documents.get(path) || {}), ...data } : { ...data };
        documents.set(path, next);
        writes.push({ operation: "set", path, data, options });
      },
    };
    return ref;
  }

  function collection(name) {
    return {
      doc(id = `generated-${nextId++}`) {
        return reference(`${name}/${id}`);
      },
      async add(data) {
        const path = `${name}/generated-${nextId++}`;
        documents.set(path, { ...data });
        writes.push({ operation: "add", path, data });
        return reference(path);
      },
      where(field, _op, value) {
        return {
          async get() {
            if (failTrainerQuery && name === "trainers") {
              throw new Error("trainer-sync-failed");
            }
            const docs = [];
            for (const [path, data] of documents.entries()) {
              if (path.startsWith(`${name}/`) && data?.[field] === value) {
                docs.push({
                  id: path.split("/").at(-1),
                  ref: reference(path),
                  data: () => data,
                });
              }
            }
            return { empty: docs.length === 0, docs };
          },
        };
      },
    };
  }

  const db = {
    collection,
    batch() {
      const ops = [];
      return {
        set(ref, data, options) {
          ops.push({ type: "set", ref, data, options });
        },
        delete(ref) {
          ops.push({ type: "delete", ref });
        },
        async commit() {
          for (const op of ops) {
            if (op.type === "set") {
              const next = op.options?.merge
                ? { ...(documents.get(op.ref.path) || {}), ...op.data }
                : { ...op.data };
              documents.set(op.ref.path, next);
              writes.push({ operation: "set", path: op.ref.path, data: op.data, options: op.options });
            } else {
              documents.delete(op.ref.path);
              writes.push({ operation: "delete", path: op.ref.path });
            }
          }
        },
      };
    },
  };

  return {
    db,
    documents,
    writes,
    setFailTrainerQuery(value) {
      failTrainerQuery = value;
    },
    setFailUsersSet(value) {
      failUsersSet = value;
    },
  };
}

function createAuthFixture(users = []) {
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), { ...user }]));
  const byUid = new Map(users.map((user) => [user.uid, byEmail.get(user.email.toLowerCase())]));
  const calls = { createUser: [], deleteUser: [], updateUser: [] };
  let nextUid = 1;

  return {
    calls,
    byEmail,
    byUid,
    auth: {
      async getUserByEmail(email) {
        const user = byEmail.get(String(email).toLowerCase());
        if (!user) {
          const error = new Error("There is no user record corresponding to the provided identifier.");
          error.code = "auth/user-not-found";
          throw error;
        }
        return user;
      },
      async createUser(payload) {
        calls.createUser.push(payload);
        const uid = `created-${nextUid++}`;
        const user = {
          uid,
          email: payload.email,
          metadata: { creationTime: NOW.toISOString() },
        };
        byEmail.set(payload.email.toLowerCase(), user);
        byUid.set(uid, user);
        return user;
      },
      async deleteUser(uid) {
        calls.deleteUser.push(uid);
        const user = byUid.get(uid);
        if (user?.email) {
          byEmail.delete(user.email.toLowerCase());
        }
        byUid.delete(uid);
      },
      async updateUser(uid, payload) {
        calls.updateUser.push({ uid, payload });
        return byUid.get(uid);
      },
    },
  };
}

function orphanAuthUser(overrides = {}) {
  return {
    uid: "isa-original-uid",
    email: "isa@focusclub.es",
    metadata: { creationTime: AUTH_CREATED_AT },
    ...overrides,
  };
}

function basePayload(overrides = {}) {
  return {
    name: "Isa Focus",
    email: "isa@focusclub.es",
    phone: "600111222",
    role: "user",
    accessMethod: "password",
    ...overrides,
  };
}

async function runCreate(options = {}) {
  const payload = basePayload(options.payload);
  const input = parseCreateUserFromAdminCommonData(payload);
  const firestore = createFirestoreFixture(options.documents || {});
  if (options.failTrainerQuery) firestore.setFailTrainerQuery(true);
  if (options.failUsersSet) firestore.setFailUsersSet(true);
  const authFixture = createAuthFixture(options.authUsers || []);
  let generatedPasswordCount = 0;

  const result = await createUserFromAdminCore({
    db: firestore.db,
    auth: authFixture.auth,
    input,
    rawData: payload,
    adminUid: "admin-1",
    adminEmail: "admin@focusclub.es",
    now: NOW,
    generateTemporaryPassword: () => {
      generatedPasswordCount += 1;
      return "GeneratedPass1!";
    },
  });

  return { result, firestore, authFixture, generatedPasswordCount, input };
}

function activityLogs(documents) {
  return [...documents.entries()]
    .filter(([path]) => path.startsWith("activity_logs/"))
    .map(([, data]) => data);
}

test("toIsoFromAuthCreationTime uses parseable Auth creationTime and falls back to now", () => {
  assert.equal(toIsoFromAuthCreationTime(AUTH_CREATED_AT, NOW), AUTH_CREATED_AT);
  assert.equal(toIsoFromAuthCreationTime("Mon, 15 Jan 2024 10:00:00 GMT", NOW), AUTH_CREATED_AT);
  assert.equal(toIsoFromAuthCreationTime("not-a-date", NOW), NOW.toISOString());
  assert.equal(toIsoFromAuthCreationTime(undefined, NOW), NOW.toISOString());
});

test("common parse does not require a password", () => {
  assert.deepEqual(
    parseCreateUserFromAdminCommonData(basePayload()),
    {
      name: "Isa Focus",
      email: "isa@focusclub.es",
      phone: "600111222",
      role: "user",
      isTrainer: false,
      accessMethod: "password",
    },
  );
});

test("Auth missing creates Auth + Firestore and returns repairedExistingAuth false", async () => {
  const { result, firestore, authFixture, generatedPasswordCount } = await runCreate({
    payload: {
      name: "Nuevo Cliente",
      email: "nuevo@focusclub.es",
      phone: "600000000",
      role: "user",
      accessMethod: "email-reset",
    },
  });

  assert.equal(generatedPasswordCount, 1);
  assert.equal(authFixture.calls.createUser.length, 1);
  assert.deepEqual(authFixture.calls.createUser[0], {
    email: "nuevo@focusclub.es",
    displayName: "Nuevo Cliente",
    password: "GeneratedPass1!",
    emailVerified: false,
  });
  assert.deepEqual(result, {
    success: true,
    uid: "created-1",
    email: "nuevo@focusclub.es",
    repairedExistingAuth: false,
  });
  assert.deepEqual(firestore.documents.get("users/created-1"), {
    uid: "created-1",
    name: "Nuevo Cliente",
    email: "nuevo@focusclub.es",
    phone: "600000000",
    role: "user",
    isTrainer: false,
    createdAt: NOW.toISOString(),
    pushNotificationsEnabled: false,
  });
  assert.equal(activityLogs(firestore.documents)[0].action, "user_created_by_admin");
});

test("new user with password method still requires a valid password", async () => {
  await assert.rejects(
    () => runCreate({
      payload: {
        name: "Nuevo Cliente",
        email: "nuevo@focusclub.es",
        phone: "600000000",
        role: "user",
        accessMethod: "password",
      },
    }),
    (error) => error.code === "invalid-argument" && error.message.includes("contrasena temporal"),
  );
});

test("Auth + Firestore existing throws already-exists", async () => {
  const user = orphanAuthUser();
  await assert.rejects(
    () => runCreate({
      authUsers: [user],
      documents: {
        [`users/${user.uid}`]: { uid: user.uid, email: user.email, name: "Isa" },
      },
    }),
    (error) => error.code === "already-exists" && error.message === "Ya existe un usuario con este email.",
  );
});

test("orphan Auth repairs Firestore with the same UID and does not create Auth", async () => {
  const user = orphanAuthUser({ email: "ISA@focusclub.es" });
  const { result, firestore, authFixture, generatedPasswordCount } = await runCreate({
    authUsers: [user],
    payload: {
      name: "Isa Reparada",
      email: "isa@focusclub.es",
      phone: "611222333",
      role: "user",
      accessMethod: "password",
    },
  });

  assert.equal(generatedPasswordCount, 0);
  assert.equal(authFixture.calls.createUser.length, 0);
  assert.equal(authFixture.calls.deleteUser.length, 0);
  assert.equal(authFixture.calls.updateUser.length, 0);
  assert.deepEqual(result, {
    success: true,
    uid: "isa-original-uid",
    email: "ISA@focusclub.es",
    repairedExistingAuth: true,
  });
  assert.deepEqual(firestore.documents.get("users/isa-original-uid"), {
    uid: "isa-original-uid",
    name: "Isa Reparada",
    email: "ISA@focusclub.es",
    phone: "611222333",
    role: "user",
    isTrainer: false,
    createdAt: AUTH_CREATED_AT,
    updatedAt: NOW.toISOString(),
    pushNotificationsEnabled: false,
  });
});

test("repair uses Auth creationTime for profile createdAt and now for activity log createdAt", async () => {
  const { firestore } = await runCreate({
    authUsers: [orphanAuthUser()],
  });

  assert.equal(firestore.documents.get("users/isa-original-uid").createdAt, AUTH_CREATED_AT);
  assert.equal(firestore.documents.get("users/isa-original-uid").updatedAt, NOW.toISOString());
  const log = activityLogs(firestore.documents)[0];
  assert.equal(log.action, "user_profile_repaired_from_auth");
  assert.equal(log.createdAt, NOW.toISOString());
  assert.equal(log.targetUid, "isa-original-uid");
  assert.equal(log.adminUid, "admin-1");
  assert.equal(log.adminEmail, "admin@focusclub.es");
  assert.equal(log.email, "isa@focusclub.es");
  assert.equal(log.role, "user");
  assert.equal(log.timestamp, NOW.toISOString());
});

test("repair with trainer role creates a trainer profile for the same UID", async () => {
  const { firestore } = await runCreate({
    authUsers: [orphanAuthUser()],
    payload: basePayload({ role: "trainer", accessMethod: "email-reset" }),
  });

  const trainers = [...firestore.documents.entries()].filter(([path]) => path.startsWith("trainers/"));
  assert.equal(trainers.length, 1);
  assert.deepEqual(trainers[0][1], {
    uid: "isa-original-uid",
    name: "Isa Focus",
    active: true,
    createdAt: NOW.toISOString(),
  });
  assert.equal(firestore.documents.get("users/isa-original-uid").role, "trainer");
  assert.equal(firestore.documents.get("users/isa-original-uid").isTrainer, true);
});

test("repair with user role removes leftover trainer docs", async () => {
  const { firestore } = await runCreate({
    authUsers: [orphanAuthUser()],
    documents: {
      "trainers/old-trainer": { uid: "isa-original-uid", name: "Old", active: true },
    },
  });

  assert.equal(firestore.documents.has("trainers/old-trainer"), false);
  assert.equal(firestore.documents.get("users/isa-original-uid").role, "user");
});

test("repair does not write profile or activity log if syncTrainerProfile fails", async () => {
  const user = orphanAuthUser();
  const firestore = createFirestoreFixture();
  firestore.setFailTrainerQuery(true);
  const authFixture = createAuthFixture([user]);
  const payload = basePayload();

  await assert.rejects(
    () => createUserFromAdminCore({
      db: firestore.db,
      auth: authFixture.auth,
      input: parseCreateUserFromAdminCommonData(payload),
      rawData: payload,
      adminUid: "admin-1",
      adminEmail: "admin@focusclub.es",
      now: NOW,
      generateTemporaryPassword: () => {
        throw new Error("should not generate a password during repair");
      },
    }),
    /trainer-sync-failed/,
  );

  assert.equal(firestore.documents.has("users/isa-original-uid"), false);
  assert.equal(activityLogs(firestore.documents).length, 0);
  assert.equal(authFixture.calls.createUser.length, 0);
  assert.equal(authFixture.calls.deleteUser.length, 0);
  assert.equal(authFixture.calls.updateUser.length, 0);
  assert.equal(authFixture.byUid.has("isa-original-uid"), true);
});

test("new user rolls back Auth if Firestore fails", async () => {
  const firestore = createFirestoreFixture();
  firestore.setFailUsersSet(true);
  const authFixture = createAuthFixture();
  const payload = basePayload({
    name: "Nuevo Cliente",
    email: "nuevo@focusclub.es",
    accessMethod: "email-reset",
  });

  await assert.rejects(
    () => createUserFromAdminCore({
      db: firestore.db,
      auth: authFixture.auth,
      input: parseCreateUserFromAdminCommonData(payload),
      rawData: payload,
      adminUid: "admin-1",
      adminEmail: "admin@focusclub.es",
      now: NOW,
      generateTemporaryPassword: () => "GeneratedPass1!",
    }),
    /firestore-failed/,
  );

  assert.deepEqual(authFixture.calls.deleteUser, ["created-1"]);
  assert.equal(firestore.documents.has("users/created-1"), false);
});
