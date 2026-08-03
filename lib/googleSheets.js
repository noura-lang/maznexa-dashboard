// CommonJS — see firebaseAdmin.js for why (lib/package.json sets
// {"type": "commonjs"} for this folder, overriding the project root's
// "type": "module", keeping firebase-admin's/googleapis's dependency
// graphs in one consistent module system on Vercel).
const { google } = require('googleapis')

const ACCESS_SHEET_ID = process.env.VITE_ACCESS_SHEET_ID
const AM_SHEET_ID = process.env.VITE_AM_SHEET_ID
const COST_SHEET_ID = process.env.VITE_COST_SHEET_ID

let cachedClient = null

// Service-account-authenticated Sheets client, shared by every secure API
// route in /api — this is the ONLY way the AM Targets / Employee Cost
// sheets (and the Access Sheet's Employees/Permissions tabs, for identity
// lookups) should ever be read server-side. Never wire a caller's own
// Google OAuth token into this client — that would defeat the entire point
// of moving these sheets behind row-filtered server routes. Cached across
// warm serverless invocations so each request doesn't re-authenticate.
function sheetsClient() {
  if (cachedClient) return cachedClient
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  cachedClient = google.sheets({ version: 'v4', auth })
  return cachedClient
}

// Reads one tab as an array of row objects keyed by its header row — mirrors
// the exact parsing shape every client-side `*SheetApi.js` file already
// produces (see src/api/amSheetApi.js, costSheetApi.js, accessSheetApi.js),
// so server-side callers can reuse the same downstream logic unmodified.
async function fetchNamedRows(sheets, spreadsheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabName })
  const values = res.data.values || []
  if (values.length < 2) return []
  const [rawHeaders, ...rows] = values
  const headers = rawHeaders.map(h => (h ?? '').trim())
  return rows
    .filter(row => row.some(cell => cell !== ''))
    .map(row => Object.fromEntries(headers.map((h, i) => [h, (row[i] ?? '').trim()])))
}

// Raw values (no header parsing) — for tabs whose header row has duplicate
// column names and must be parsed by fixed column position instead (e.g.
// the AM Sheet's Targets tab, which has two columns both literally named
// "Dream Targets").
async function fetchRawValues(sheets, spreadsheetId, tabName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabName })
  return res.data.values || []
}

module.exports = { sheetsClient, fetchNamedRows, fetchRawValues, ACCESS_SHEET_ID, AM_SHEET_ID, COST_SHEET_ID }
