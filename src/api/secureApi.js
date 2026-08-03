// Shared fetch wrapper for the two secure, server-filtered endpoints
// (/api/am-data, /api/cost-data) — these read the AM Targets and Employee
// Cost sheets through a Vercel serverless function backed by a Google
// service account, never the signed-in user's own Google OAuth token, and
// the function itself row-filters the response to the caller's own name
// unless their Permissions row has Admin=TRUE. Authenticates via the
// caller's Firebase ID token (verified server-side in lib/verifyEmployee.js),
// not the Sheets `accessToken` used everywhere else in this app.
export async function fetchSecureJson(path, firebaseUser) {
  if (!firebaseUser) throw new Error('Not signed in')
  const token = await firebaseUser.getIdToken()
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: HTTP ${res.status}`)
  }
  return res.json()
}
