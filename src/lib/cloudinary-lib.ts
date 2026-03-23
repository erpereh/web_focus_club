import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL
});

export interface CloudinaryResource {
    public_id: string;
    url: string;
    resource_type: 'image' | 'video';
    format: string;
    width: number;
    height: number;
    folder: string;
}

export async function listCloudinaryImages(folder: string): Promise<CloudinaryResource[]> {
    try {
        const result = await cloudinary.search
            .expression(`folder:${folder}`)
            .sort_by('created_at', 'desc')
            .max_results(100)
            .execute();

        return result.resources.map((res: any) => ({
            public_id: res.public_id,
            url: res.secure_url,
            resource_type: res.resource_type,
            format: res.format,
            width: res.width,
            height: res.height,
            folder: res.folder || ''
        }));
    } catch (error) {
        console.error(`Error listing Cloudinary folder ${folder}:`, error);
        return [];
    }
}
