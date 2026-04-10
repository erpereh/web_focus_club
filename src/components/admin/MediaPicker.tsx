'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Images,
    Folder,
    FolderOpen,
    Play,
    Upload,
    Check,
    FileImage,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { VideoFramePreview } from '@/components/ui/VideoFramePreview';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import { cn } from '@/lib/utils';
import type { MediaFile, UploadProgress } from '@/types';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadProgressBar({ item }: { item: UploadProgress }) {
    return (
        <div className="flex items-center gap-2">
            <FileImage className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-secondary)]" />
            <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--color-text-primary)] truncate">{item.fileName}</p>
                <div className="mt-0.5 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                        className={cn(
                            'h-full rounded-full transition-all duration-300',
                            item.status === 'error' ? 'bg-red-500' : 'bg-[var(--color-accent-val)]'
                        )}
                        style={{ width: `${item.progress}%` }}
                    />
                </div>
            </div>
            <span className="text-xs shrink-0 text-[var(--color-text-secondary)]">
                {item.status === 'error' ? 'Error' : item.status === 'done' ? 'OK' : `${item.progress}%`}
            </span>
        </div>
    );
}

export interface MediaPickerProps {
    open: boolean;
    onClose: () => void;
    onSelect: (file: MediaFile) => void;
    filterType?: 'image' | 'video';
    uploadFolderId?: string | null;
    defaultFolderId?: string;
}

function MediaPickerDialog({ onClose, onSelect, filterType, uploadFolderId, defaultFolderId }: Omit<MediaPickerProps, 'open'>) {
    const {
        folders,
        files,
        loading,
        uploadQueue,
        fetchFolders,
        fetchFiles,
        uploadMultipleFiles,
    } = useMediaLibrary();

    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(defaultFolderId ?? 'ALL');
    const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const initialFolder = defaultFolderId ?? 'ALL';
        fetchFolders();
        fetchFiles(initialFolder);
    }, [defaultFolderId, fetchFiles, fetchFolders]);

    useEffect(() => {
        fetchFiles(selectedFolderId === 'ALL' ? 'ALL' : selectedFolderId);
    }, [fetchFiles, selectedFolderId]);

    const displayFiles = filterType ? files.filter((f) => f.type === filterType) : files;

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        if (picked.length) {
            const folderId = uploadFolderId !== undefined
                ? uploadFolderId
                : (selectedFolderId === 'ALL' ? null : selectedFolderId);
            await uploadMultipleFiles(picked, folderId);
            await fetchFiles(selectedFolderId);
        }
        e.target.value = '';
    };

    const handleSelect = () => {
        if (!selectedFile) return;
        onSelect(selectedFile);
        onClose();
    };

    return (
        <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--color-bg-base)]/80 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="w-full max-w-4xl"
                style={{ maxHeight: '85vh' }}
                initial={{ scale: 0.96, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
            >
                <GlassCard variant="dark" hover={false} className="p-0 overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                        <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                            <Images className="w-4 h-4 text-[var(--color-accent-val)]" />
                            Seleccionar archivo{filterType ? ` (${filterType === 'image' ? 'imagen' : 'video'})` : ''}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/10 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex flex-1 overflow-hidden min-h-0">
                        <aside className="w-[180px] shrink-0 border-r border-border overflow-y-auto p-2 space-y-0.5">
                            <button
                                onClick={() => setSelectedFolderId('ALL')}
                                className={cn(
                                    'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all text-left',
                                    selectedFolderId === 'ALL'
                                        ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                        : 'text-[var(--color-text-secondary)] hover:bg-white/10'
                                )}
                            >
                                <Images className="w-3.5 h-3.5 shrink-0" />
                                <span className="font-medium">Todos</span>
                            </button>

                            <button
                                onClick={() => setSelectedFolderId(null)}
                                className={cn(
                                    'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all text-left',
                                    selectedFolderId === null
                                        ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                        : 'text-[var(--color-text-secondary)] hover:bg-white/10'
                                )}
                            >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                <span>Sin carpeta</span>
                            </button>

                            {folders
                                .filter((f) => f.parentId === null)
                                .map((folder) => (
                                    <button
                                        key={folder.id}
                                        onClick={() => setSelectedFolderId(folder.id)}
                                        className={cn(
                                            'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all text-left',
                                            selectedFolderId === folder.id
                                                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                                : 'text-[var(--color-text-secondary)] hover:bg-white/10'
                                        )}
                                    >
                                        {selectedFolderId === folder.id ? (
                                            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                        ) : (
                                            <Folder className="w-3.5 h-3.5 shrink-0" />
                                        )}
                                        <span className="truncate">{folder.name}</span>
                                    </button>
                                ))}
                        </aside>

                        <div className="flex-1 overflow-y-auto p-4">
                            {uploadQueue.length > 0 && (
                                <div className="mb-3 space-y-1.5 p-3 rounded-xl border border-border bg-white/5">
                                    {uploadQueue.map((item, i) => (
                                        <UploadProgressBar key={i} item={item} />
                                    ))}
                                </div>
                            )}

                            {loading && displayFiles.length === 0 ? (
                                <div className="h-40 flex items-center justify-center text-[var(--color-text-secondary)] text-sm animate-pulse">
                                    Cargando...
                                </div>
                            ) : displayFiles.length === 0 ? (
                                <div className="h-40 flex flex-col items-center justify-center gap-2 text-[var(--color-text-secondary)]">
                                    <Images className="w-10 h-10 opacity-30" />
                                    <p className="text-sm">No hay archivos aqui</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                    {displayFiles.map((file) => {
                                        const isSelected = selectedFile?.id === file.id;
                                        return (
                                            <button
                                                key={file.id}
                                                onClick={() => setSelectedFile(isSelected ? null : file)}
                                                className={cn(
                                                    'relative rounded-lg overflow-hidden border-2 transition-all aspect-square',
                                                    isSelected
                                                        ? 'border-[var(--color-accent-val)] shadow-lg shadow-emerald/20'
                                                        : 'border-transparent hover:border-border'
                                                )}
                                                title={file.name}
                                            >
                                                {file.type === 'image' ? (
                                                    <img
                                                        src={file.url}
                                                        alt={file.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <VideoFramePreview
                                                        src={file.url}
                                                        title={file.name}
                                                        className="w-full h-full"
                                                        iconContainerClassName="p-2 rounded-full bg-black/45 backdrop-blur-sm"
                                                        iconClassName="w-8 h-8 text-white/70"
                                                    />
                                                )}
                                                {isSelected && (
                                                    <div className="absolute inset-0 bg-[var(--color-accent-dim)]/70 flex items-center justify-center">
                                                        <div className="w-8 h-8 rounded-full bg-[var(--color-accent-val)] flex items-center justify-center">
                                                            <Check className="w-5 h-5 text-white" />
                                                        </div>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0 gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            <input
                                type="file"
                                ref={fileInputRef}
                                multiple
                                accept="image/*,video/*"
                                className="hidden"
                                onChange={handleFileInputChange}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-val)] transition-colors"
                            >
                                <Upload className="w-3.5 h-3.5" /> Subir archivo
                            </button>

                            {selectedFile && (
                                <span className="text-xs text-[var(--color-text-secondary)] truncate">
                                    {selectedFile.name} · {formatBytes(selectedFile.size)}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <PremiumButton variant="ghost" size="sm" onClick={onClose}>
                                Cancelar
                            </PremiumButton>
                            <PremiumButton
                                variant="primary"
                                size="sm"
                                disabled={!selectedFile}
                                onClick={handleSelect}
                            >
                                Seleccionar
                            </PremiumButton>
                        </div>
                    </div>
                </GlassCard>
            </motion.div>
        </motion.div>
    );
}

export function MediaPicker({ open, onClose, onSelect, filterType, uploadFolderId, defaultFolderId }: MediaPickerProps) {
    return (
        <AnimatePresence>
            {open ? (
                <MediaPickerDialog
                    key={`${defaultFolderId ?? 'ALL'}-${filterType ?? 'all'}-${uploadFolderId ?? 'none'}`}
                    onClose={onClose}
                    onSelect={onSelect}
                    filterType={filterType}
                    uploadFolderId={uploadFolderId}
                    defaultFolderId={defaultFolderId}
                />
            ) : null}
        </AnimatePresence>
    );
}
