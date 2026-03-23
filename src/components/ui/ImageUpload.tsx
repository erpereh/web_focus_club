import React, { useState, useRef } from 'react';
import { UploadCloud, X, Loader2 } from 'lucide-react';
import { PremiumButton } from '@/components/ui/premium-button';

interface ImageUploadProps {
    onUpload: (url: string) => void;
    className?: string;
    buttonText?: string;
    folder?: string;
}

export function ImageUpload({ onUpload, className = '', buttonText = 'Subir Imagen', folder = 'General' }: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate size (e.g., max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError('El archivo es demasiado grande (máximo 5MB).');
            return;
        }

        setIsUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', folder);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Error al subir la imagen');
            }

            onUpload(data.secure_url);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Error de conexión');
        } finally {
            setIsUploading(false);
            // Reset input so the same file can be selected again if needed
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`}>
            <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                disabled={isUploading}
            />
            <div>
                <PremiumButton
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    icon={isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                >
                    {isUploading ? 'Subiendo...' : buttonText}
                </PremiumButton>
            </div>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}
