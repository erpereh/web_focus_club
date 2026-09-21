const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyMigrationOperations,
  createSlotMigrationHandlers,
  planLegacyBlockedSlotMigration,
  planSlotOccupancyReconciliation,
} = require('../lib/slotMigrations.js');

function appointment(id, data) {
  return { id, data: { status: 'approved', duration: '30', ...data } };
}

function occupancy(id, date, time, count) {
  return { id, data: { date, time, count } };
}

test('occupancy reconciliation uses approved, preferred, then legacy slots', () => {
  const plan = planSlotOccupancyReconciliation({
    startDate: '2026-10-01',
    appointments: [
      appointment('approved', {
        approvedSlot: { date: '2026-10-01', time: '10:00' },
        preferredSlots: [{ date: '2026-10-01', time: '12:00' }],
        date: '2026-10-01', time: '14:00',
      }),
      appointment('preferred', {
        preferredSlots: [{ date: '2026-10-01', time: '11:00' }],
        date: '2026-10-01', time: '15:00',
      }),
      appointment('legacy', { date: '2026-10-01', time: '13:00' }),
    ],
    occupancyDocuments: [],
  });

  assert.equal(plan.report.appointmentsProcessed, 3);
  assert.equal(plan.report.invalidAppointments, 0);
  assert.deepEqual(
    plan.operations.filter((operation) => operation.type === 'set').map((operation) => operation.id),
    [
      '2026-10-01_10:00', '2026-10-01_10:15',
      '2026-10-01_11:00', '2026-10-01_11:15',
      '2026-10-01_13:00', '2026-10-01_13:15',
    ],
  );
});

test('occupancy reconciliation does not fall through an invalid higher-priority slot', () => {
  const plan = planSlotOccupancyReconciliation({
    startDate: '2026-10-01',
    appointments: [appointment('invalid-approved', {
      approvedSlot: { date: 'not-a-date', time: '10:00' },
      preferredSlots: [{ date: '2026-10-01', time: '12:00' }],
      date: '2026-10-01', time: '14:00',
    })],
    occupancyDocuments: [],
  });

  assert.equal(plan.report.appointmentsProcessed, 0);
  assert.equal(plan.report.invalidAppointments, 1);
  assert.deepEqual(plan.operations, []);
});

test('occupancy reconciliation accepts zero differences and deletes only a stale legacy floor', () => {
  const appointments = [appointment('a', {
    duration: '45',
    approvedSlot: { date: '2026-10-01', time: '16:15' },
  })];
  const canonical = [
    occupancy('2026-10-01_16:15', '2026-10-01', '16:15', 1),
    occupancy('2026-10-01_16:30', '2026-10-01', '16:30', 1),
    occupancy('2026-10-01_16:45', '2026-10-01', '16:45', 1),
  ];

  const zero = planSlotOccupancyReconciliation({ startDate: '2026-10-01', appointments, occupancyDocuments: canonical });
  assert.deepEqual(zero.operations, []);
  assert.equal(zero.report.documentsToCreate, 0);
  assert.equal(zero.report.documentsToUpdate, 0);
  assert.equal(zero.report.documentsToDelete, 0);

  const stale = planSlotOccupancyReconciliation({
    startDate: '2026-10-01',
    appointments,
    occupancyDocuments: [occupancy('2026-10-01_16:00', '2026-10-01', '16:00', 1), ...canonical],
  });
  assert.deepEqual(stale.operations, [{ collection: 'slot_occupancy', date: '2026-10-01', time: '16:00', id: '2026-10-01_16:00', type: 'delete' }]);
});

test('occupancy reconciliation replaces a negative count with the absolute expected value', () => {
  const plan = planSlotOccupancyReconciliation({
    startDate: '2026-10-01',
    appointments: [appointment('a', { approvedSlot: { date: '2026-10-01', time: '10:00' } })],
    occupancyDocuments: [
      occupancy('2026-10-01_10:00', '2026-10-01', '10:00', -4),
      occupancy('2026-10-01_10:15', '2026-10-01', '10:15', 1),
    ],
  });

  assert.equal(plan.report.documentsToUpdate, 1);
  assert.deepEqual(plan.operations, [{
    collection: 'slot_occupancy',
    date: '2026-10-01',
    time: '10:00',
    id: '2026-10-01_10:00',
    type: 'set',
    data: { date: '2026-10-01', time: '10:00', count: 1 },
  }]);
});

test('migration callables require authentication and explicit apply confirmation', async () => {
  const handlers = createSlotMigrationHandlers({
    getTodayMadrid: () => '2026-10-01',
    requireAdmin: async () => {},
    readApprovedAppointments: async () => [],
    readOccupancyDocuments: async () => [],
    readBlockedSlotDocuments: async () => [],
    applyOperations: async () => {},
  });

  await assert.rejects(
    handlers.reconcileSlotOccupancyFromApprovedAppointments({ data: { mode: 'dryRun' } }),
    (error) => error && error.code === 'permission-denied',
  );
  await assert.rejects(
    handlers.migrateLegacyBlockedSlots({ auth: { uid: 'admin' }, data: { mode: 'apply' } }),
    (error) => error && error.code === 'failed-precondition',
  );
});

test('occupancy apply refuses invalid approved appointments before writes', async () => {
  const events = [];
  const handlers = createSlotMigrationHandlers({
    getTodayMadrid: () => '2026-10-01',
    requireAdmin: async () => { events.push('admin'); },
    readApprovedAppointments: async () => { events.push('appointments'); return [appointment('bad', { duration: 'bogus' })]; },
    readOccupancyDocuments: async () => { events.push('occupancy'); return []; },
    readBlockedSlotDocuments: async () => [],
    applyOperations: async () => { events.push('write'); },
  });

  await assert.rejects(
    handlers.reconcileSlotOccupancyFromApprovedAppointments({ auth: { uid: 'admin' }, data: { mode: 'apply', confirmApply: true } }),
    (error) => error && error.code === 'failed-precondition',
  );
  assert.deepEqual(events, ['admin', 'appointments', 'occupancy']);
});

test('dryRun completes every read without writes and apply writes only after reads', async () => {
  const events = [];
  const deps = {
    getTodayMadrid: () => '2026-10-01',
    requireAdmin: async () => { events.push('admin'); },
    readApprovedAppointments: async () => { events.push('appointments'); return []; },
    readOccupancyDocuments: async () => { events.push('occupancy'); return []; },
    readBlockedSlotDocuments: async () => { events.push('blocked'); return []; },
    applyOperations: async () => { events.push('write'); },
  };
  const handlers = createSlotMigrationHandlers(deps);

  await handlers.reconcileSlotOccupancyFromApprovedAppointments({ auth: { uid: 'admin' }, data: { mode: 'dryRun' } });
  assert.deepEqual(events, ['admin', 'appointments', 'occupancy']);

  events.length = 0;
  await handlers.reconcileSlotOccupancyFromApprovedAppointments({ auth: { uid: 'admin' }, data: { mode: 'apply', confirmApply: true } });
  assert.deepEqual(events, ['admin', 'appointments', 'occupancy', 'write']);
});

test('legacy blocked slots expand to deterministic 15 minute documents and become idempotent', () => {
  const first = planLegacyBlockedSlotMigration({
    startDate: '2026-10-01',
    blockedDocuments: [{
      id: 'legacy-random-id',
      data: {
        date: '2026-10-01', time: '16:00', reason: 'Evento', createdBy: 'admin-1', createdAt: '2026-09-01T00:00:00.000Z',
      },
    }],
  });

  assert.equal(first.report.legacyDocumentsProcessed, 1);
  assert.equal(first.report.documentsToCreate, 2);
  assert.equal(first.report.documentsToDelete, 1);
  const writes = first.operations.filter((operation) => operation.type === 'set');
  assert.deepEqual(writes.map((operation) => operation.id), ['2026-10-01_16:00', '2026-10-01_16:15']);
  assert.equal(writes[0].data.blockGroupId, '2026-10-01_16:00_30');
  assert.deepEqual(writes[0].data.migratedFromLegacyIds, ['legacy-random-id']);

  const migratedDocuments = writes.map((operation) => ({ id: operation.id, data: operation.data }));
  const second = planLegacyBlockedSlotMigration({ startDate: '2026-10-01', blockedDocuments: migratedDocuments });
  assert.deepEqual(second.operations, []);
});

test('absolute migration writes are sorted, chunked, and require no reads between batches', async () => {
  const committed = [];
  const db = {
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }),
    batch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ type: 'set', path: ref.path, data }),
        delete: (ref) => operations.push({ type: 'delete', path: ref.path }),
        commit: async () => { committed.push(operations); },
      };
    },
  };
  const operations = [0, 1, 2, 3, 4].map((index) => ({
    collection: 'slot_occupancy', date: '2026-10-01', time: `10:${String(index).padStart(2, '0')}`,
    id: `2026-10-01_10:0${index}`, type: 'set', data: { count: index },
  }));

  await applyMigrationOperations(db, operations, 2);
  assert.deepEqual(committed.map((batch) => batch.length), [2, 2, 1]);
  assert.equal(committed.flat().every((operation) => operation.type === 'set'), true);
});

test('a retry safely repeats earlier absolute batches after a later batch fails', async () => {
  const stored = new Map();
  let commits = 0;
  let failSecondBatchOnce = true;
  const db = {
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }),
    batch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ type: 'set', path: ref.path, data }),
        delete: (ref) => operations.push({ type: 'delete', path: ref.path }),
        commit: async () => {
          commits += 1;
          if (commits === 2 && failSecondBatchOnce) {
            failSecondBatchOnce = false;
            throw new Error('simulated later batch failure');
          }
          operations.forEach((operation) => {
            if (operation.type === 'delete') stored.delete(operation.path);
            else stored.set(operation.path, operation.data);
          });
        },
      };
    },
  };
  const operations = [0, 1, 2, 3, 4].map((index) => ({
    collection: 'slot_occupancy', date: '2026-10-01', time: `10:0${index}`,
    id: `2026-10-01_10:0${index}`, type: 'set', data: { count: index + 1 },
  }));

  await assert.rejects(applyMigrationOperations(db, operations, 2), /simulated later batch failure/);
  assert.equal(stored.size, 2);

  await applyMigrationOperations(db, operations, 2);
  assert.equal(stored.size, 5);
  assert.deepEqual(stored.get('slot_occupancy/2026-10-01_10:00'), { count: 1 });
  assert.deepEqual(stored.get('slot_occupancy/2026-10-01_10:04'), { count: 5 });
});

test('a fresh blocked-slot replan preserves every legacy source after a partial batch failure', async () => {
  const sourceDocuments = ['000-a', '000-b', '000-c'].map((id, index) => ({
    id,
    data: {
      date: '2026-10-01',
      time: '16:00',
      reason: `source-${id}`,
      createdBy: `admin-${id}`,
      createdAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    },
  }));
  const stored = new Map(sourceDocuments.map((document) => [`blocked_slots/${document.id}`, document.data]));
  let commitNumber = 0;
  let failSecondBatchOnce = true;
  const db = {
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}` }) }),
    batch: () => {
      const operations = [];
      return {
        set: (ref, data) => operations.push({ type: 'set', path: ref.path, data }),
        delete: (ref) => operations.push({ type: 'delete', path: ref.path }),
        commit: async () => {
          commitNumber += 1;
          if (commitNumber === 2 && failSecondBatchOnce) {
            failSecondBatchOnce = false;
            throw new Error('simulated blocked-slot batch failure');
          }
          operations.forEach((operation) => {
            if (operation.type === 'delete') stored.delete(operation.path);
            else stored.set(operation.path, operation.data);
          });
        },
      };
    },
  };
  const firstPlan = planLegacyBlockedSlotMigration({
    startDate: '2026-10-01',
    blockedDocuments: sourceDocuments,
  });

  await assert.rejects(
    applyMigrationOperations(db, firstPlan.operations, 2),
    /simulated blocked-slot batch failure/,
  );

  const partiallyPersisted = [...stored.entries()]
    .filter(([path]) => path.startsWith('blocked_slots/'))
    .map(([path, data]) => ({ id: path.slice('blocked_slots/'.length), data }));
  const retryPlan = planLegacyBlockedSlotMigration({
    startDate: '2026-10-01',
    blockedDocuments: partiallyPersisted,
  });
  await applyMigrationOperations(db, retryPlan.operations, 2);

  assert.deepEqual(
    stored.get('blocked_slots/2026-10-01_16:00').migratedFromLegacyIds,
    ['000-a', '000-b', '000-c'],
  );
  assert.equal(stored.has('blocked_slots/000-a'), false);
  assert.equal(stored.has('blocked_slots/000-b'), false);
  assert.equal(stored.has('blocked_slots/000-c'), false);
});
