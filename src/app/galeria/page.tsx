import { Camera } from 'lucide-react';
import Image from 'next/image';
import GaleriaClient from './GaleriaClient';
import { listCloudinaryImages } from '@/lib/cloudinary-lib';

export default async function GaleriaPage() {
    // This runs at BUILD TIME because of output: "export"
    const resources = await listCloudinaryImages('Galeria');

    return (
        <div className="min-h-screen bg-obsidian relative overflow-hidden pt-24 pb-20">
            {/* Background Watermark Logo */}
            <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center opacity-[0.03]">
                <Image
                    src="/images/logo.png"
                    alt="Focus Club Logo"
                    width={800}
                    height={800}
                    className="object-contain"
                />
            </div>

            <div className="container mx-auto px-4 relative z-10">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <div className="inline-flex items-center justify-center p-3 bg-emerald/10 rounded-2xl mb-6 text-accent">
                        <Camera className="w-8 h-8" />
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-ivory tracking-tight mb-4">
                        Galería
                    </h1>
                    <p className="text-muted-foreground text-lg md:text-xl font-light">
                        Descubre nuestras instalaciones, nuestro equipo y el ambiente de entrenamiento en Focus Club Vallecas.
                    </p>
                </div>

                <GaleriaClient initialResources={resources} />
            </div>
        </div>
    );
}
