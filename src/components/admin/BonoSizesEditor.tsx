'use client';

import { useState } from 'react';
import { AlertCircle, ArrowDown, ArrowDownUp, ArrowUp, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
    addBonoSize,
    formatBonoSize,
    moveBonoSize,
    parseBonoSizeHours,
    removeBonoSize,
    sortBonoSizes,
} from '@/lib/bono-sizes';

export interface BonoSizesEditorProps {
    /** Tamaños guardados en `site_config/main` (minutos). */
    savedSizes: number[];
    onSave: (sizes: number[]) => Promise<void>;
}

function sameSizes(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Gestión de los tamaños de bono que ofrece "Asignar Bono". Guardar aquí no
 * toca los bonos ya asignados ni recalcula su expiración. El padre lo monta
 * con `key` derivada de los tamaños guardados para reiniciar el borrador.
 */
export function BonoSizesEditor({ savedSizes, onSave }: BonoSizesEditorProps) {
    const [sizes, setSizes] = useState<number[]>(savedSizes);
    const [newHours, setNewHours] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const dirty = !sameSizes(sizes, savedSizes);

    const handleAdd = () => {
        const parsed = parseBonoSizeHours(newHours, sizes);
        if (!parsed.ok) {
            setError(parsed.error);
            return;
        }
        setSizes(addBonoSize(sizes, parsed.minutes));
        setNewHours('');
        setError('');
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            await onSave(sizes);
        } catch (saveError) {
            console.error('Error saving bono sizes:', saveError);
            setError('No se han podido guardar los tamaños de bono.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-6 border-t border-white/10 pt-6" data-testid="bono-sizes-editor">
            <h3 className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">Tamaños de bono disponibles</h3>
            <p className="mb-4 text-xs text-[var(--color-text-secondary)]">
                Son las opciones que aparecen al asignar un bono. Los bonos ya asignados conservan su tamaño.
            </p>

            <ul className="space-y-2" aria-label="Tamaños de bono">
                {sizes.map((minutes, index) => (
                    <li key={minutes} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-muted/20 px-3 py-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{formatBonoSize(minutes)} / mes</span>
                        <span className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label={`Subir ${formatBonoSize(minutes)}`}
                                disabled={index === 0 || saving}
                                onClick={() => setSizes(moveBonoSize(sizes, index, -1))}
                                className="rounded-md p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={`Bajar ${formatBonoSize(minutes)}`}
                                disabled={index === sizes.length - 1 || saving}
                                onClick={() => setSizes(moveBonoSize(sizes, index, 1))}
                                className="rounded-md p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
                            >
                                <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={`Eliminar ${formatBonoSize(minutes)}`}
                                disabled={sizes.length <= 1 || saving}
                                title={sizes.length <= 1 ? 'Debe quedar al menos un tamaño' : undefined}
                                onClick={() => setSizes(removeBonoSize(sizes, minutes))}
                                className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-30"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </span>
                    </li>
                ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor="bono-size-new" className="sr-only">Nuevo tamaño en horas</label>
                <input
                    id="bono-size-new"
                    type="text"
                    inputMode="decimal"
                    placeholder="Horas (ej. 10)"
                    value={newHours}
                    onChange={(e) => { setNewHours(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                    className="w-36 rounded-lg border border-white/10 bg-muted/50 px-3 py-2 text-[var(--color-text-primary)] focus:border-[var(--color-accent-val)] focus:outline-none"
                />
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={saving}
                    className="flex items-center gap-1 rounded-lg border border-[var(--color-accent-border)] bg-[var(--color-accent-dim)] px-3 py-2 text-sm text-[var(--color-accent-val)] disabled:opacity-50"
                >
                    <Plus className="h-4 w-4" /> Añadir
                </button>
                <button
                    type="button"
                    onClick={() => setSizes(sortBonoSizes(sizes))}
                    disabled={saving || sizes.length < 2}
                    className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                    <ArrowDownUp className="h-4 w-4" /> Ordenar de menor a mayor
                </button>
            </div>

            {error && (
                <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </p>
            )}

            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || saving}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-accent-val)] to-emerald-bright px-5 py-2 text-sm font-semibold text-[var(--color-bg-base)] transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Guardando...' : 'Guardar tamaños'}
                </button>
                {dirty && !saving && (
                    <button
                        type="button"
                        onClick={() => { setSizes(savedSizes); setError(''); }}
                        className="rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                        Descartar cambios
                    </button>
                )}
            </div>
        </div>
    );
}
