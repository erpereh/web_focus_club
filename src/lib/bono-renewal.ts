import type { CommitBonoRenewalResult, RenewalItem, RenewalItemReason } from '@/lib/firestore';
import type { Bono, TimeSlot } from '@/types';

/**
 * Estado del flujo "Repetir citas del bono anterior" en el modal de asignar
 * bono. La validación real siempre la hace Functions; aquí solo se decide qué
 * se envía y cómo se resume.
 */
export type RenewalDecision = 'include' | 'skip';

export interface RenewalRow extends RenewalItem {
    decision: RenewalDecision;
}

export const RENEWAL_REASON_LABELS: Record<RenewalItemReason, string> = {
    slot_not_future: 'La franja ya ha pasado',
    outside_schedule: 'Fuera del horario del centro',
    slot_blocked: 'Franja bloqueada',
    slot_full: 'Franja completa (aforo máximo)',
    appointment_conflict: 'Conflicto con otra cita del cliente',
    trainer_unavailable: 'Entrenador no disponible (inactivo o eliminado)',
    trainer_not_nutrition: 'El profesional no atiende nutrición',
    professional_conflict: 'El profesional ya tiene otra cita',
    insufficient_minutes: 'No quedan minutos suficientes en el nuevo bono',
    outside_bono_period: 'Fuera de la validez del nuevo bono',
    already_created: 'Ya creada en un intento anterior',
};

export function renewalReasonLabel(reason: RenewalItemReason | string | undefined): string {
    if (!reason) return '';
    return RENEWAL_REASON_LABELS[reason as RenewalItemReason] ?? reason;
}

/** Un conflicto de minutos no se arregla moviendo la cita: solo se puede omitir. */
export function canRescheduleRenewalRow(row: RenewalRow): boolean {
    return row.status === 'conflict' && row.reason !== 'insufficient_minutes' && row.reason !== 'already_created';
}

export function rowsFromPreview(items: RenewalItem[]): RenewalRow[] {
    return items.map((item) => ({ ...item, decision: 'include' }));
}

/** Aplica una revalidación del servidor sin perder decisiones ni filas ya creadas. */
export function applyValidation(rows: RenewalRow[], items: RenewalItem[]): RenewalRow[] {
    const byKey = new Map(items.map((item) => [item.key, item]));
    return rows.map((row) => {
        const next = byKey.get(row.key);
        if (!next || row.status === 'created') return row;
        return { ...row, ...next, decision: row.decision };
    });
}

export function setRowDecision(rows: RenewalRow[], key: string, decision: RenewalDecision): RenewalRow[] {
    return rows.map((row) => (row.key === key && row.status !== 'created' ? { ...row, decision } : row));
}

function sameSlot(a: TimeSlot, b: TimeSlot): boolean {
    return a.date === b.date && a.time === b.time;
}

/** Cambio manual de fecha/hora: queda pendiente de revalidar en el servidor. */
export function changeRowSlot(
    rows: RenewalRow[],
    key: string,
    slot: TimeSlot,
    trainer: { id: string | null; name?: string },
): RenewalRow[] {
    return rows.map((row) => {
        if (row.key !== key || row.status === 'created') return row;
        return {
            ...row,
            slot,
            trainerId: trainer.id,
            trainerName: trainer.name ?? '',
            modified: !sameSlot(slot, row.originalSlot) || trainer.id !== row.trainerId || row.modified === true,
            decision: 'include',
        };
    });
}

/** Filas a enviar al servidor (validación o creación). */
export function rowsToSubmit(rows: RenewalRow[]): RenewalItem[] {
    return rows
        .filter((row) => row.decision === 'include' && row.status !== 'created')
        .map(({ decision: _decision, ...item }) => item);
}

export function readyRowsToCommit(rows: RenewalRow[]): RenewalItem[] {
    return rowsToSubmit(rows).filter((item) => item.status === 'ready');
}

export function skippedPayload(rows: RenewalRow[]): Array<{ key: string; originalSlot: TimeSlot; reason: string }> {
    return rows
        .filter((row) => row.decision === 'skip' && row.status !== 'created')
        .map((row) => ({ key: row.key, originalSlot: row.originalSlot, reason: row.reason ?? 'skipped_by_admin' }));
}

/** Lo que falta resolver antes de poder confirmar: conflictos incluidos. */
export function unresolvedConflicts(rows: RenewalRow[]): RenewalRow[] {
    return rows.filter((row) => row.decision === 'include' && row.status === 'conflict');
}

export function applyCommitResult(rows: RenewalRow[], result: CommitBonoRenewalResult): RenewalRow[] {
    const created = new Map([...result.created, ...result.alreadyCreated].map((item) => [item.key, item]));
    const conflicts = new Map(result.conflicts.map((item) => [item.key, item]));
    return rows.map((row) => {
        const done = created.get(row.key);
        if (done) return { ...row, ...done, status: 'created', decision: 'include' };
        const conflict = conflicts.get(row.key);
        if (conflict) return { ...row, ...conflict, status: 'conflict', decision: row.decision };
        return row;
    });
}

/** Minutos que quedan para validar el resto, descontando lo ya creado. */
export function remainingMinutesForValidation(bonoMinutes: number, rows: RenewalRow[]): number {
    const used = rows
        .filter((row) => row.status === 'created')
        .reduce((total, row) => total + row.durationMinutes, 0);
    return Math.max(0, bonoMinutes - used);
}

export interface RenewalSummary {
    created: RenewalRow[];
    modified: RenewalRow[];
    skipped: RenewalRow[];
}

export function summarizeRenewal(rows: RenewalRow[]): RenewalSummary {
    const created = rows.filter((row) => row.status === 'created');
    return {
        created,
        modified: created.filter((row) => row.modified === true),
        skipped: rows.filter((row) => row.decision === 'skip' && row.status !== 'created'),
    };
}

/**
 * Bono de referencia para repetir citas: el más reciente del cliente que no
 * esté eliminado (puede ser el activo que se va a reemplazar).
 */
export function findPreviousBono(bonos: Bono[]): Bono | undefined {
    return [...bonos]
        .filter((bono) => bono.estado !== 'eliminado')
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
}

/** Id de renovación estable para reintentos (el servidor deriva de él los ids de las citas). */
export function newRenewalId(random: () => string = () => crypto.randomUUID()): string {
    return `ren_${random().replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
}
