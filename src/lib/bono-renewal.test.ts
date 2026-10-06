import { describe, expect, it } from 'vitest';
import {
    applyCommitResult,
    applyValidation,
    canRescheduleRenewalRow,
    changeRowSlot,
    findPreviousBono,
    newRenewalId,
    readyRowsToCommit,
    remainingMinutesForValidation,
    renewalReasonLabel,
    rowsFromPreview,
    setRowDecision,
    skippedPayload,
    summarizeRenewal,
    unresolvedConflicts,
} from './bono-renewal';
import type { RenewalItem } from './firestore';
import type { Bono } from '@/types';

function item(key: string, overrides: Partial<RenewalItem> = {}): RenewalItem {
    const slot = { date: `2026-10-${key.padStart(2, '0')}`, time: '18:00' };
    return {
        key,
        sourceSeriesId: 's1',
        originalSlot: slot,
        slot,
        durationMinutes: 60,
        trainerId: 't1',
        trainerName: 'Ana',
        serviceType: 'Bono',
        sessionType: '',
        status: 'ready',
        ...overrides,
    };
}

describe('bono renewal state', () => {
    const preview = [
        item('15'),
        item('22', { status: 'conflict', reason: 'slot_blocked' }),
        item('29', { status: 'conflict', reason: 'insufficient_minutes' }),
    ];

    it('starts with every preview item included and reports conflicts to resolve', () => {
        const rows = rowsFromPreview(preview);
        expect(rows.every((row) => row.decision === 'include')).toBe(true);
        expect(unresolvedConflicts(rows).map((row) => row.key)).toEqual(['22', '29']);
        expect(readyRowsToCommit(rows).map((row) => row.key)).toEqual(['15']);
    });

    it('skipping a conflict resolves it and records the reason', () => {
        const rows = setRowDecision(rowsFromPreview(preview), '29', 'skip');
        expect(unresolvedConflicts(rows).map((row) => row.key)).toEqual(['22']);
        expect(skippedPayload(rows)).toEqual([{ key: '29', originalSlot: preview[2].originalSlot, reason: 'insufficient_minutes' }]);
        expect(setRowDecision(rows, '29', 'include').find((row) => row.key === '29')?.decision).toBe('include');
    });

    it('a manual date/time change is marked modified and revalidated by the server', () => {
        let rows = changeRowSlot(rowsFromPreview(preview), '22', { date: '2026-10-23', time: '18:00' }, { id: 't1', name: 'Ana' });
        const changed = rows.find((row) => row.key === '22')!;
        expect(changed.modified).toBe(true);
        expect(changed.originalSlot).toEqual({ date: '2026-10-22', time: '18:00' });
        rows = applyValidation(rows, [{ ...changed, status: 'ready', reason: undefined }]);
        expect(rows.find((row) => row.key === '22')).toMatchObject({ status: 'ready', modified: true, decision: 'include' });
        expect(unresolvedConflicts(rows).map((row) => row.key)).toEqual(['29']);
    });

    it('only some conflicts can be fixed by moving the appointment', () => {
        const rows = rowsFromPreview(preview);
        expect(canRescheduleRenewalRow(rows[1])).toBe(true);
        expect(canRescheduleRenewalRow(rows[2])).toBe(false);
        expect(canRescheduleRenewalRow(rows[0])).toBe(false);
    });

    it('applies a partial commit: created rows are locked, race conflicts come back', () => {
        let rows = setRowDecision(rowsFromPreview(preview), '29', 'skip');
        rows = changeRowSlot(rows, '22', { date: '2026-10-23', time: '18:00' }, { id: 't1' });
        rows = applyValidation(rows, [{ ...rows[1], status: 'ready' }]);
        rows = applyCommitResult(rows, {
            success: true,
            renewalId: 'ren_1',
            created: [{ ...rows[0], status: 'created', appointmentId: 'a1' }],
            alreadyCreated: [],
            conflicts: [{ ...rows[1], status: 'conflict', reason: 'slot_full' }],
        });
        expect(rows.map((row) => [row.key, row.status])).toEqual([['15', 'created'], ['22', 'conflict'], ['29', 'conflict']]);
        expect(setRowDecision(rows, '15', 'skip')[0].decision).toBe('include');
        expect(remainingMinutesForValidation(360, rows)).toBe(300);
        expect(readyRowsToCommit(rows)).toEqual([]);
        const summary = summarizeRenewal(rows);
        expect(summary.created.map((row) => row.key)).toEqual(['15']);
        expect(summary.skipped.map((row) => row.key)).toEqual(['29']);
    });

    it('labels every reason in Spanish', () => {
        expect(renewalReasonLabel('slot_full')).toBe('Franja completa (aforo máximo)');
        expect(renewalReasonLabel('trainer_unavailable')).toMatch(/Entrenador no disponible/);
        expect(renewalReasonLabel('outside_schedule')).toBe('Fuera del horario del centro');
    });

    it('takes the most recent non-deleted bono as the previous one', () => {
        const bonos = [
            { id: 'old', estado: 'agotado', createdAt: '2026-08-01T00:00:00Z' },
            { id: 'deleted', estado: 'eliminado', createdAt: '2026-10-01T00:00:00Z' },
            { id: 'current', estado: 'activo', createdAt: '2026-09-01T00:00:00Z' },
        ] as Bono[];
        expect(findPreviousBono(bonos)?.id).toBe('current');
        expect(findPreviousBono([])).toBeUndefined();
    });

    it('builds stable, server-safe renewal ids', () => {
        expect(newRenewalId(() => 'a1b2-c3d4-e5f6')).toBe('ren_a1b2c3d4e5f6');
        expect(newRenewalId()).toMatch(/^ren_[A-Za-z0-9]{8,32}$/);
    });
});
