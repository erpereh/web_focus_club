'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft,
    LogOut,
    Plus,
    Folder,
    FolderOpen,
    MoreVertical,
    Upload,
    X,
    Images,
    Trash2,
    Edit3,
    Copy,
    MoveRight,
    Play,
    Menu,
    Check,
    FileImage,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { PremiumButton } from '@/components/ui/premium-button';
import { useAuth } from '@/contexts/AuthContext';
import { useBrandingConfig } from '@/hooks/useBrandingConfig';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import { cn } from '@/lib/utils';
import type { MediaFolder, MediaFile, UploadProgress } from '@/types';

// ============================================
// HELPERS
// ============================================

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// INLINE RENAME INPUT
// ============================================

function InlineRenameInput({
    initialValue,
    onConfirm,
    onCancel,
}: {
    initialValue: string;
    onConfirm: (name: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); if (value.trim()) onConfirm(value.trim()); }
        if (e.key === 'Escape') onCancel();
    };

    return (
        <div className="flex items-center gap-1 px-2">
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKey}
                onBlur={() => { if (value.trim()) onConfirm(value.trim()); else onCancel(); }}
                className="flex-1 bg-transparent border-b border-[var(--color-accent-val)] text-sm text-[var(--color-text-primary)] outline-none py-0.5 min-w-0"
            />
        </div>
    );
}

// ============================================
// UPLOAD PROGRESS BAR
// ============================================

function UploadProgressBar({ item }: { item: UploadProgress }) {
    return (
        <div className="flex items-center gap-3">
            <FileImage className="w-4 h-4 shrink-0 text-[var(--color-text-secondary)]" />
            <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--color-text-primary)] truncate">{item.fileName}</p>
                <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
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
                {item.status === 'error' ? 'Error' : item.status === 'done' ? '✓' : `${item.progress}%`}
            </span>
        </div>
    );
}

// ============================================
// FOLDER TREE ITEM
// ============================================

function FolderTreeItem({
    folder,
    depth,
    isSelected,
    onSelect,
    onRename,
    onDelete,
    allFolders,
    renamingId,
    onRenameConfirm,
    onRenameCancel,
    isProtected,
}: {
    folder: MediaFolder;
    depth: number;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onRename: (id: string) => void;
    onDelete: (id: string) => void;
    allFolders: MediaFolder[];
    renamingId: string | null;
    onRenameConfirm: (id: string, name: string) => void;
    onRenameCancel: () => void;
    isProtected?: boolean;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const children = allFolders.filter((f) => f.parentId === folder.id);
    const isRenaming = renamingId === folder.id;

    return (
        <div>
            <div
                className={cn(
                    'group flex items-center gap-1.5 rounded-lg transition-all text-sm cursor-pointer',
                    isSelected
                        ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
                )}
                style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '4px', paddingTop: '6px', paddingBottom: '6px' }}
            >
                <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                    onClick={() => onSelect(folder.id)}
                >
                    {isSelected ? (
                        <FolderOpen className="w-4 h-4 shrink-0" />
                    ) : (
                        <Folder className="w-4 h-4 shrink-0" />
                    )}
                    {isRenaming ? (
                        <InlineRenameInput
                            initialValue={folder.name}
                            onConfirm={(name) => onRenameConfirm(folder.id, name)}
                            onCancel={onRenameCancel}
                        />
                    ) : (
                        <span className="truncate">{folder.name}</span>
                    )}
                </button>

                {/* 3-dot menu (hidden for protected folders) */}
                {!isProtected && (
                <div className="relative shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-opacity"
                    >
                        <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    {menuOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                            <div className="absolute right-0 top-6 z-20 w-36 glass-dark rounded-xl border border-border shadow-xl overflow-hidden">
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-[var(--color-text-primary)] transition-colors"
                                    onClick={() => { setMenuOpen(false); onRename(folder.id); }}
                                >
                                    <Edit3 className="w-3.5 h-3.5" /> Renombrar
                                </button>
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                    onClick={() => { setMenuOpen(false); onDelete(folder.id); }}
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Eliminar
                                </button>
                            </div>
                        </>
                    )}
                </div>
                )}
            </div>

            {/* Child folders */}
            {children.map((child) => (
                <FolderTreeItem
                    key={child.id}
                    folder={child}
                    depth={depth + 1}
                    isSelected={isSelected && false}
                    onSelect={onSelect}
                    onRename={onRename}
                    onDelete={onDelete}
                    allFolders={allFolders}
                    renamingId={renamingId}
                    onRenameConfirm={onRenameConfirm}
                    onRenameCancel={onRenameCancel}
                />
            ))}
        </div>
    );
}

// ============================================
// FILE CARD
// ============================================

function FileCard({
    file,
    onCopyUrl,
    onMove,
    onDelete,
    onClick,
}: {
    file: MediaFile;
    onCopyUrl: () => void;
    onMove: () => void;
    onDelete: () => void;
    onClick: () => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [hasVideoFrame, setHasVideoFrame] = useState(file.type === 'image');
    const [videoFallback, setVideoFallback] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const seekAttemptsRef = useRef(0);

    const handleCopy = () => {
        onCopyUrl();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        setMenuOpen(false);
    };

    const captureVideoFrame = useCallback((attempt: number) => {
        const video = videoRef.current;
        if (!video || file.type !== 'video' || videoFallback) return;

        const targetTime = attempt === 0 ? 0.15 : 0.5;
        if (video.readyState < 2 || !Number.isFinite(video.duration) || video.duration <= 0) {
            return;
        }

        try {
            video.currentTime = Math.min(targetTime, Math.max(video.duration - 0.05, 0));
        } catch {
            if (attempt === 0) {
                seekAttemptsRef.current = 1;
                window.setTimeout(() => {
                    const retryVideo = videoRef.current;
                    if (!retryVideo || file.type !== 'video' || videoFallback) return;
                    if (retryVideo.readyState < 2 || !Number.isFinite(retryVideo.duration) || retryVideo.duration <= 0) {
                        setVideoFallback(true);
                        return;
                    }

                    try {
                        retryVideo.currentTime = Math.min(0.5, Math.max(retryVideo.duration - 0.05, 0));
                    } catch {
                        setVideoFallback(true);
                    }
                }, 120);
            } else {
                setVideoFallback(true);
            }
        }
    }, [file.type, videoFallback]);

    const handleVideoLoaded = useCallback(() => {
        if (file.type !== 'video' || videoFallback) return;
        captureVideoFrame(0);
    }, [captureVideoFrame, file.type, videoFallback]);

    const handleVideoSeeked = useCallback(() => {
        const video = videoRef.current;
        if (!video || file.type !== 'video') return;

        video.pause();
        setHasVideoFrame(true);
    }, [file.type]);

    const handleVideoError = useCallback(() => {
        setVideoFallback(true);
        setHasVideoFrame(false);
    }, []);

    const showVideoFallback = file.type === 'video' && (!hasVideoFrame || videoFallback);

    return (
        <div className="group relative rounded-xl overflow-hidden border border-border bg-white/5 hover:border-[var(--color-accent-border)] transition-all">
            {/* Thumbnail */}
            <button
                onClick={onClick}
                className="block w-full aspect-square overflow-hidden bg-black/20"
            >
                {file.type === 'image' ? (
                    <img
                        src={file.url}
                        alt={file.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="relative w-full h-full bg-black/40">
                        {!videoFallback && (
                            <video
                                ref={videoRef}
                                src={file.url}
                                key={file.url}
                                muted
                                playsInline
                                preload="auto"
                                onLoadedData={handleVideoLoaded}
                                onCanPlay={handleVideoLoaded}
                                onSeeked={handleVideoSeeked}
                                onError={handleVideoError}
                                className={cn(
                                    'w-full h-full object-cover pointer-events-none transition-transform duration-300 group-hover:scale-105',
                                    showVideoFallback ? 'opacity-0' : 'opacity-100'
                                )}
                            />
                        )}
                        {showVideoFallback && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Play className="w-10 h-10 text-white/70" />
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
                                <Play className="w-8 h-8 text-white/85" />
                            </div>
                        </div>
                    </div>
                )}
            </button>

            {/* Info bar */}
            <div className="px-2.5 py-2 flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[var(--color-text-primary)] truncate leading-tight">
                        {file.name}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                        {file.type === 'image' ? 'Imagen' : 'Vídeo'} · {formatBytes(file.size)}
                    </p>
                </div>

                {/* 3-dot menu */}
                <div className="relative shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                        className="p-1 rounded hover:bg-white/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                        <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    {menuOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                            <div className="absolute right-0 bottom-8 z-20 w-40 glass-dark rounded-xl border border-border shadow-xl overflow-hidden">
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-[var(--color-text-primary)] transition-colors"
                                    onClick={handleCopy}
                                >
                                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    {copied ? 'Copiado!' : 'Copiar URL'}
                                </button>
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-[var(--color-text-primary)] transition-colors"
                                    onClick={() => { setMenuOpen(false); onMove(); }}
                                >
                                    <MoveRight className="w-3.5 h-3.5" /> Mover a carpeta
                                </button>
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                                    onClick={() => { setMenuOpen(false); onDelete(); }}
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Eliminar
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// MOVE FILE MODAL
// ============================================

function MoveFileModal({
    file,
    folders,
    onMove,
    onClose,
}: {
    file: MediaFile;
    folders: MediaFolder[];
    onMove: (folderId: string | null) => void;
    onClose: () => void;
}) {
    const [selected, setSelected] = useState<string | null>(file.folderId);

    const rootFolders = folders.filter((f) => f.parentId === null);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <GlassCard variant="dark" hover={false} className="w-full max-w-sm p-0 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">Mover archivo</h3>
                    <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
                    {/* Sin carpeta */}
                    <button
                        onClick={() => setSelected(null)}
                        className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left',
                            selected === null
                                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                : 'text-[var(--color-text-secondary)] hover:bg-white/10'
                        )}
                    >
                        <Images className="w-4 h-4 shrink-0" /> Sin carpeta
                    </button>
                    {rootFolders.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setSelected(f.id)}
                            className={cn(
                                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left',
                                selected === f.id
                                    ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)]'
                                    : 'text-[var(--color-text-secondary)] hover:bg-white/10'
                            )}
                        >
                            <Folder className="w-4 h-4 shrink-0" /> {f.name}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 justify-end px-5 py-4 border-t border-border">
                    <PremiumButton variant="ghost" size="sm" onClick={onClose}>Cancelar</PremiumButton>
                    <PremiumButton variant="primary" size="sm" onClick={() => onMove(selected)}>Mover</PremiumButton>
                </div>
            </GlassCard>
        </div>
    );
}

// ============================================
// PAGE COMPONENT
// ============================================

export default function MediaPage() {
    const { userProfile, isAdmin, logout } = useAuth();
    const { logoUrl } = useBrandingConfig();
    const router = useRouter();
    const {
        folders,
        files,
        loading,
        uploadQueue,
        fetchFolders,
        fetchFiles,
        createFolder,
        renameFolder,
        deleteFolder,
        uploadMultipleFiles,
        moveFile,
        deleteFile,
        copyUrl,
    } = useMediaLibrary();

    const [selectedFolderId, setSelectedFolderId] = useState<string | null>('ALL');
    const [isDragging, setIsDragging] = useState(false);
    const [lightboxFile, setLightboxFile] = useState<MediaFile | null>(null);
    const [moveTarget, setMoveTarget] = useState<MediaFile | null>(null);
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'folder' | 'file'; id: string; storagePath?: string } | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auth guard
    useEffect(() => {
        if (userProfile !== null && !isAdmin) {
            router.replace('/admin');
        }
    }, [isAdmin, userProfile, router]);

    // Initial load
    useEffect(() => {
        fetchFolders();
    }, [fetchFolders]);

    useEffect(() => {
        fetchFiles(selectedFolderId);
    }, [selectedFolderId, fetchFiles]);

    // Drag & drop
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
        }
    }, []);
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length) {
            const folderId = selectedFolderId === 'ALL' ? null : selectedFolderId;
            await uploadMultipleFiles(droppedFiles, folderId);
            await fetchFiles(selectedFolderId);
        }
    }, [selectedFolderId, uploadMultipleFiles, fetchFiles]);

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        if (picked.length) {
            const folderId = selectedFolderId === 'ALL' ? null : selectedFolderId;
            await uploadMultipleFiles(picked, folderId);
        }
        e.target.value = '';
    };

    const currentFolderName = (() => {
        if (selectedFolderId === 'ALL') return 'Todos los medios';
        if (selectedFolderId === null) return 'Sin carpeta';
        return folders.find((f) => f.id === selectedFolderId)?.name ?? '';
    })();

    const handleSelectFolder = (id: string | null) => {
        setSelectedFolderId(id);
        setSidebarOpen(false);
    };

    return (
        <div className="min-h-screen -mt-20 bg-[var(--color-bg-base)]">
            {/* ── HEADER ── */}
            <header className="glass-dark border-b border-border sticky top-0 z-40">
                <div className="container mx-auto px-4">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="lg:hidden p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-white/5 transition-colors"
                            >
                                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </button>
                            <Link href="/" className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                                    <Image src={logoUrl ?? '/imagenes/logo.jpeg'} alt="Focus Club" width={32} height={32} className="w-full h-full object-cover" unoptimized={!!logoUrl} />
                                </div>
                                <span className="font-bold text-[var(--color-text-primary)] hidden sm:block">Focus Club Admin</span>
                            </Link>
                            <span className="hidden sm:flex items-center gap-1 text-[var(--color-text-secondary)] text-sm">
                                <span>/</span>
                                <span className="text-[var(--color-accent-val)] font-medium">Medios</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link href="/admin">
                                <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                                    <span className="hidden sm:inline">Admin</span>
                                </PremiumButton>
                            </Link>
                            <Link href="/">
                                <PremiumButton variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
                                    <span className="hidden sm:inline">Ver web</span>
                                </PremiumButton>
                            </Link>
                            <PremiumButton
                                variant="ghost"
                                size="sm"
                                onClick={() => logout()}
                                icon={<LogOut className="w-4 h-4" />}
                            >
                                <span className="hidden sm:inline">Salir</span>
                            </PremiumButton>
                        </div>
                    </div>
                </div>
            </header>

            {/* ── BODY: two-panel layout ── */}
            <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>

                {/* Mobile overlay */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 z-30 bg-[var(--color-bg-base)]/60 backdrop-blur-sm lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* ── LEFT: Folder sidebar ── */}
                <aside className={cn(
                    'shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-1 lg:block',
                    'w-[250px]',
                    sidebarOpen
                        ? 'fixed inset-y-0 left-0 z-40 bg-[#0A110D] pt-20 shadow-2xl lg:static lg:pt-3 lg:shadow-none lg:bg-transparent'
                        : 'hidden lg:flex'
                )}>
                    {/* Nueva carpeta */}
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-dashed border-border text-[var(--color-text-secondary)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-accent-val)] transition-all mb-2"
                    >
                        <Plus className="w-4 h-4" /> Nueva carpeta
                    </button>

                    {/* New folder input */}
                    {showNewFolderInput && (
                        <div className="mb-1">
                            <InlineRenameInput
                                initialValue=""
                                onConfirm={async (name) => {
                                    await createFolder(name, null);
                                    setShowNewFolderInput(false);
                                }}
                                onCancel={() => setShowNewFolderInput(false)}
                            />
                        </div>
                    )}

                    {/* "Todos los medios" root item */}
                    <button
                        onClick={() => handleSelectFolder('ALL')}
                        className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left',
                            selectedFolderId === 'ALL'
                                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)]'
                                : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
                        )}
                    >
                        <Images className="w-4 h-4 shrink-0" />
                        <span className="font-medium">Todos los medios</span>
                    </button>

                    {/* Sin carpeta */}
                    <button
                        onClick={() => handleSelectFolder(null)}
                        className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left',
                            selectedFolderId === null
                                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-val)] border border-[var(--color-accent-border)]'
                                : 'text-[var(--color-text-secondary)] hover:bg-muted/50 hover:text-[var(--color-text-primary)]'
                        )}
                    >
                        <FolderOpen className="w-4 h-4 shrink-0" />
                        <span>Sin carpeta</span>
                    </button>

                    {/* Folder tree */}
                    <div className="mt-1">
                        {/* Folders */}
                        {folders
                            .filter((f) => f.parentId === null)
                            .map((folder) => (
                                <FolderTreeItem
                                    key={folder.id}
                                    folder={folder}
                                    depth={0}
                                    isSelected={selectedFolderId === folder.id}
                                    onSelect={handleSelectFolder}
                                    onRename={(id) => setRenamingFolderId(id)}
                                    onDelete={(id) => setDeleteConfirm({ type: 'folder', id })}
                                    allFolders={folders}
                                    renamingId={renamingFolderId}
                                    onRenameConfirm={async (id, name) => {
                                        await renameFolder(id, name);
                                        setRenamingFolderId(null);
                                    }}
                                    onRenameCancel={() => setRenamingFolderId(null)}
                                />
                            ))}
                    </div>
                </aside>

                {/* ── RIGHT: File grid ── */}
                <main
                    className={cn(
                        'flex-1 overflow-y-auto p-6 flex flex-col gap-5 transition-colors duration-200',
                        isDragging && 'ring-2 ring-inset ring-[var(--color-accent-val)] bg-[var(--color-accent-dim)]/20'
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Panel header */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                                <Images className="w-5 h-5 text-[var(--color-accent-val)]" />
                                {currentFolderName}
                            </h1>
                            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                                {files.length} archivo{files.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="file"
                                ref={fileInputRef}
                                multiple
                                accept="image/*,video/*"
                                className="hidden"
                                onChange={handleFileInputChange}
                            />
                            <PremiumButton
                                variant="primary"
                                size="sm"
                                icon={<Upload className="w-4 h-4" />}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Subir archivos
                            </PremiumButton>
                        </div>
                    </div>

                    {/* Upload progress */}
                    <AnimatePresence>
                        {uploadQueue.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-2 p-4 rounded-xl border border-border bg-white/5"
                            >
                                {uploadQueue.map((item, i) => (
                                    <UploadProgressBar key={i} item={item} />
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Drag drop overlay hint */}
                    {isDragging && (
                        <div className="flex-1 flex items-center justify-center border-2 border-dashed border-[var(--color-accent-val)] rounded-2xl p-16">
                            <div className="text-center">
                                <Upload className="w-12 h-12 mx-auto mb-3 text-[var(--color-accent-val)]" />
                                <p className="text-[var(--color-accent-val)] text-lg font-medium">
                                    Suelta los archivos aquí
                                </p>
                            </div>
                        </div>
                    )}

                    {/* File grid */}
                    {!isDragging && (
                        <>
                            {loading && files.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="text-[var(--color-text-secondary)] animate-pulse">Cargando...</div>
                                </div>
                            ) : files.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
                                    <Images className="w-16 h-16 text-[var(--color-text-secondary)] opacity-30" />
                                    <p className="text-[var(--color-text-secondary)]">
                                        No hay archivos aquí.
                                    </p>
                                    <p className="text-sm text-[var(--color-text-secondary)] opacity-60">
                                        Arrastra archivos o usa &quot;Subir archivos&quot;
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {files.map((file) => (
                                        <FileCard
                                            key={file.id}
                                            file={file}
                                            onCopyUrl={() => copyUrl(file.url)}
                                            onMove={() => setMoveTarget(file)}
                                            onDelete={() => setDeleteConfirm({ type: 'file', id: file.id, storagePath: file.storagePath })}
                                            onClick={() => setLightboxFile(file)}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </main>
            </div>

            {/* ── LIGHTBOX ── */}
            <AnimatePresence>
                {lightboxFile && (
                    <motion.div
                        className="fixed inset-0 z-[100] bg-black/92 flex items-center justify-center p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setLightboxFile(null)}
                    >
                        <button
                            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                            onClick={() => setLightboxFile(null)}
                        >
                            <X className="w-6 h-6" />
                        </button>
                        <motion.div
                            initial={{ scale: 0.9 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.9 }}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-5xl max-h-full flex flex-col items-center gap-3"
                        >
                            {lightboxFile.type === 'image' ? (
                                <img
                                    src={lightboxFile.url}
                                    alt={lightboxFile.name}
                                    className="max-w-full max-h-[80vh] object-contain rounded-lg"
                                />
                            ) : (
                                <video
                                    src={lightboxFile.url}
                                    controls
                                    className="max-w-full max-h-[80vh] rounded-lg"
                                />
                            )}
                            <p className="text-white/70 text-sm">{lightboxFile.name} · {formatBytes(lightboxFile.size)}</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── MOVE FILE MODAL ── */}
            {moveTarget && (
                <MoveFileModal
                    file={moveTarget}
                    folders={folders}
                    onMove={async (newFolderId) => {
                        await moveFile(moveTarget.id, newFolderId);
                        await fetchFiles(selectedFolderId);
                        setMoveTarget(null);
                    }}
                    onClose={() => setMoveTarget(null)}
                />
            )}

            {/* ── DELETE CONFIRMATION ── */}
            <AnimatePresence>
                {deleteConfirm && (
                    <motion.div
                        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <GlassCard variant="dark" hover={false} className="max-w-sm w-full space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-red-500/20 text-red-400 shrink-0">
                                    <Trash2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-[var(--color-text-primary)]">¿Confirmar eliminación?</h3>
                                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                                        {deleteConfirm.type === 'folder'
                                            ? 'Se eliminará la carpeta y todo su contenido de forma permanente.'
                                            : 'Se eliminará el archivo de forma permanente.'}
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
                                    onClick={async () => {
                                        if (deleteConfirm.type === 'folder') {
                                            await deleteFolder(deleteConfirm.id);
                                            if (selectedFolderId === deleteConfirm.id) setSelectedFolderId('ALL');
                                        } else {
                                            await deleteFile(deleteConfirm.id, deleteConfirm.storagePath!);
                                            await fetchFiles(selectedFolderId);
                                        }
                                        setDeleteConfirm(null);
                                    }}
                                >
                                    Eliminar
                                </PremiumButton>
                            </div>
                        </GlassCard>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}


