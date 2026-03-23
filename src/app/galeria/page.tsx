import GaleriaClient from './GaleriaClient';
import { listCloudinaryImages } from '@/lib/cloudinary-lib';

export default async function GaleriaPage() {
    const resources = await listCloudinaryImages('Galeria');

    return (
        <div className="min-h-screen bg-background">
            <GaleriaClient initialResources={resources} />
        </div>
    );
}
