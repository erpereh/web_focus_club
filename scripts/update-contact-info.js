const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(
    path.resolve(__dirname, '..', 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json')
);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'focus-club-f73b8',
});

const db = admin.firestore();

async function run() {
    await db.doc('site_content/main').update({
        address: 'C. de Peñaranda de Bracamonte, 69, Local 4, Villa de Vallecas, 28051 Madrid',
    });
    console.log('Dirección actualizada.');
    process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
