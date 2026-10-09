// Usage: npm run verify-all
// Marks every existing user as email-verified in Firebase Authentication and in the users collection.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: cert(JSON.parse(readFileSync(new URL("../serviceAccountKey.json", import.meta.url)))) });
const auth = getAuth(), db = getFirestore();
let authDone = 0, docDone = 0, token;
do {
  const page = await auth.listUsers(1000, token);
  for (const u of page.users) {
    if (!u.emailVerified) { await auth.updateUser(u.uid, { emailVerified: true }); authDone++; }
  }
  token = page.pageToken;
} while (token);
const snap = await db.collection("users").get();
for (const d of snap.docs) {
  if (d.data().verified !== true) { await d.ref.update({ verified: true }); docDone++; }
}
console.log(`Verified ${authDone} account(s) in Authentication and ${docDone} profile(s) in Firestore.`);
