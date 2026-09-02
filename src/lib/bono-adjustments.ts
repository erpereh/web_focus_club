export const ALLOWED_BONO_ADJUSTMENTS = new Set([-45, -30, 30, 45]);

export type ManualBonoStatus = 'activo' | 'agotado' | 'expirado' | 'eliminado';

export interface ManualBonoInput {
    tamano?: number;
    minutosTotales?: number;
    minutosRestantes?: number;
    sesionesTotales?: number;
    sesionesRestantes?: number;
    modalidad?: string;
    estado: ManualBonoStatus;
}

export interface ManualBonoHistorialEntry {
    fecha: string;
    tipo: string;
    duracion: string;
    appointmentId: string;
}

export type ManualBonoAdjustmentResult =
    | { ok: false; reason: 'invalid-argument' | 'insufficient-minutes' }
    | {
        ok: true;
        delta: number;
        minutosRestantes: number;
        minutosTotales: number;
        estado: ManualBonoStatus;
        historialEntry?: ManualBonoHistorialEntry;
    };

function getBonoMaxMinutes(bono: ManualBonoInput): number {
    if (typeof bono.tamano === 'number' && typeof bono.minutosTotales === 'number') {
        return Math.max(bono.tamano, bono.minutosTotales);
    }
    if (typeof bono.minutosTotales === 'number') return bono.minutosTotales;
    if (typeof bono.tamano === 'number') return bono.tamano;
    const minPerSession = bono.modalidad === '30min' ? 30 : 60;
    return (bono.sesionesTotales ?? 0) * minPerSession;
}

function getBonoRemainingMinutes(bono: ManualBonoInput): number {
    const maxMinutes = getBonoMaxMinutes(bono);
    const rawRemaining = typeof bono.minutosRestantes === 'number'
        ? bono.minutosRestantes
        : (bono.sesionesRestantes ?? 0) * (bono.modalidad === '30min' ? 30 : 60);
    return Math.max(0, Math.min(rawRemaining, maxMinutes));
}

/**
 * Pure admin ±30/±45 adjustment. Preserves current add/deduct semantics:
 * add can raise minutosTotales and reactivate agotado; deduct never goes negative
 * and writes a "Deducción manual" historial entry.
 */
export function calculateManualBonoAdjustment(
    bono: ManualBonoInput,
    delta: number,
    nowIso = new Date().toISOString(),
): ManualBonoAdjustmentResult {
    if (!ALLOWED_BONO_ADJUSTMENTS.has(delta)) {
        return { ok: false, reason: 'invalid-argument' };
    }

    const maxMinutes = getBonoMaxMinutes(bono);
    const currentRemaining = getBonoRemainingMinutes(bono);

    if (delta < 0) {
        const minutes = Math.abs(delta);
        if (currentRemaining < minutes) {
            return { ok: false, reason: 'insufficient-minutes' };
        }
        const minutosRestantes = Math.max(0, currentRemaining - minutes);
        return {
            ok: true,
            delta,
            minutosRestantes,
            minutosTotales: maxMinutes,
            estado: minutosRestantes <= 0 ? 'agotado' : 'activo',
            historialEntry: {
                fecha: nowIso,
                tipo: 'Deducción manual',
                duracion: String(minutes),
                appointmentId: 'manual',
            },
        };
    }

    const minutosRestantes = Math.max(0, currentRemaining + delta);
    return {
        ok: true,
        delta,
        minutosRestantes,
        minutosTotales: Math.max(maxMinutes, minutosRestantes),
        estado: minutosRestantes > 0 ? 'activo' : bono.estado,
    };
}

export function manualBonoAdjustmentErrorMessage(reason: 'invalid-argument' | 'insufficient-minutes'): string {
    if (reason === 'insufficient-minutes') return 'Minutos insuficientes en el bono';
    return 'El ajuste de minutos no es válido.';
}
