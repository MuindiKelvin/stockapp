import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAKKjXdN8T9LrtH3NzEqdx3yd6GlXTXZmw",
  authDomain: "stock-app-71b7d.firebaseapp.com",
  projectId: "stock-app-71b7d",
  storageBucket: "stock-app-71b7d.firebasestorage.app",
  messagingSenderId: "152311286559",
  appId: "1:152311286559:web:39ec5bd60a1bae91b4fe2a",
  measurementId: "G-HPNP5X4C8K",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
isSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});
