/**
 * Seed the trainers collection with the admin user as the first trainer.
 * Run: node scripts/seed-trainers.js
 */
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(
  path.resolve(__dirname, '..', 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function seed() {
  // Get the admin user from users collection
  const usersSnap = await db.collection('users').where('role', '==', 'admin').get();
  
  if (usersSnap.empty) {
    console.log('No admin user found. Skipping trainer seed.');
    return;
  }

  const adminUser = usersSnap.docs[0].data();
  console.log(`Found admin: ${adminUser.name} (${adminUser.email})`);

  // Check if trainer already exists for this uid
  const existingTrainer = await db.collection('trainers').where('uid', '==', adminUser.uid).get();
  if (!existingTrainer.empty) {
    console.log('Trainer doc already exists for admin. Skipping.');
    return;
  }

  // Create trainer doc
  const trainerRef = await db.collection('trainers').add({
    uid: adminUser.uid,
    name: adminUser.name,
    specialties: ['Entrenamiento Personal', 'Preparación Competición'],
    active: true,
    createdAt: new Date().toISOString(),
  });

  console.log(`Trainer created: ${trainerRef.id} for ${adminUser.name}`);
  console.log('Done!');
}

seed().catch(console.error);
