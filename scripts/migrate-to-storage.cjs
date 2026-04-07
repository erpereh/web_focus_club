// migrate-to-storage.cjs
// Sube las 5 imágenes reales a Firebase Storage,
// crea registros en Firestore media_files y devuelve las URLs.
// Ejecutar: node scripts/migrate-to-storage.cjs

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json');
const BUCKET = 'focus-club-f73b8.firebasestorage.app';
const ROOT = path.join(__dirname, '..');

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET,
});

const bucket = admin.storage().bucket();
const db = admin.firestore();

const FILES = [
    { local: 'public/imagenes/sandra.jpg',            storage: 'public/imagenes/sandra.jpg',            type: 'image' },
    { local: 'public/imagenes/el_centro/baño.jpeg',   storage: 'public/imagenes/el_centro/baño.jpeg',   type: 'image' },
    { local: 'public/imagenes/el_centro/entrada.jpeg',storage: 'public/imagenes/el_centro/entrada.jpeg',type: 'image' },
    { local: 'public/imagenes/el_centro/gym1.jpeg',   storage: 'public/imagenes/el_centro/gym1.jpeg',   type: 'image' },
    { local: 'public/imagenes/el_centro/gym3.jpeg',   storage: 'public/imagenes/el_centro/gym3.jpeg',   type: 'image' },
];

const CONTENT_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

async function uploadFile(entry) {
    const fullLocal = path.join(ROOT, entry.local);
    const fileBuffer = fs.readFileSync(fullLocal);
    const fileSize = fs.statSync(fullLocal).size;
    const fileName = path.basename(entry.local);
    const ext = path.extname(entry.local).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const downloadToken = crypto.randomUUID();

    const file = bucket.file(entry.storage);
    await file.save(fileBuffer, {
        metadata: {
            contentType,
            metadata: {
                firebaseStorageDownloadTokens: downloadToken,
            },
        },
    });

    // Build Firebase download URL (permanent, token-based)
    const encoded = encodeURIComponent(entry.storage);
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}?alt=media&token=${downloadToken}`;

    // Create Firestore record in media_files
    await db.collection('media_files').add({
        name: fileName,
        url,
        storagePath: entry.storage,
        folderId: null,
        type: entry.type,
        size: fileSize,
        createdAt: admin.firestore.Timestamp.now(),
    });

    return { storagePath: entry.storage, url, size: fileSize };
}

async function main() {
    console.log('🚀 Iniciando migración a Firebase Storage...\n');
    const results = {};

    for (const entry of FILES) {
        process.stdout.write(`  Subiendo ${entry.local} ...`);
        try {
            const result = await uploadFile(entry);
            results[entry.local] = result.url;
            console.log(` ✓  (${(result.size / 1024).toFixed(0)} KB)`);
        } catch (err) {
            console.log(` ✗  ERROR: ${err.message}`);
            process.exit(1);
        }
    }

    console.log('\n=== URLs generadas ===');
    for (const [local, url] of Object.entries(results)) {
        console.log(`${local}:\n  ${url}\n`);
    }

    // Output JSON for use by the update step
    const outPath = path.join(__dirname, 'storage-urls.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\n✅ URLs guardadas en scripts/storage-urls.json`);
    console.log('✅ Registros creados en Firestore colección media_files');
}

main().catch((err) => {
    console.error('\n❌ Error fatal:', err);
    process.exit(1);
});
