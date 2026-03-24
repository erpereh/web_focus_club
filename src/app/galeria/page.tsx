import GaleriaClient from './GaleriaClient';
import { listCloudinaryImages } from '@/lib/cloudinary-lib';
import { getSiteContent } from '@/lib/firestore';

export default async function GaleriaPage() {
    const [resources, cmsData] = await Promise.all([
        listCloudinaryImages('Galeria'),
        getSiteContent(),
    ]);

    return (
        <div className="min-h-screen bg-background">
            <GaleriaClient initialResources={resources} galeriaContent={cmsData?.galeria} />
        </div>
    );
}
