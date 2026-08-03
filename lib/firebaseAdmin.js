// CommonJS deliberately — the project root's package.json has
// "type": "module", so a plain .js file here would normally load as ESM,
// and firebase-admin's own dependency chain (jwks-rsa) does an internal
// require() that breaks under Node's ESM loader with:
//   Error [ERR_REQUIRE_ESM]: require() of ES Module .../jwks-rsa/src/index.js
// lib/package.json (sibling to this file) sets {"type": "commonjs"},
// overriding the root's "type": "module" for just this folder — Node
// resolves a file's module type from the NEAREST package.json, so this
// folder's .js files load as CommonJS regardless of the root config. That
// keeps firebase-admin's whole dependency graph in one consistent module
// system and avoids the interop failure. (An earlier attempt renamed these
// files to .cjs instead, which also fixes the ESM/CJS issue but made
// Vercel stop recognizing api/*.cjs as valid serverless function routes —
// this package.json-scoped approach avoids that side effect entirely.)
//
// Uses the modular subpath imports (firebase-admin/app, firebase-admin/auth)
// rather than the classic `require('firebase-admin')` namespace — firebase-
// admin v14's top-level CJS entry no longer re-exports `admin.credential`/
// `admin.auth()`/`admin.apps` at all (confirmed by inspecting its actual
// exports: only initializeApp/getApp/getApps/deleteApp/cert/etc. from the
// `app` submodule), so the classic pattern silently returns `undefined` for
// `admin.apps`/`admin.credential` instead of erroring.
const { cert, getApps, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

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

const firebaseAuth = getAuth()

module.exports = { firebaseAuth }
