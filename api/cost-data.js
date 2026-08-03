import { verifyEmployee, HttpError } from '../lib/verifyEmployee.js'
import { sheetsClient, fetchNamedRows, COST_SHEET_ID } from '../lib/googleSheets.js'

// Row-level-filtered replacement for src/api/costSheetApi.js's client-side
// fetchCostRates — the Cost sheet only holds per-employee hourly RATES
// (what the agency pays per hour worked); the actual per-project/client
// cost figures are computed client-side by joining these rates against the
// Main Sheet's Raw Time Log, which is already public and untouched by this
// change. Reads the sheet ONLY via the service account (never a caller's
// own OAuth token) and returns every employee's own rate rows (or
// everyone's, if their Permissions row has Admin=TRUE) — the returned
// shape is identical to fetchCostRates's, so every downstream client-side
// calc function (buildCostRateMap, calcEmployeeCostRows, etc.) needs no
// changes at all.
const parseNum = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0

const MONTH_NAME_TO_NUM = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
}

// Mirrors src/api/costSheetApi.js's parseCostMonthKey exactly — duplicated
// rather than imported, since that file lives in the browser bundle and
// pulls in other frontend-only modules; this keeps the serverless
// function's dependency graph self-contained.
function parseCostMonthKey(dateStr) {
  const match = (dateStr || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!match) return ''
  const num = MONTH_NAME_TO_NUM[match[1].toLowerCase()]
  return num ? `${match[2]}-${num}` : ''
}

// Field-for-field identical to fetchCostRates in src/api/costSheetApi.js.
async function fetchCostRates(sheets) {
  const rows = await fetchNamedRows(sheets, COST_SHEET_ID, 'Cost')
  return rows
    .map(row => ({
      monthKey: parseCostMonthKey(row['Date']),
      team: row['Team'] || '',
      employee: row['Employee Name'] || '',
      rate: parseNum(row['Cost By Hours']),
      hasRate: (row['Cost By Hours'] || '') !== '',
    }))
    .filter(r => r.monthKey && r.employee)
}

export default async function handler(req, res) {
  try {
    const { name, isAdmin } = await verifyEmployee(req)
    const sheets = sheetsClient()
    const rates = await fetchCostRates(sheets)

    if (isAdmin) {
      res.status(200).json(rates)
      return
    }

    // Case-insensitive match, same convention buildCostRateMap already uses
    // (a real mismatch was found during sheet inspection: "Menna Shaqran"
    // here vs "menna shaqran" in Raw Time Log's WHO column).
    const wanted = name.trim().toLowerCase()
    res.status(200).json(rates.filter(r => r.employee.trim().toLowerCase() === wanted))
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('cost-data error:', err)
    res.status(500).json({ error: 'Failed to load Cost Analysis data' })
  }
}
