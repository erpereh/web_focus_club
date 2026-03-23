import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyCUzzk5jKa6UHyEGIcePo30YygHZbiVOAM",
    authDomain: "focus-club-f73b8.firebaseapp.com",
    projectId: "focus-club-f73b8",
    storageBucket: "focus-club-f73b8.firebasestorage.app",
    messagingSenderId: "1555015411",
    appId: "1:1555015411:web:7ff618d77878d868e67986",
    measurementId: "G-NG9197GH5N",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
