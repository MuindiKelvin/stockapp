// Usage: npm run make-admin -- someone@example.com
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const email = process.argv[2];
if (!email) { console.error("Usage: npm run make-admin -- someone@example.com"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(new URL("../serviceAccountKey.json", import.meta.url)))) });
const u = await getAuth().getUserByEmail(email);
await getFirestore().doc(`users/${u.uid}`).set({ name: u.displayName || "", email: u.email, phone: "", role: "admin", verified: true }, { merge: true });
await getAuth().updateUser(u.uid, { emailVerified: true });
console.log(`${u.email} is now an administrator.`);
