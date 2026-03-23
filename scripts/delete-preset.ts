/**
 * One-shot: Delete admin_preset from Firestore users collection
 */
import { initializeApp } from "firebase/app";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";

const app = initializeApp({
    apiKey: "AIzaSyAybBtOavxRoZ2unWpl5lVxFtOyxT8KksI",
    authDomain: "focus-club-252dc.firebaseapp.com",
    projectId: "focus-club-252dc",
    storageBucket: "focus-club-252dc.firebasestorage.app",
    messagingSenderId: "674130559920",
    appId: "1:674130559920:web:54b75c668f43d141bb8c75",
});

const db = getFirestore(app);

async function main() {
    const ref = doc(db, "users", "admin_preset");
    const snap = await getDoc(ref);
    if (snap.exists()) {
        await deleteDoc(ref);
        console.log("✅ Documento users/admin_preset eliminado");
    } else {
        console.log("ℹ️  users/admin_preset no existe (ya eliminado)");
    }
    process.exit(0);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
