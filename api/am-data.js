// CommonJS — this folder has its own api/package.json with
// {"type": "commonjs"}, overriding the project root's "type": "module" just
// for these serverless functions. See lib/firebaseAdmin.js for why.
const { verifyEmployee, HttpError } = require('../lib/verifyEmployee.js')
const { sheetsClient, fetchNamedRows, fetchRawValues, AM_SHEET_ID } = require('../lib/googleSheets.js')

// Row-level-filtered replacement for src/api/amSheetApi.js's client-side
// fetchAmZoho/fetchAmTargets/fetchAmMarginEmployeeNames — those read the AM
// Targets sheet via the signed-in user's own Google OAuth token (meaning
// their Google account needed real Drive-level Viewer access to the whole
// sheet, and could technically read every AM's numbers with dev tools).
// This route instead reads the sheet ONLY via the service account, verifies
// the caller's identity from their Firebase ID token, and returns every
// employee's own row set (or everyone's, if their Permissions row has
// Admin=TRUE) — no employee Google account ever needs (or gets) direct
// access to this sheet.
const parseNum = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0

// Field-for-field identical to fetchAmZoho in src/api/amSheetApi.js.
async function fetchAmZoho(sheets) {
  const rows = await fetchNamedRows(sheets, AM_SHEET_ID, 'Zoho')
  return rows.map(row => {
    const upsell = parseNum(row['Upsell (SAR)'])
    const actual = parseNum(row['Actual (SAR)'])
    const costOfEffort = parseNum(row['Cost of Effort'])
    const thirdPartyCost = parseNum(row['Third Party Cost'])
    return {
      employee: row['Employee'] || '',
      client: row['Company Name'] || '',
      month: row['Month'] || '',
      forecast: parseNum(row['Forecast (SAR)']),
      upsell,
      actual,
      costOfEffort,
      thirdPartyCost,
      grossProfit: actual + upsell - costOfEffort - thirdPartyCost,
      gpMarginPct: parseNum(row['GP Margin %']),
      date: row['Date'] || '',
    }
  })
}

// Field-for-field identical to fetchAmTargets in src/api/amSheetApi.js —
// the Targets tab has two columns both literally named "Dream Targets", so
// it's parsed by fixed column position, not header name.
async function fetchAmTargets(sheets) {
  const values = await fetchRawValues(sheets, AM_SHEET_ID, 'Targets')
  if (values.length < 2) return []
  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => ({
      employee: (row[0] || '').trim(),
      gpBudget: parseNum(row[1]),
      gpFloorPct: parseNum(row[2]),
      gpTarget: parseNum(row[3]),
      gpTargetPct: parseNum(row[4]),
      gpStretch: parseNum(row[5]),
      gpStretchPct: parseNum(row[6]),
      dreamTarget: parseNum(row[7]),
      dreamTargetPct: parseNum(row[8]),
    }))
}

async function fetchAmMarginNames(sheets) {
  const rows = await fetchNamedRows(sheets, AM_SHEET_ID, 'Margin')
  const names = new Set()
  rows.forEach(row => {
    const name = (row['Employee'] || '').trim()
    if (name) names.add(name)
  })
  return [...names]
}

module.exports = async function handler(req, res) {
  try {
    const { name, isAdmin } = await verifyEmployee(req)
    const sheets = sheetsClient()
    const [zoho, targets, marginNames] = await Promise.all([
      fetchAmZoho(sheets),
      fetchAmTargets(sheets),
      fetchAmMarginNames(sheets),
    ])

    if (isAdmin) {
      res.status(200).json({ zoho, targets, marginNames })
      return
    }

    // Non-admins only ever see their own rows — the dropdown roster this
    // feeds (getAmEmployeeRoster) always has exactly one entry: themselves,
    // even if they happen to have no Margin-tab row yet.
    res.status(200).json({
      zoho: zoho.filter(r => r.employee === name),
      targets: targets.filter(r => r.employee === name),
      marginNames: [name],
    })
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('am-data error:', err)
    res.status(500).json({ error: 'Failed to load Account Managers Performance data' })
  }
}
