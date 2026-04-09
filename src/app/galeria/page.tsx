import GaleriaClient from './GaleriaClient';
import { getSiteContent, getActiveGalleryItemsByDate } from '@/lib/firestore';

export default async function GaleriaPage() {
    const [cmsData, galleryItems] = await Promise.all([
        getSiteContent(),
        getActiveGalleryItemsByDate(),
    ]);

    return (
        <div className="min-h-screen">
            <GaleriaClient
                galeriaContent={cmsData?.galeria}
                galleryItems={galleryItems}
            />
        </div>
    );
}
