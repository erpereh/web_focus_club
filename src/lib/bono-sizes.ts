/**
 * Tamaños de bono configurables (Admin → Configuración → Configuración de Bonos).
 * Se guardan en minutos en `site_config/main.bonoSizesMinutes`, en el orden en
 * que el admin quiere verlos. La normalización coincide con la de Functions
 * (`functions/src/siteConfig.ts`).
 */
export const DEFAULT_BONO_SIZES_MINUTES: readonly number[] = [240, 360, 480];
export const BONO_SIZE_STEP_MINUTES = 30;
export const MAX_BONO_SIZES = 20;
export const MAX_BONO_SIZE_MINUTES = 100 * 60;

export function normalizeBonoSizesMinutes(value: unknown): number[] {
    if (!Array.isArray(value)) return [...DEFAULT_BONO_SIZES_MINUTES];
    const sizes: number[] = [];
    for (const entry of value) {
        const minutes = typeof entry === 'number' ? entry : Number(entry);
        if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_BONO_SIZE_MINUTES) continue;
        if (minutes % BONO_SIZE_STEP_MINUTES !== 0 || sizes.includes(minutes)) continue;
        sizes.push(minutes);
        if (sizes.length === MAX_BONO_SIZES) break;
    }
    return sizes.length ? sizes : [...DEFAULT_BONO_SIZES_MINUTES];
}

export type BonoSizeValidation =
    | { ok: true; minutes: number }
    | { ok: false; error: string };

/** Valida un tamaño introducido por el admin en horas (admite medias horas: "10", "10,5"). */
export function parseBonoSizeHours(input: string, existing: readonly number[]): BonoSizeValidation {
    const normalized = input.trim().replace(',', '.');
    if (!normalized) return { ok: false, error: 'Introduce el número de horas.' };
    const hours = Number(normalized);
    if (!Number.isFinite(hours) || hours <= 0) {
        return { ok: false, error: 'El tamaño debe ser mayor que 0.' };
    }
    const minutes = Math.round(hours * 60);
    if (Math.abs(hours * 60 - minutes) > 1e-9 || minutes % BONO_SIZE_STEP_MINUTES !== 0) {
        return { ok: false, error: 'Usa horas completas o medias horas (por ejemplo 10 o 10,5).' };
    }
    if (minutes > MAX_BONO_SIZE_MINUTES) {
        return { ok: false, error: `El tamaño máximo es ${MAX_BONO_SIZE_MINUTES / 60} h.` };
    }
    if (existing.includes(minutes)) return { ok: false, error: 'Ese tamaño ya existe.' };
    if (existing.length >= MAX_BONO_SIZES) {
        return { ok: false, error: `Puedes configurar como máximo ${MAX_BONO_SIZES} tamaños.` };
    }
    return { ok: true, minutes };
}

export function addBonoSize(sizes: readonly number[], minutes: number): number[] {
    return sizes.includes(minutes) ? [...sizes] : [...sizes, minutes];
}

/** El último tamaño no se puede eliminar: el modal de asignación siempre necesita al menos uno. */
export function removeBonoSize(sizes: readonly number[], minutes: number): number[] {
    const next = sizes.filter((size) => size !== minutes);
    return next.length ? next : [...sizes];
}

export function moveBonoSize(sizes: readonly number[], index: number, direction: -1 | 1): number[] {
    const target = index + direction;
    if (index < 0 || index >= sizes.length || target < 0 || target >= sizes.length) return [...sizes];
    const next = [...sizes];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export function sortBonoSizes(sizes: readonly number[]): number[] {
    return [...sizes].sort((a, b) => a - b);
}

/** "4h", "10h 30min" — etiqueta de un tamaño en minutos. */
export function formatBonoSize(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${rest}min`;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
}
