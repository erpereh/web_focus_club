'use client';

import { useCallback, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

type VideoFramePreviewProps = {
    src: string;
    title?: string;
    className?: string;
    videoClassName?: string;
    fallbackClassName?: string;
    iconContainerClassName?: string;
    iconClassName?: string;
    showOverlay?: boolean;
    preload?: 'none' | 'metadata' | 'auto';
};

function VideoFramePreviewInner({
    src,
    title,
    className,
    videoClassName,
    fallbackClassName,
    iconContainerClassName,
    iconClassName,
    showOverlay = true,
    preload = 'auto',
}: VideoFramePreviewProps) {
    const [hasFrame, setHasFrame] = useState(false);
    const [fallback, setFallback] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const captureFrame = useCallback((attempt: number) => {
        const video = videoRef.current;
        if (!video || fallback) return;

        const targetTime = attempt === 0 ? 0.15 : 0.5;
        if (video.readyState < 2 || !Number.isFinite(video.duration) || video.duration <= 0) {
            return;
        }

        try {
            video.currentTime = Math.min(targetTime, Math.max(video.duration - 0.05, 0));
        } catch {
            if (attempt === 0) {
                window.setTimeout(() => {
                    const retryVideo = videoRef.current;
                    if (!retryVideo || fallback) return;
                    if (retryVideo.readyState < 2 || !Number.isFinite(retryVideo.duration) || retryVideo.duration <= 0) {
                        setFallback(true);
                        return;
                    }

                    try {
                        retryVideo.currentTime = Math.min(0.5, Math.max(retryVideo.duration - 0.05, 0));
                    } catch {
                        setFallback(true);
                    }
                }, 120);
            } else {
                setFallback(true);
            }
        }
    }, [fallback]);

    const handleVideoLoaded = useCallback(() => {
        if (fallback) return;
        captureFrame(0);
    }, [captureFrame, fallback]);

    const handleVideoSeeked = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        video.pause();
        setHasFrame(true);
    }, []);

    const handleVideoError = useCallback(() => {
        setFallback(true);
        setHasFrame(false);
    }, []);

    const showFallback = !hasFrame || fallback;

    return (
        <div className={cn('relative w-full h-full bg-black/40 overflow-hidden', className)}>
            {!fallback && (
                <video
                    key={src}
                    ref={videoRef}
                    src={src}
                    title={title}
                    muted
                    playsInline
                    preload={preload}
                    onLoadedData={handleVideoLoaded}
                    onCanPlay={handleVideoLoaded}
                    onSeeked={handleVideoSeeked}
                    onError={handleVideoError}
                    className={cn(
                        'w-full h-full object-cover pointer-events-none',
                        showFallback ? 'opacity-0' : 'opacity-100',
                        videoClassName
                    )}
                />
            )}

            {showFallback && (
                <div className={cn('absolute inset-0 flex items-center justify-center bg-black/40', fallbackClassName)}>
                    <Play className={cn('w-10 h-10 text-white/70', iconClassName)} />
                </div>
            )}

            {showOverlay && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={cn('rounded-full bg-black/35 p-3 backdrop-blur-sm', iconContainerClassName)}>
                        <Play className={cn('w-8 h-8 text-white/85', iconClassName)} />
                    </div>
                </div>
            )}
        </div>
    );
}

export function VideoFramePreview(props: VideoFramePreviewProps) {
    return <VideoFramePreviewInner key={props.src} {...props} />;
}
