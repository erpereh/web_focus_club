import { describe, expect, it } from 'vitest';
import {
    addBonoSize,
    formatBonoSize,
    moveBonoSize,
    normalizeBonoSizesMinutes,
    parseBonoSizeHours,
    removeBonoSize,
    sortBonoSizes,
} from './bono-sizes';
import { normalizeSiteConfig, sanitizeSiteConfigUpdate } from './site-config';

describe('bono sizes', () => {
    it('keeps 4h / 6h / 8h for configs saved before sizes were configurable', () => {
        expect(normalizeSiteConfig({}).bonoSizesMinutes).toEqual([240, 360, 480]);
        expect(normalizeBonoSizesMinutes(undefined)).toEqual([240, 360, 480]);
        expect(normalizeBonoSizesMinutes([])).toEqual([240, 360, 480]);
    });

    it('accepts any positive size in half hours, keeping order and dropping duplicates', () => {
        expect(normalizeBonoSizesMinutes([240, 360, 480, 600, 720])).toEqual([240, 360, 480, 600, 720]);
        expect(normalizeBonoSizesMinutes([720, 240, 240, '630', 0, -60, 45, 'x'])).toEqual([720, 240, 630]);
        expect(sanitizeSiteConfigUpdate({ bonoSizesMinutes: [600, 600, 300] })).toEqual({ bonoSizesMinutes: [600, 300] });
    });

    it('validates new sizes typed in hours', () => {
        expect(parseBonoSizeHours('10', [240])).toEqual({ ok: true, minutes: 600 });
        expect(parseBonoSizeHours('10,5', [240])).toEqual({ ok: true, minutes: 630 });
        expect(parseBonoSizeHours('0', [])).toMatchObject({ ok: false, error: 'El tamaño debe ser mayor que 0.' });
        expect(parseBonoSizeHours('-2', [])).toMatchObject({ ok: false });
        expect(parseBonoSizeHours('', [])).toMatchObject({ ok: false });
        expect(parseBonoSizeHours('abc', [])).toMatchObject({ ok: false });
        expect(parseBonoSizeHours('4,25', [])).toMatchObject({ ok: false });
        expect(parseBonoSizeHours('4', [240])).toEqual({ ok: false, error: 'Ese tamaño ya existe.' });
    });

    it('adds, removes (never the last one), moves and sorts sizes', () => {
        expect(addBonoSize([240], 600)).toEqual([240, 600]);
        expect(addBonoSize([240], 240)).toEqual([240]);
        expect(removeBonoSize([240, 360], 240)).toEqual([360]);
        expect(removeBonoSize([240], 240)).toEqual([240]);
        expect(moveBonoSize([240, 360, 480], 2, -1)).toEqual([240, 480, 360]);
        expect(moveBonoSize([240, 360], 0, -1)).toEqual([240, 360]);
        expect(sortBonoSizes([720, 240, 480])).toEqual([240, 480, 720]);
    });

    it('formats sizes for buttons', () => {
        expect(formatBonoSize(240)).toBe('4h');
        expect(formatBonoSize(630)).toBe('10h 30min');
        expect(formatBonoSize(30)).toBe('30min');
    });
});
