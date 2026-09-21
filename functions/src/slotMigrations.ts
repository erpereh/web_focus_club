import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getCanonicalSlotBlocks, slotOccupancyDocId } from './appointmentLifecycle.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SUPPORTED_DURATIONS = new Set([30, 45, 60]);
const SUPPORTED_INTERVALS = new Set([15, 30, 45, 60]);
const DEFAULT_BATCH_SIZE = 400;

export interface StoredMigrationDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface MigrationRange {
  startDate: string;
  endDate?: string;
}

export interface MigrationOperation {
  collection: 'slot_occupancy' | 'blocked_slots';
  date: string;
  time: string;
  id: string;
  type: 'set' | 'delete';
  data?: Record<string, unknown>;
}

interface BaseMigrationReport extends MigrationRange {
  documentsToCreate: number;
  documentsToUpdate: number;
  documentsToDelete: number;
  datesAffected: string[];
}

export interface OccupancyMigrationReport extends BaseMigrationReport {
  appointmentsProcessed: number;
  invalidAppointments: number;
}

export interface BlockedMigrationReport extends BaseMigrationReport {
  legacyDocumentsProcessed: number;
  blockGroupsResulting: number;
  invalidDocuments: number;
}

export interface MigrationPlan<TReport extends BaseMigrationReport> {
  report: TReport;
  operations: MigrationOperation[];
}

interface MigrationCallableRequest {
  auth?: { uid: string };
  data: unknown;
}

interface ParsedMigrationInput extends MigrationRange {
  mode: 'dryRun' | 'apply';
  confirmApply: boolean;
}

export interface SlotMigrationDeps {
  getTodayMadrid: () => string;
  requireAdmin: (uid: string) => Promise<unknown>;
  readApprovedAppointments: (range: MigrationRange) => Promise<StoredMigrationDocument[]>;
  readOccupancyDocuments: (range: MigrationRange) => Promise<StoredMigrationDocument[]>;
  readBlockedSlotDocuments: (range: MigrationRange) => Promise<StoredMigrationDocument[]>;
  applyOperations: (operations: MigrationOperation[]) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

function isInRange(date: string, range: MigrationRange): boolean {
  return date >= range.startDate && (!range.endDate || date <= range.endDate);
}

function parseMigrationInput(value: unknown, today: string): ParsedMigrationInput {
  if (!isRecord(value) || (value.mode !== 'dryRun' && value.mode !== 'apply')) {
    throw new HttpsError('invalid-argument', 'El modo debe ser dryRun o apply.');
  }
  const startDate = value.startDate === undefined ? today : value.startDate;
  const endDate = value.endDate;
  if (!isIsoDate(startDate) || (endDate !== undefined && !isIsoDate(endDate))) {
    throw new HttpsError('invalid-argument', 'El rango de fechas no es válido.');
  }
  if (typeof endDate === 'string' && endDate < startDate) {
    throw new HttpsError('invalid-argument', 'endDate no puede ser anterior a startDate.');
  }
  if (value.mode === 'apply' && value.confirmApply !== true) {
    throw new HttpsError('failed-precondition', 'Apply requiere confirmApply: true.');
  }
  return {
    mode: value.mode,
    confirmApply: value.confirmApply === true,
    startDate,
    ...(typeof endDate === 'string' ? { endDate } : {}),
  };
}

function operationComparator(left: MigrationOperation, right: MigrationOperation): number {
  return [left.collection, left.date, left.time, left.id, left.type].join('|')
    .localeCompare([right.collection, right.date, right.time, right.id, right.type].join('|'));
}

function safeExecutionComparator(left: MigrationOperation, right: MigrationOperation): number {
  if (left.type !== right.type) return left.type === 'set' ? -1 : 1;
  return operationComparator(left, right);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function documentsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function selectedEffectiveSlot(data: Record<string, unknown>): unknown {
  if (data.approvedSlot !== undefined && data.approvedSlot !== null) return data.approvedSlot;
  if (Array.isArray(data.preferredSlots) && data.preferredSlots.length > 0) return data.preferredSlots[0];
  return { date: data.date, time: data.time };
}

function validEffectiveAppointment(data: Record<string, unknown>): { date: string; time: string; duration: number } | undefined {
  const slot = selectedEffectiveSlot(data);
  if (!isRecord(slot) || !isIsoDate(slot.date) || !isTime(slot.time)) return undefined;
  const duration = Number(data.duration);
  if (!SUPPORTED_DURATIONS.has(duration)) return undefined;
  const blocks = getCanonicalSlotBlocks(slot.time, duration);
  if (blocks.length === 0) return undefined;
  return { date: slot.date, time: slot.time, duration };
}

function buildBaseReport(range: MigrationRange, operations: MigrationOperation[]): BaseMigrationReport {
  const created = operations.filter((operation) => operation.type === 'set' && operation.data?.__migrationWriteKind === 'create').length;
  const updated = operations.filter((operation) => operation.type === 'set' && operation.data?.__migrationWriteKind === 'update').length;
  const cleanedOperations = operations.map((operation) => {
    if (operation.type !== 'set' || !operation.data) return operation;
    const { __migrationWriteKind: _kind, ...data } = operation.data;
    return { ...operation, data };
  });
  operations.splice(0, operations.length, ...cleanedOperations);
  return {
    ...range,
    documentsToCreate: created,
    documentsToUpdate: updated,
    documentsToDelete: operations.filter((operation) => operation.type === 'delete').length,
    datesAffected: [...new Set(operations.map((operation) => operation.date))].sort(),
  };
}

export function planSlotOccupancyReconciliation(input: {
  appointments: StoredMigrationDocument[];
  occupancyDocuments: StoredMigrationDocument[];
} & MigrationRange): MigrationPlan<OccupancyMigrationReport> {
  const range: MigrationRange = { startDate: input.startDate, ...(input.endDate ? { endDate: input.endDate } : {}) };
  const expected = new Map<string, { date: string; time: string; count: number }>();
  let appointmentsProcessed = 0;
  let invalidAppointments = 0;

  for (const appointment of [...input.appointments].sort((left, right) => left.id.localeCompare(right.id))) {
    if (appointment.data.status !== 'approved') continue;
    const slot = selectedEffectiveSlot(appointment.data);
    const candidateDate = isRecord(slot) ? slot.date : undefined;
    if (isIsoDate(candidateDate) && !isInRange(candidateDate, range)) continue;
    const effective = validEffectiveAppointment(appointment.data);
    if (!effective) {
      invalidAppointments += 1;
      continue;
    }
    if (!isInRange(effective.date, range)) continue;
    appointmentsProcessed += 1;
    for (const time of getCanonicalSlotBlocks(effective.time, effective.duration)) {
      const id = slotOccupancyDocId(effective.date, time);
      const current = expected.get(id);
      expected.set(id, { date: effective.date, time, count: (current?.count ?? 0) + 1 });
    }
  }

  const actual = new Map(input.occupancyDocuments
    .filter((document) => isIsoDate(document.data.date) && isInRange(document.data.date, range))
    .map((document) => [document.id, document]));
  const operations: MigrationOperation[] = [];

  for (const [id, expectedData] of [...expected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = actual.get(id);
    if (!current) {
      operations.push({
        collection: 'slot_occupancy', date: expectedData.date, time: expectedData.time, id, type: 'set',
        data: { ...expectedData, __migrationWriteKind: 'create' },
      });
    } else if (!documentsEqual(current.data, expectedData)) {
      operations.push({
        collection: 'slot_occupancy', date: expectedData.date, time: expectedData.time, id, type: 'set',
        data: { ...expectedData, __migrationWriteKind: 'update' },
      });
    }
    actual.delete(id);
  }

  for (const document of [...actual.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const date = typeof document.data.date === 'string' ? document.data.date : range.startDate;
    const time = typeof document.data.time === 'string' ? document.data.time : '';
    operations.push({ collection: 'slot_occupancy', date, time, id: document.id, type: 'delete' });
  }

  operations.sort(operationComparator);
  const base = buildBaseReport(range, operations);
  return { report: { ...base, appointmentsProcessed, invalidAppointments }, operations };
}

interface LegacySource {
  id: string;
  reason?: string;
  createdBy?: string;
  createdAt?: string;
}

interface BlockGroupPlan {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  sourceSlotInterval: number;
  reason?: string;
  createdBy: string;
  createdAt: string;
  migratedFromLegacyIds: Set<string>;
  legacySources: Map<string, LegacySource>;
}

function legacySource(document: StoredMigrationDocument): LegacySource {
  return {
    id: document.id,
    ...(typeof document.data.reason === 'string' ? { reason: document.data.reason } : {}),
    ...(typeof document.data.createdBy === 'string' ? { createdBy: document.data.createdBy } : {}),
    ...(typeof document.data.createdAt === 'string' ? { createdAt: document.data.createdAt } : {}),
  };
}

function deterministicBlockGroupId(date: string, startTime: string, durationMinutes: number): string {
  return `${date}_${startTime}_${durationMinutes}`;
}

export function planLegacyBlockedSlotMigration(input: {
  blockedDocuments: StoredMigrationDocument[];
} & MigrationRange): MigrationPlan<BlockedMigrationReport> {
  const range: MigrationRange = { startDate: input.startDate, ...(input.endDate ? { endDate: input.endDate } : {}) };
  const groups = new Map<string, BlockGroupPlan>();
  const actual = new Map<string, StoredMigrationDocument>();
  let legacyDocumentsProcessed = 0;
  let invalidDocuments = 0;

  for (const document of [...input.blockedDocuments].sort((left, right) => left.id.localeCompare(right.id))) {
    const { data } = document;
    if (!isIsoDate(data.date) || !isInRange(data.date, range)) continue;
    actual.set(document.id, document);
    const canonical = typeof data.blockGroupId === 'string'
      && isTime(data.groupStartTime)
      && typeof data.groupDurationMinutes === 'number'
      && SUPPORTED_INTERVALS.has(data.groupDurationMinutes);
    const startTime = canonical ? data.groupStartTime as string : data.time;
    const durationMinutes = canonical ? data.groupDurationMinutes as number : 30;
    if (!isTime(startTime) || getCanonicalSlotBlocks(startTime, durationMinutes).length === 0) {
      invalidDocuments += 1;
      continue;
    }
    if (!canonical) legacyDocumentsProcessed += 1;
    const groupId = deterministicBlockGroupId(data.date, startTime, durationMinutes);
    let group = groups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        date: data.date,
        startTime,
        durationMinutes,
        sourceSlotInterval: typeof data.sourceSlotInterval === 'number' && SUPPORTED_INTERVALS.has(data.sourceSlotInterval)
          ? data.sourceSlotInterval
          : durationMinutes,
        ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
        createdBy: typeof data.createdBy === 'string' ? data.createdBy : 'legacy',
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        migratedFromLegacyIds: new Set<string>(),
        legacySources: new Map<string, LegacySource>(),
      };
      groups.set(groupId, group);
    }
    if (!canonical) {
      group.migratedFromLegacyIds.add(document.id);
      group.legacySources.set(document.id, legacySource(document));
    }
    if (Array.isArray(data.migratedFromLegacyIds)) {
      data.migratedFromLegacyIds.filter((id): id is string => typeof id === 'string').forEach((id) => group?.migratedFromLegacyIds.add(id));
    }
    if (Array.isArray(data.legacySources)) {
      data.legacySources.filter(isRecord).forEach((source) => {
        if (typeof source.id === 'string') {
          group?.legacySources.set(source.id, {
            id: source.id,
            ...(typeof source.reason === 'string' ? { reason: source.reason } : {}),
            ...(typeof source.createdBy === 'string' ? { createdBy: source.createdBy } : {}),
            ...(typeof source.createdAt === 'string' ? { createdAt: source.createdAt } : {}),
          });
        }
      });
    }
  }

  const expected = new Map<string, Record<string, unknown>>();
  const expectedGroupById = new Map<string, string>();
  for (const group of [...groups.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const time of getCanonicalSlotBlocks(group.startTime, group.durationMinutes)) {
      const id = slotOccupancyDocId(group.date, time);
      const existingGroup = expectedGroupById.get(id);
      if (existingGroup && existingGroup !== group.id) {
        invalidDocuments += 1;
        continue;
      }
      expectedGroupById.set(id, group.id);
      const migratedFromLegacyIds = [...group.migratedFromLegacyIds].sort();
      const legacySources = [...group.legacySources.values()].sort((left, right) => left.id.localeCompare(right.id));
      expected.set(id, {
        date: group.date,
        time,
        ...(group.reason ? { reason: group.reason } : {}),
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        blockGroupId: group.id,
        groupStartTime: group.startTime,
        groupDurationMinutes: group.durationMinutes,
        sourceSlotInterval: group.sourceSlotInterval,
        ...(migratedFromLegacyIds.length > 0 ? { migratedFromLegacyIds } : {}),
        ...(legacySources.length > 0 ? { legacySources } : {}),
      });
    }
  }

  const operations: MigrationOperation[] = [];
  for (const [id, expectedData] of [...expected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const current = actual.get(id);
    const date = String(expectedData.date);
    const time = String(expectedData.time);
    if (!current) {
      operations.push({ collection: 'blocked_slots', date, time, id, type: 'set', data: { ...expectedData, __migrationWriteKind: 'create' } });
    } else if (!documentsEqual(current.data, expectedData)) {
      operations.push({ collection: 'blocked_slots', date, time, id, type: 'set', data: { ...expectedData, __migrationWriteKind: 'update' } });
    }
    actual.delete(id);
  }
  for (const document of [...actual.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    operations.push({
      collection: 'blocked_slots',
      date: typeof document.data.date === 'string' ? document.data.date : range.startDate,
      time: typeof document.data.time === 'string' ? document.data.time : '',
      id: document.id,
      type: 'delete',
    });
  }

  operations.sort(operationComparator);
  const base = buildBaseReport(range, operations);
  return {
    report: {
      ...base,
      legacyDocumentsProcessed,
      blockGroupsResulting: groups.size,
      invalidDocuments,
    },
    operations,
  };
}

export async function applyMigrationOperations(
  db: Pick<Firestore, 'batch' | 'collection'>,
  operations: MigrationOperation[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('El tamaño de batch debe estar entre 1 y 500.');
  }
  // Persist every absolute destination before deleting any source. If a later
  // batch fails, a fresh plan can reconstruct all legacy metadata from the
  // canonical documents that already contain the complete source trace.
  const sorted = [...operations].sort(safeExecutionComparator);
  for (let index = 0; index < sorted.length; index += batchSize) {
    const batch = db.batch();
    for (const operation of sorted.slice(index, index + batchSize)) {
      const ref = db.collection(operation.collection).doc(operation.id);
      if (operation.type === 'delete') batch.delete(ref);
      else batch.set(ref, operation.data ?? {});
    }
    await batch.commit();
  }
}

async function requireAdminRequest(request: MigrationCallableRequest, deps: SlotMigrationDeps): Promise<void> {
  if (!request.auth) throw new HttpsError('permission-denied', 'Debes iniciar sesión como admin.');
  await deps.requireAdmin(request.auth.uid);
}

export function createSlotMigrationHandlers(deps: SlotMigrationDeps) {
  return {
    reconcileSlotOccupancyFromApprovedAppointments: async (request: MigrationCallableRequest) => {
      await requireAdminRequest(request, deps);
      const parsed = parseMigrationInput(request.data, deps.getTodayMadrid());
      const range: MigrationRange = { startDate: parsed.startDate, ...(parsed.endDate ? { endDate: parsed.endDate } : {}) };
      const [appointments, occupancyDocuments] = await Promise.all([
        deps.readApprovedAppointments(range),
        deps.readOccupancyDocuments(range),
      ]);
      const plan = planSlotOccupancyReconciliation({ ...range, appointments, occupancyDocuments });
      if (parsed.mode === 'apply' && plan.report.invalidAppointments > 0) {
        throw new HttpsError('failed-precondition', 'Hay citas aprobadas inválidas; no se ha escrito ningún documento.');
      }
      if (parsed.mode === 'apply') await deps.applyOperations(plan.operations);
      return { mode: parsed.mode, applied: parsed.mode === 'apply', ...plan.report };
    },

    migrateLegacyBlockedSlots: async (request: MigrationCallableRequest) => {
      await requireAdminRequest(request, deps);
      const parsed = parseMigrationInput(request.data, deps.getTodayMadrid());
      const range: MigrationRange = { startDate: parsed.startDate, ...(parsed.endDate ? { endDate: parsed.endDate } : {}) };
      const blockedDocuments = await deps.readBlockedSlotDocuments(range);
      const plan = planLegacyBlockedSlotMigration({ ...range, blockedDocuments });
      if (parsed.mode === 'apply' && plan.report.invalidDocuments > 0) {
        throw new HttpsError('failed-precondition', 'Hay bloqueos inválidos o solapados; no se ha escrito ningún documento.');
      }
      if (parsed.mode === 'apply') await deps.applyOperations(plan.operations);
      return { mode: parsed.mode, applied: parsed.mode === 'apply', ...plan.report };
    },
  };
}
