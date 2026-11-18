import { describe, expect, it } from 'vitest';
import { bonoEffectiveMinutes, validBonoMinutes } from './bono-minutes';
import { getBonoMinutosRestantes, getBonoMinutosTotales, bonoCapacityLabel, type Bono } from '@/types';
import { calculateManualBonoAdjustment } from './bono-adjustments';

describe('effective bono capacity', () => {
    it.each([300, 240, 180, 0])('keeps %i available minutes in a 240 + 60 bono', (remaining) => {
        const bono = { tamano: 240, minutosTotales: 300, minutosCapacidadBase: 240, minutosExtraRecuperados: 60, minutosRestantes: remaining, estado: 'activo' } as Bono;
        expect(bonoEffectiveMinutes(bono)).toBe(300);
        expect(getBonoMinutosTotales(bono)).toBe(300);
        expect(getBonoMinutosRestantes(bono)).toBe(remaining);
        expect(bonoCapacityLabel(bono)).toBe('240 min contratados + 60 recuperados');
        expect(validBonoMinutes(bono)).toBe(true);
    });
    it('preserves historical extensions independently of recovered extras', () => {
        expect(bonoEffectiveMinutes({ tamano: 240, minutosTotales: 270 })).toBe(270);
        expect(bonoCapacityLabel({ tamano: 240, minutosTotales: 270 } as Bono)).toBe('240 min contratados + 30 de ampliaciones previas');
        expect(bonoEffectiveMinutes({ tamano: 240, minutosCapacidadBase: 270, minutosExtraRecuperados: 60, minutosTotales: 330 })).toBe(330);
    });
    it('refuses corrupt effective limits and manual capacity expansion', () => {
        expect(validBonoMinutes({ tamano: 240, minutosCapacidadBase: 240, minutosExtraRecuperados: 60, minutosTotales: 240 })).toBe(false);
        expect(calculateManualBonoAdjustment({ tamano: 240, minutosTotales: 300, minutosCapacidadBase: 240, minutosExtraRecuperados: 60, minutosRestantes: 300, estado: 'activo' }, 30)).toEqual({ ok: false, reason: 'capacity-exceeded' });
    });
});
