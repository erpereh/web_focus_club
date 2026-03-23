'use client';

import { useState } from 'react';
import { motion, Variants } from 'framer-motion';
import Image from 'next/image';
import { Play, Camera } from 'lucide-react';

interface CloudinaryResource {
    public_id: string;
    url: string;
    resource_type: 'image' | 'video';
    format: string;
    width: number;
    height: number;
    folder: string;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.08 },
    },
};

const itemVariants: Variants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            type: 'spring',
            stiffness: 100,
            damping: 15,
        },
    },
};

export default function GaleriaClient({ initialResources }: { initialResources: CloudinaryResource[] }) {
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null);

    const getVideoThumbnail = (url: string) => {
        return url.replace(/\.(mp4|mov|avi|webm)$/i, '.jpg');
    };

    if (initialResources.length === 0) {
        return (
            <div className="text-center py-20 text-muted-foreground">
                <Camera className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">Aún no hay contenido en la galería.</p>
            </div>
        );
    }

    return (
        <>
            <motion.div
                className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                {initialResources.map((resource, index) => (
                    <motion.div
                        key={resource.public_id}
                        variants={itemVariants}
                        className="break-inside-avoid"
                    >
                        <div
                            className="relative group rounded-3xl overflow-hidden bg-muted/20 border border-white/5 shadow-lg transition-all duration-500 hover:shadow-[0_0_25px_rgba(46,204,113,0.3)] hover:-translate-y-1 cursor-pointer"
                            onClick={() => {
                                if (resource.resource_type === 'video') {
                                    setSelectedVideo(resource.url);
                                }
                            }}
                        >
                            <div
                                className="relative w-full"
                                style={{
                                    paddingBottom: resource.resource_type === 'video'
                                        ? `${(resource.height / resource.width) * 100}%`
                                        : index % 3 === 0 ? '120%' : index % 2 === 0 ? '75%' : '100%',
                                }}
                            >
                                <Image
                                    src={resource.resource_type === 'video' ? getVideoThumbnail(resource.url) : resource.url}
                                    alt={`Galería Focus Club ${index + 1}`}
                                    fill
                                    unoptimized
                                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                                />
                            </div>

                            {resource.resource_type === 'video' && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-16 h-16 rounded-full bg-obsidian/60 backdrop-blur-sm flex items-center justify-center border-2 border-white/20 group-hover:bg-accent/80 group-hover:border-accent transition-all duration-300">
                                        <Play className="w-7 h-7 text-white ml-1" fill="white" />
                                    </div>
                                </div>
                            )}

                            <div className="absolute inset-0 bg-gradient-to-t from-obsidian/80 via-obsidian/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                        </div>
                    </motion.div>
                ))}
            </motion.div>

            {/* Video Modal */}
            {selectedVideo && (
                <div
                    className="fixed inset-0 z-50 bg-obsidian/90 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setSelectedVideo(null)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative max-w-3xl w-full max-h-[90vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <video
                            src={selectedVideo}
                            controls
                            autoPlay
                            className="w-full rounded-2xl shadow-2xl"
                            style={{ maxHeight: '85vh' }}
                        />
                        <button
                            onClick={() => setSelectedVideo(null)}
                            className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-obsidian border border-border text-ivory flex items-center justify-center hover:bg-destructive transition-colors"
                        >
                            ✕
                        </button>
                    </motion.div>
                </div>
            )}
        </>
    );
}
