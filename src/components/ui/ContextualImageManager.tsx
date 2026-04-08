'use client';

import { useState, useEffect } from 'react';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { getMediaFolders } from '@/lib/firestore';
import type { MediaFile, MediaFolder } from '@/types';

interface ContextualImageManagerProps {
    currentUrl?: string;
    defaultFolder?: string;
    onSelect: (url: string) => void;
    onClose: () => void;
}

export function ContextualImageManager({ defaultFolder, onSelect, onClose }: ContextualImageManagerProps) {
    const [folders, setFolders] = useState<MediaFolder[]>([]);

    useEffect(() => {
        getMediaFolders().then(setFolders);
    }, []);

    const defaultFolderId = defaultFolder
        ? folders.find((f) => f.name.toLowerCase() === defaultFolder.toLowerCase())?.id
        : undefined;

    return (
        <MediaPicker
            open={true}
            onClose={onClose}
            onSelect={(file: MediaFile) => { onSelect(file.url); onClose(); }}
            defaultFolderId={defaultFolderId}
            filterType="image"
        />
    );
}
