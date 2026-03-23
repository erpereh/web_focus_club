'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, UploadCloud, RefreshCw, Folder } from 'lucide-react';
import { ImageUpload } from './ImageUpload';
import { PremiumButton } from './premium-button';

interface CloudinaryImage {
    public_id: string;
    url: string;
    created_at: string;
    folder: string;
}

interface ContextualImageManagerProps {
    currentUrl?: string;
    defaultFolder: string;
    onSelect: (url: string) => void;
    onClose: () => void;
}

const FOLDERS = ['Sandra', 'Galeria', 'Hero', 'Nosotros', 'General'];

export function ContextualImageManager({ currentUrl, defaultFolder, onSelect, onClose }: ContextualImageManagerProps) {
    const [images, setImages] = useState<CloudinaryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFolder, setActiveFolder] = useState(defaultFolder);

    const isValidImageUrl = (url?: string) => url && url.startsWith('http');

    const fetchImages = async (folder: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/images?folder=${folder}`);
            const data = await res.json();
            if (data.images) {
                setImages(data.images);
            }
        } catch (err) {
            console.error('Failed to fetch images:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchImages(activeFolder);
    }, [activeFolder]);

    const handleUploadSuccess = (url: string) => {
        // Select the newly uploaded image directly
        onSelect(url);
        onClose();
    };

    return (
        <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-obsidian/90 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className="glass-card w-full max-w-5xl h-[90vh] md:h-[80vh] flex flex-col overflow-hidden relative"
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent/10 rounded-lg">
                            <ImageIcon className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-ivory">Gestor de Imágenes</h2>
                            <p className="text-sm text-muted-foreground">Selecciona o sube una imagen para la sección actual</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-muted-foreground hover:text-ivory rounded-full hover:bg-white/5 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content Split */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

                    {/* Left Column: Upload & Current */}
                    <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-border p-4 md:p-6 flex flex-col gap-4 md:gap-6 bg-obsidian/30 overflow-y-auto max-h-[40vh] md:max-h-none">
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Imagen Actual</h3>
                            <div className="aspect-square rounded-2xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/10 relative group">
                                {isValidImageUrl(currentUrl) ? (
                                    <img src={currentUrl} alt="Current" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                        <ImageIcon className="w-8 h-8 opacity-50" />
                                        <span className="text-sm">{currentUrl ? 'Imagen no disponible' : 'Ninguna imagen'}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="h-px w-full bg-border" />

                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Subir Nueva a {activeFolder}</h3>
                            <p className="text-xs text-muted-foreground mb-4">La imagen se subirá automáticamente a la carpeta seleccionada en la biblioteca.</p>

                            <ImageUpload
                                folder={activeFolder}
                                onUpload={handleUploadSuccess}
                                buttonText={`Subir a /${activeFolder}`}
                                className="w-full"
                            />
                        </div>
                    </div>

                    {/* Right Column: Library */}
                    <div className="flex-1 flex flex-col bg-muted/5">
                        {/* Tabs / Folders */}
                        <div className="p-4 border-b border-border flex gap-2 overflow-x-auto custom-scrollbar items-center">
                            <Folder className="w-4 h-4 text-muted-foreground ml-2 mr-1" />
                            {FOLDERS.map(folder => (
                                <button
                                    key={folder}
                                    onClick={() => setActiveFolder(folder)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeFolder === folder
                                            ? 'bg-accent/20 text-accent border border-accent/30'
                                            : 'bg-transparent text-muted-foreground hover:bg-white/5 hover:text-ivory'
                                        }`}
                                >
                                    {folder}
                                </button>
                            ))}
                            <div className="flex-1" />
                            <button
                                onClick={() => fetchImages(activeFolder)}
                                className="p-2 text-muted-foreground hover:text-ivory rounded-lg hover:bg-white/5 transition-colors"
                                title="Refrescar imágenes"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        {/* Grid */}
                        <div className="flex-1 p-6 overflow-y-auto">
                            {loading ? (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                                    <RefreshCw className="w-8 h-8 animate-spin text-accent/50" />
                                    <p>Cargando biblioteca...</p>
                                </div>
                            ) : images.length === 0 ? (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                                    <div className="p-4 bg-muted/10 rounded-full">
                                        <ImageIcon className="w-8 h-8 opacity-50" />
                                    </div>
                                    <p>No hay imágenes en la carpeta <b>{activeFolder}</b>.</p>
                                    <p className="text-sm">Usa el panel lateral para subir la primera.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-[120px]">
                                    {images.map((img) => (
                                        <div
                                            key={img.public_id}
                                            onClick={() => {
                                                onSelect(img.url);
                                                onClose();
                                            }}
                                            className="group cursor-pointer relative rounded-xl overflow-hidden border border-border hover:border-accent/50 transition-all hover:shadow-[0_0_15px_rgba(209,164,123,0.15)]"
                                        >
                                            <img
                                                src={img.url}
                                                alt={img.public_id}
                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                loading="lazy"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-obsidian/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                                                <span className="text-xs text-ivory font-medium truncate">{img.public_id.split('/').pop()}</span>
                                                <span className="text-[10px] text-ivory/70">{new Date(img.created_at).toLocaleDateString()}</span>
                                            </div>

                                            {currentUrl === img.url && (
                                                <div className="absolute top-2 right-2 w-3 h-3 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.8)]" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
