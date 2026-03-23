/**
 * Añade el campo "icon" a cada documento de la colección "services" en Firestore.
 * El icono se asigna según el título del servicio.
 *
 * Ejecutar con: node scripts/update-service-icons.js
 */

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

// Mapa título → nombre del icono (debe coincidir con las claves del ICON_MAP del frontend)
const ICON_BY_TITLE = {
    'Preparación para Competición': 'Trophy',
    'Nutrición y Recomposición': 'Apple',
    'Sesión de Entrenamiento Personal': 'Dumbbell',
    'Bono Mensual de Entrenamiento': 'Users',
    // Títulos anteriores (por si quedan en Firestore)
    'Entrenamiento Personal': 'Dumbbell',
    'Valoración Inicial': 'Activity',
};

async function updateIcons() {
    console.log('=== Actualizando iconos de servicios en Firestore ===\n');

    const snapshot = await db.collection('services').get();

    if (snapshot.empty) {
        console.log('  [AVISO] La colección "services" está vacía.');
        process.exit(0);
    }

    let updated = 0;
    let skipped = 0;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const icon = ICON_BY_TITLE[data.title];

        if (!icon) {
            console.log(`  [SKIP] "${data.title}" — sin icono definido, se omite`);
            skipped++;
            continue;
        }

        await docSnap.ref.update({ icon });
        console.log(`  [OK]   "${data.title}" → icon: "${icon}"`);
        updated++;
    }

    console.log(`\n  Actualizados: ${updated} | Omitidos: ${skipped}`);
    process.exit(0);
}

updateIcons().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
