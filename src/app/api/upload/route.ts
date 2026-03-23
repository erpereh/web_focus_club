import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        let folder = formData.get('folder') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!folder || folder.trim() === '') {
            folder = 'General';
        }
        const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uploadFolder = safeFolder;

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                { folder: uploadFolder, resource_type: 'auto' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(buffer);
        });

        return NextResponse.json({ secure_url: (uploadResult as any).secure_url }, { status: 200 });
    } catch (error) {
        console.error('Error in /api/upload Route:', error);
        return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }
}
