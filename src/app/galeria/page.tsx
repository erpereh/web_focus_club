import GaleriaClient from './GaleriaClient';
import { listCloudinaryImages } from '@/lib/cloudinary-lib';
import { getSiteContent, getActiveGalleryItemsByDate } from '@/lib/firestore';

export default async function GaleriaPage() {
    const [resources, cmsData, galleryItems] = await Promise.all([
        listCloudinaryImages('Galeria'),
        getSiteContent(),
        getActiveGalleryItemsByDate(),
    ]);

    return (
        <div className="min-h-screen">
            <GaleriaClient
                initialResources={resources}
                galeriaContent={cmsData?.galeria}
                galleryItems={galleryItems}
            />
        </div>
    );
}
