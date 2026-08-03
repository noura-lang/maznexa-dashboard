// CommonJS — see firebaseAdmin.js for why.
const { firebaseAuth } = require('./firebaseAdmin.js')
const { sheetsClient, fetchNamedRows, ACCESS_SHEET_ID } = require('./googleSheets.js')

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function readAuthHeader(req) {
  const value = req.headers['authorization']
  return Array.isArray(value) ? value[0] : value
}

function findRowByEmail(rows, email) {
  return rows.find(row => (row['Email'] || '').toLowerCase() === email) || null
}

// Mirrors src/api/accessSheetApi.js's `parseBool` exactly — same truthy set
// ('true'/'yes'/'1'), so a Permissions row is interpreted identically here
// and in the client-side Admin Panel / permission gates.
const TRUTHY = new Set(['true', 'yes', '1'])
const parseBool = value => TRUTHY.has(String(value ?? '').trim().toLowerCase())

// Verifies the caller's Firebase ID token, then resolves their exact Name
// (Employees tab) and Admin flag (Permissions tab) from the Access Sheet —
// the same single source of truth every other part of this app already
// uses for identity/permissions (see src/api/accessSheetApi.js), read here
// via the service account instead of the caller's own OAuth token, since
// these two data sheets are deliberately never shared with individual
// employee Google accounts.
async function verifyEmployee(req) {
  const authHeader = readAuthHeader(req) || ''
  const match = authHeader.match(/^Bearer (.+)$/)
  if (!match) throw new HttpError(401, 'Missing or malformed Authorization header')

  let decoded
  try {
    decoded = await firebaseAuth.verifyIdToken(match[1])
  } catch (err) {
    // Server-side only — never sent to the client, which still gets the
    // generic message below. Logs everything useful for diagnosing WHY
    // verification failed (expired vs. audience/issuer mismatch vs. bad
    // signature vs. JWKS fetch failure vs. our own auth_time/sub checks in
    // firebaseAdmin.js) without ever logging the token itself.
    console.error('verifyEmployee: ID token verification failed', {
      errorName: err?.name,
      errorCode: err?.code,
      errorMessage: err?.message,
      tokenLength: match[1]?.length,
      tokenPrefix: match[1]?.slice(0, 12),
      projectIdConfigured: !!process.env.VITE_FIREBASE_PROJECT_ID,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    })
    throw new HttpError(401, 'Invalid or expired session token — please sign in again')
  }

  const email = (decoded.email || '').toLowerCase()
  if (!email) throw new HttpError(401, 'Token has no email claim')

  const sheets = sheetsClient()
  const [employeeRows, permissionRows] = await Promise.all([
    fetchNamedRows(sheets, ACCESS_SHEET_ID, 'Employees'),
    fetchNamedRows(sheets, ACCESS_SHEET_ID, 'Permissions'),
  ])

  const employeeRow = findRowByEmail(employeeRows, email)
  if (!employeeRow) throw new HttpError(403, 'No employee record found for this account')

  const permissionRow = findRowByEmail(permissionRows, email)
  const isAdmin = parseBool(permissionRow?.['Admin'])

  return { email, name: employeeRow['Name'], isAdmin }
}

module.exports = { verifyEmployee, HttpError }
