import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

// Cloudinary connection is auto-configured via CLOUDINARY_URL in .env.local

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const requestFolder = searchParams.get('folder');

        // Sanitize folder name the SAME way as the upload route does
        const safeFolder = requestFolder
            ? requestFolder.replace(/[^a-zA-Z0-9_-]/g, '_')
            : null;

        // Build the prefix: folder name + trailing slash so it matches exactly inside that folder
        const prefix = safeFolder && safeFolder !== 'General'
            ? `${safeFolder}/`
            : undefined;

        console.log(`[/api/images] Listing resources with prefix="${prefix ?? '(root)'}" for folder="${requestFolder}"`);

        // Fetch images using api.resources (NOT search)
        const imageResult = await cloudinary.api.resources({
            type: 'upload',
            resource_type: 'image',
            max_results: 100,
            ...(prefix ? { prefix } : {}),
        });

        // Fetch videos
        const videoResult = await cloudinary.api.resources({
            type: 'upload',
            resource_type: 'video',
            max_results: 100,
            ...(prefix ? { prefix } : {}),
        });

        const allResources = [
            ...(imageResult.resources || []),
            ...(videoResult.resources || []),
        ];

        // Sort by created_at descending
        allResources.sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        console.log(`[/api/images] Found ${allResources.length} resources (${imageResult.resources?.length ?? 0} images, ${videoResult.resources?.length ?? 0} videos)`);

        const mappedImages = allResources.map((res: any) => ({
            public_id: res.public_id,
            url: res.secure_url,
            resource_type: res.resource_type,
            format: res.format,
            created_at: res.created_at,
            width: res.width,
            height: res.height,
            folder: res.folder || '',
        }));

        return NextResponse.json({ images: mappedImages }, { status: 200 });

    } catch (error: any) {
        console.error('[/api/images] Error fetching from Cloudinary:', error?.message || error);
        console.error('[/api/images] Full error:', JSON.stringify(error, null, 2));
        return NextResponse.json(
            { error: 'Failed to fetch images', details: error?.message || 'Unknown error' },
            { status: 500 }
        );
    }
}
