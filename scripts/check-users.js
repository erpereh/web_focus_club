const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve(__dirname, '..', 'focus-club-f73b8-firebase-adminsdk-fbsvc-3355d90550.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'focus-club-f73b8',
});

const db = admin.firestore();

async function check() {
  // 1. Check Firestore users collection
  console.log('=== FIRESTORE: users collection ===');
  const usersSnap = await db.collection('users').get();
  if (usersSnap.empty) {
    console.log('  (vacía - no hay documentos)');
  } else {
    usersSnap.forEach(doc => {
      console.log(`  Doc ID: ${doc.id}`);
      console.log(`  Data:`, JSON.stringify(doc.data(), null, 2));
    });
  }

  // 2. Check Firebase Auth users
  console.log('\n=== FIREBASE AUTH: usuarios registrados ===');
  try {
    const listResult = await admin.auth().listUsers(100);
    if (listResult.users.length === 0) {
      console.log('  (no hay usuarios en Auth)');
    } else {
      listResult.users.forEach(user => {
        console.log(`  UID: ${user.uid}`);
        console.log(`  Email: ${user.email}`);
        console.log(`  Created: ${user.metadata.creationTime}`);
        console.log('  ---');
      });
    }
  } catch (err) {
    console.log('  Error listing auth users:', err.message);
  }

  process.exit(0);
}

check();
