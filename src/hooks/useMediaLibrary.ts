'use client';

import { useState, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import {
    getMediaFolders,
    getMediaFiles,
    getAllMediaFiles,
    createMediaFolder,
    renameMediaFolder,
    deleteMediaFolder,
    addMediaFile,
    updateMediaFile,
    deleteMediaFileRecord,
    getOrCreateGalleryFolder,
    getOrCreateBrandingFolder,
    getOrCreateSandraFolder,
} from '@/lib/firestore';
import type { MediaFolder, MediaFile, UploadProgress } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// RECURSIVE FOLDER DELETION (private helper)
// ============================================

async function recursiveDeleteFolder(folderId: string): Promise<void> {
    // 1. Delete all files inside this folder
    const files = await getMediaFiles(folderId);
    await Promise.all(
        files.map(async (file) => {
            try {
                const storageRef = ref(storage, file.storagePath);
                await deleteObject(storageRef);
            } catch {
                // swallow missing-file errors
            }
            await deleteMediaFileRecord(file.id);
        })
    );

    // 2. Find and recurse into child folders
    const allFolders = await getMediaFolders();
    const children = allFolders.filter((f) => f.parentId === folderId);
    await Promise.all(children.map((child) => recursiveDeleteFolder(child.id)));

    // 3. Delete this folder document
    await deleteMediaFolder(folderId);
}

// ============================================
// HOOK
// ============================================

export function useMediaLibrary() {
    const [folders, setFolders] = useState<MediaFolder[]>([]);
    const [files, setFiles] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
    const [galleryFolderId, setGalleryFolderId] = useState<string | null>(null);
    const [brandingFolderId, setBrandingFolderId] = useState<string | null>(null);
    const [sandraFolderId, setSandraFolderId] = useState<string | null>(null);

    // --- FETCH ---

    const fetchFolders = useCallback(async () => {
        setLoading(true);
        try {
            const [data, galleryResult, brandingResult, sandraResult] = await Promise.all([
                getMediaFolders(),
                getOrCreateGalleryFolder(),
                getOrCreateBrandingFolder(),
                getOrCreateSandraFolder(),
            ]);
            setFolders(data);
            setGalleryFolderId(galleryResult.folderId);
            setBrandingFolderId(brandingResult.folderId);
            setSandraFolderId(sandraResult.folderId);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchFiles = useCallback(async (folderId: string | null) => {
        setLoading(true);
        try {
            const data = folderId === 'ALL'
                ? await getAllMediaFiles()
                : await getMediaFiles(folderId);
            setFiles(data);
        } finally {
            setLoading(false);
        }
    }, []);

    // --- FOLDERS ---

    const handleCreateFolder = async (name: string, parentId: string | null): Promise<string> => {
        const id = await createMediaFolder(name, parentId);
        await fetchFolders();
        return id;
    };

    const handleRenameFolder = async (id: string, name: string): Promise<void> => {
        await renameMediaFolder(id, name);
        await fetchFolders();
    };

    const handleDeleteFolder = async (id: string): Promise<void> => {
        await recursiveDeleteFolder(id);
        await fetchFolders();
    };

    // --- UPLOAD ---

    const uploadFile = async (
        file: File,
        folderId: string | null,
        onProgress?: (p: number) => void
    ): Promise<MediaFile> => {
        const ext = file.name.split('.').pop() ?? 'bin';
        const uniqueName = `${uuidv4()}.${ext}`;
        const storagePath =
            folderId && folderId === galleryFolderId
                ? `public/imagenes/galeria/${uniqueName}`
                : folderId && folderId === brandingFolderId
                    ? `public/imagenes/branding/${uniqueName}`
                    : folderId && folderId === sandraFolderId
                        ? `public/imagenes/sandra/${uniqueName}`
                        : folderId
                        ? `media/${folderId}/${uniqueName}`
                        : `media/root/${uniqueName}`;

        const storageRef = ref(storage, storagePath);
        const type: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';

        return new Promise((resolve, reject) => {
            const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

            task.on(
                'state_changed',
                (snapshot) => {
                    const progress = Math.round(
                        (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                    );
                    onProgress?.(progress);
                },
                (error) => reject(error),
                async () => {
                    const url = await getDownloadURL(task.snapshot.ref);
                    const record: Omit<MediaFile, 'id'> = {
                        name: file.name,
                        url,
                        storagePath,
                        folderId,
                        type,
                        size: file.size,
                        createdAt: new Date().toISOString(),
                    };
                    const id = await addMediaFile(record);
                    resolve({ id, ...record });
                }
            );
        });
    };

    const uploadMultipleFiles = async (
        fileList: File[],
        folderId: string | null
    ): Promise<void> => {
        const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'];
        const validFiles = fileList.filter((f) => ACCEPTED.includes(f.type));
        if (validFiles.length === 0) return;

        setUploadQueue(
            validFiles.map((f) => ({ fileName: f.name, progress: 0, status: 'uploading' }))
        );

        await Promise.allSettled(
            validFiles.map((file, index) =>
                uploadFile(file, folderId, (p) => {
                    setUploadQueue((prev) =>
                        prev.map((item, i) =>
                            i === index ? { ...item, progress: p } : item
                        )
                    );
                })
                    .then(() => {
                        setUploadQueue((prev) =>
                            prev.map((item, i) =>
                                i === index ? { ...item, progress: 100, status: 'done' } : item
                            )
                        );
                    })
                    .catch(() => {
                        setUploadQueue((prev) =>
                            prev.map((item, i) =>
                                i === index ? { ...item, status: 'error' } : item
                            )
                        );
                    })
            )
        );

        // Refresh after all uploads
        await fetchFiles(folderId);

        // Clear queue after a delay so the user can see "done" state
        setTimeout(() => setUploadQueue([]), 2500);
    };

    // --- FILES ---

    const moveFile = async (fileId: string, newFolderId: string | null): Promise<void> => {
        await updateMediaFile(fileId, { folderId: newFolderId });
    };

    const deleteFile = async (fileId: string, storagePath: string): Promise<void> => {
        try {
            const storageRef = ref(storage, storagePath);
            await deleteObject(storageRef);
        } catch {
            // swallow missing-file errors
        }
        await deleteMediaFileRecord(fileId);
    };

    const copyUrl = (url: string): void => {
        navigator.clipboard.writeText(url);
    };

    return {
        folders,
        files,
        loading,
        uploadQueue,
        setUploadQueue,
        galleryFolderId,
        brandingFolderId,
        sandraFolderId,
        fetchFolders,
        fetchFiles,
        createFolder: handleCreateFolder,
        renameFolder: handleRenameFolder,
        deleteFolder: handleDeleteFolder,
        uploadFile,
        uploadMultipleFiles,
        moveFile,
        deleteFile,
        copyUrl,
    };
}
