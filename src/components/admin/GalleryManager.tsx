'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    Plus,
    Trash2,
    GripVertical,
    Eye,
    EyeOff,
    Check,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { VideoFramePreview } from '@/components/ui/VideoFramePreview';
import {
    getGalleryItems,
    addGalleryItem,
    updateGalleryItem,
    deleteGalleryItem,
    reorderGalleryItems,
} from '@/lib/firestore';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import type { GalleryItem, MediaFile } from '@/types';

// ============================================
// SORTABLE CARD
// ============================================

function SortableCard({
    item,
    onToggleActive,
    onDelete,
    onTitleChange,
}: {
    item: GalleryItem;
    onToggleActive: (id: string, active: boolean) => void;
    onDelete: (id: string) => void;
    onTitleChange: (id: string, title: string) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const [editingTitle, setEditingTitle] = useState(item.title);
    const [saved, setSaved] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : undefined,
    };

    const handleTitleBlur = async () => {
        if (editingTitle !== item.title) {
            onTitleChange(item.id, editingTitle);
            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
        }
    };

    return (
        <div ref={setNodeRef} style={style} className="relative">
            <GlassCard
                hover={false}
                className={`p-0 overflow-hidden transition-shadow ${isDragging ? 'shadow-2xl shadow-emerald/20 ring-1 ring-[var(--color-accent-border)]' : ''} ${!item.active ? 'opacity-50' : ''}`}
            >
                {/* Thumbnail */}
                <div className="relative aspect-square overflow-hidden bg-black/30">
                    {item.type === 'image' ? (
                        <img src={item.url} alt={item.title || 'Imagen'} className="w-full h-full object-cover" />
                    ) : (
                        <VideoFramePreview
                            src={item.url}
                            title={item.title || 'Video'}
                            className="w-full h-full"
                            iconContainerClassName="p-2 rounded-full bg-black/45 backdrop-blur-sm"
                            iconClassName="w-8 h-8 text-white/70"
                        />
                    )}

                    {/* Drag handle */}
                    <button
                        {...attributes}
                        {...listeners}
                        className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 text-white/70 hover:text-white hover:bg-black/80 cursor-grab active:cursor-grabbing transition-colors touch-none"
                        aria-label="Arrastrar para reordenar"
                    >
                        <GripVertical className="w-4 h-4" />
                    </button>

                    {/* Badge tipo */}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white/70 text-[10px] font-medium border border-white/10">
                        {item.type === 'image' ? 'IMG' : 'VID'}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-3 space-y-2">
                    {/* Title editable inline */}
                    <div className="relative flex items-center gap-1">
                        <input
                            ref={inputRef}
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={handleTitleBlur}
                            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur(); }}
                            placeholder="Etiqueta interna…"
                            className="flex-1 text-xs bg-transparent border-b border-transparent focus:border-[var(--color-accent-val)] text-[var(--color-text-secondary)] focus:text-[var(--color-text-primary)] outline-none py-0.5 min-w-0 transition-colors"
                        />
                        {saved && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => onToggleActive(item.id, !item.active)}
                            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                                item.active
                                    ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)]'
                                    : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10'
                            }`}
                            title={item.active ? 'Visible en web' : 'Oculto en web'}
                        >
                            {item.active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            {item.active ? 'Activo' : 'Oculto'}
                        </button>

                        <button
                            onClick={() => onDelete(item.id)}
                            className="p-1.5 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                            title="Eliminar de galería"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}

// ============================================
// GALLERY MANAGER
// ============================================

export function GalleryManager() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const { fetchFolders } = useMediaLibrary();

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getGalleryItems(false);
            setItems(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadItems();
        fetchFolders();
    }, [fetchFolders, loadItems]);

    const handleSelect = async (file: MediaFile) => {
        const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.order)) : -1;
        const newItem: Omit<GalleryItem, 'id'> = {
            mediaFileId: file.id,
            url: file.url,
            type: file.type,
            title: '',
            order: maxOrder + 1,
            active: true,
            createdAt: new Date().toISOString(),
        };
        const id = await addGalleryItem(newItem);
        setItems((prev) => [...prev, { id, ...newItem }]);
    };

    const handleToggleActive = async (id: string, active: boolean) => {
        await updateGalleryItem(id, { active });
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, active } : i)));
    };

    const handleTitleChange = async (id: string, title: string) => {
        await updateGalleryItem(id, { title });
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title } : i)));
    };

    const handleDelete = async (id: string) => {
        await deleteGalleryItem(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        setDeleteConfirm(null);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        const reordered = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
            ...item,
            order: idx,
        }));

        setItems(reordered);
        await reorderGalleryItems(reordered.map((i) => ({ id: i.id, order: i.order })));
    };

    const activeCount = items.filter((i) => i.active).length;

    return (
        <GlassCard className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                        Fotos &amp; Vídeos
                    </h2>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                        {items.length} elemento{items.length !== 1 ? 's' : ''} · {activeCount} visible{activeCount !== 1 ? 's' : ''} en web
                        · Arrastra para reordenar
                    </p>
                </div>
                <PremiumButton
                    variant="outline"
                    size="sm"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => setPickerOpen(true)}
                >
                    Añadir contenido
                </PremiumButton>
            </div>

            {/* Grid */}
            {loading ? (
                <div className="text-center py-10 text-[var(--color-text-secondary)] text-sm animate-pulse">
                    Cargando…
                </div>
            ) : items.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border rounded-xl">
                    <p className="text-[var(--color-text-secondary)] text-sm">
                        No hay contenido en la galería todavía.
                    </p>
                    <p className="text-[var(--color-text-secondary)] text-xs mt-1 opacity-60">
                        Pulsa &quot;Añadir contenido&quot; para seleccionar desde la biblioteca de medios.
                    </p>
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {items.map((item) => (
                                <SortableCard
                                    key={item.id}
                                    item={item}
                                    onToggleActive={handleToggleActive}
                                    onDelete={(id) => setDeleteConfirm(id)}
                                    onTitleChange={handleTitleChange}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}

            {/* MediaPicker */}
            <MediaPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={(file) => { handleSelect(file); setPickerOpen(false); }}
            />

            {/* Delete confirmation */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <GlassCard variant="dark" hover={false} className="max-w-sm w-full space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-red-500/20 text-red-400 shrink-0">
                                <Trash2 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-[var(--color-text-primary)]">¿Eliminar de galería?</h3>
                                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                                    El archivo permanecerá en la biblioteca de medios. Solo se elimina de la galería pública.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <PremiumButton variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                                Cancelar
                            </PremiumButton>
                            <PremiumButton
                                variant="primary"
                                size="sm"
                                className="!bg-red-600 hover:!bg-red-700"
                                onClick={() => handleDelete(deleteConfirm)}
                            >
                                Eliminar
                            </PremiumButton>
                        </div>
                    </GlassCard>
                </div>
            )}
        </GlassCard>
    );
}
