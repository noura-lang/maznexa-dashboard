// Verifies Firebase ID tokens WITHOUT the firebase-admin SDK. firebase-admin
// pulls in jwks-rsa, which itself depends on a version of `jose` that's
// ESM-only in a way that crashes under CommonJS on Vercel — even with this
// folder's {"type": "commonjs"} override (see lib/package.json), because
// the broken require() call is buried inside firebase-admin's OWN
// dependency tree, several layers down, which we don't control:
//   Error [ERR_REQUIRE_ESM]: require() of ES Module .../jose/dist/webapi/index.js
//     from .../jwks-rsa/src/utils.js not supported.
//
// Instead, this verifies tokens directly against Google's public JWKS using
// `jose` ourselves — a well-supported, Firebase-documented pattern for
// verifying ID tokens outside the Admin SDK ("Verify ID tokens using a
// third-party JWT library"). The checks below mirror exactly what the
// Admin SDK itself performs. `jose`'s own installed version is ESM-only
// too, so it's loaded via a dynamic `import()` — unlike `require()`,
// dynamic `import()` can load an ES module from a CommonJS file just fine,
// which is exactly why this works where the SDK's internal require() didn't.

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

// Cached across warm serverless invocations, same as the Sheets client in
// googleSheets.js — createRemoteJWKSet keeps its own internal cache of the
// fetched keys too (with cache-control-aware refetching), so this just
// avoids re-creating that wrapper on every request.
let jwksPromise = null
function getJwks() {
  if (!jwksPromise) {
    jwksPromise = import('jose').then(({ createRemoteJWKSet }) => createRemoteJWKSet(new URL(JWKS_URL)))
  }
  return jwksPromise
}

// Verifies a Firebase Auth ID token per Firebase's own manual-verification
// checklist: signature against Google's live public keys, issuer, audience,
// and expiration (all via `jose`'s jwtVerify), plus the two checks `jose`
// has no way to know are Firebase-specific — `auth_time` must be in the
// past, and `sub` must be a non-empty string no longer than 128 characters
// (the Firebase UID format). Throws on any failure — callers should treat
// any thrown error as "invalid token", same as a rejected
// firebase-admin verifyIdToken() call.
async function verifyIdToken(token) {
  const { jwtVerify } = await import('jose')
  const jwks = await getJwks()

  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
    algorithms: ['RS256'],
  })

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.auth_time !== 'number' || payload.auth_time > now) {
    throw new Error('Token auth_time is invalid or in the future')
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    throw new Error('Token subject (sub) is missing or invalid')
  }

  return payload
}

// Same shape as firebase-admin's `getAuth()` return value, scoped to the
// one method this app actually uses — verifyEmployee.js calls
// `firebaseAuth.verifyIdToken(token)` and reads `.email` off the result,
// exactly as it did against the real Admin SDK, so nothing downstream of
// this file needs to change.
const firebaseAuth = { verifyIdToken }

module.exports = { firebaseAuth }
