import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

// Reuses the same service-account credentials already used for the Sheets
// API (GOOGLE_SERVICE_ACCOUNT_EMAIL / _PRIVATE_KEY) rather than provisioning
// a second, dedicated Admin SDK key. This is safe: verifyIdToken() checks
// the token's `aud`/`iss` claims against the `projectId` configured below,
// and validates the signature against Google's public signing certs
// (fetched unauthenticated) — it never makes any Google API call *as* this
// service account, so the credential's own GCP project doesn't need to
// match the Firebase project the tokens were issued for.
if (!getApps().length) {
  initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    credential: cert({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Vercel env vars store the key with literal `\n` sequences, not real
      // newlines — same fix already applied everywhere else this key is used.
      privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  })
}

export const firebaseAuth = getAuth()
