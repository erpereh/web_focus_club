import { describe, expect, it } from 'vitest';
import { ALLOWED_BONO_ADJUSTMENTS, calculateManualBonoAdjustment } from './bono-adjustments';

const now = '2026-09-02T10:00:00.000Z';

function bono(overrides: Partial<Parameters<typeof calculateManualBonoAdjustment>[0]> = {}) {
    return {
        estado: 'activo' as const,
        minutosTotales: 120,
        minutosRestantes: 120,
        ...overrides,
    };
}

describe('ALLOWED_BONO_ADJUSTMENTS', () => {
    it('accepts only ±30 and ±45', () => {
        expect(ALLOWED_BONO_ADJUSTMENTS).toEqual(new Set([-45, -30, 30, 45]));
    });
});

describe('calculateManualBonoAdjustment', () => {
    it('keeps +30 and -30 working', () => {
        expect(calculateManualBonoAdjustment(bono({ minutosRestantes: 90 }), 30, now)).toMatchObject({
            ok: true,
            minutosRestantes: 120,
            minutosTotales: 120,
            estado: 'activo',
        });
        expect(calculateManualBonoAdjustment(bono({ minutosRestantes: 90 }), -30, now)).toMatchObject({
            ok: true,
            minutosRestantes: 60,
            minutosTotales: 120,
            estado: 'activo',
            historialEntry: { duracion: '30', tipo: 'Deducción manual', appointmentId: 'manual' },
        });
    });

    it('applies +45 and -45 with the same semantics', () => {
        expect(calculateManualBonoAdjustment(bono({ minutosRestantes: 75 }), -45, now)).toMatchObject({
            ok: true,
            minutosRestantes: 30,
            estado: 'activo',
            historialEntry: { duracion: '45' },
        });
        expect(calculateManualBonoAdjustment(bono({ minutosRestantes: 0, estado: 'agotado' }), 45, now)).toMatchObject({
            ok: true,
            minutosRestantes: 45,
            minutosTotales: 120,
            estado: 'activo',
        });
    });

    it('marks agotado when 45 remaining is deducted by 45', () => {
        const result = calculateManualBonoAdjustment(bono({ minutosRestantes: 45 }), -45, now);
        expect(result).toMatchObject({
            ok: true,
            minutosRestantes: 0,
            minutosTotales: 120,
            estado: 'agotado',
            historialEntry: { duracion: '45', tipo: 'Deducción manual' },
        });
    });

    it('rejects deducting more minutes than remaining', () => {
        expect(calculateManualBonoAdjustment(bono({ minutosRestantes: 30 }), -45, now)).toEqual({
            ok: false,
            reason: 'insufficient-minutes',
        });
    });

    it('rejects arbitrary deltas', () => {
        expect(calculateManualBonoAdjustment(bono(), 15, now)).toEqual({ ok: false, reason: 'invalid-argument' });
        expect(calculateManualBonoAdjustment(bono(), 60, now)).toEqual({ ok: false, reason: 'invalid-argument' });
        expect(calculateManualBonoAdjustment(bono(), -999, now)).toEqual({ ok: false, reason: 'invalid-argument' });
    });

    it('can raise minutosTotales when adding above the current max', () => {
        expect(calculateManualBonoAdjustment(bono({ minutosTotales: 30, minutosRestantes: 30 }), 45, now)).toMatchObject({
            ok: true,
            minutosRestantes: 75,
            minutosTotales: 75,
            estado: 'activo',
        });
    });
});
