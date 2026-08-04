import { AM_SHEET_ID } from '../firebase'

// Account Managers Performance sheet — holds financial data (revenue
// forecasts, actuals, costs, gross profit per AM/client). Like the Access
// Sheet, this is NOT read via the public API key: every request here
// authenticates as the signed-in user's own Google OAuth access token (see
// src/firebase.js / AuthContext), so the data is only reachable by accounts
// Google has actually granted Viewer access to on this file in Drive — not
// just gated by the in-app Permissions flag. Never widen this to a public
// API-key fetch; that would make the numbers fetchable by anyone who can
// read the deployed site's JS bundle, regardless of in-app permissions.
const AM_TABS = {
  ZOHO:    'Zoho',
  TARGETS: 'Targets',
  MARGIN:  'Margin', // read here only to enumerate known employees (some,
                      // e.g. an AM with no active clients yet, have no rows
                      // in Zoho/Targets at all but do appear in Margin).
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

async function sheetsRequest(accessToken, path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${AM_SHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message || `AM Sheet API error: HTTP ${res.status}`
    )
  }
  return res.json()
}

// Generic named-header row reader (mirrors accessSheetApi.js's
// fetchAccessRows) — safe for tabs whose header row has no duplicate
// column names. The Targets tab does NOT qualify (see fetchAmTargets
// below) and is parsed by column position instead.
async function fetchNamedRows(accessToken, tabName) {
  const range = encodeURIComponent(tabName)
  const data = await sheetsRequest(accessToken, `/values/${range}`, { cache: 'no-store' })
  const values = data.values || []
  if (values.length < 2) return []

  const [rawHeaders, ...rows] = values
  const headers = rawHeaders.map(h => h.trim())

  return rows
    .filter(row => row.some(cell => cell !== ''))
    .map(row => Object.fromEntries(headers.map((h, j) => [h, (row[j] ?? '').trim()])))
}

const parseNum = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0

// Raw Zoho rows, parsed into clean numeric fields. This is the primary data
// source for the Account Managers Performance tab — already joined
// (employee + client + month) with Gross Profit / GP Margin computed, per
// the sheet inspection. Rows with a blank Employee (currently just the
// "Alareeb" client) are kept as-is; callers filtering by employee naturally
// exclude them.
//
// grossProfit is recomputed here rather than read from the sheet's own
// "Gross Profit" column: that column silently shows 0 (or is left blank)
// for any row where Actual is 0 that month, even when Cost of Effort /
// Third Party Cost were still incurred (e.g. a churned client with
// lingering costs) — understating real losses. Confirmed against Nouf
// Alenazi's STC rows for May/June, where the sheet's column reads 0 despite
// nonzero costs; recomputing drops her YTD margin from 27.1% to 18.8%.
export async function fetchAmZoho(accessToken) {
  const rows = await fetchNamedRows(accessToken, AM_TABS.ZOHO)
  return rows.map(row => {
    const upsell = parseNum(row['Upsell (SAR)'])
    const actual = parseNum(row['Actual (SAR)'])
    const costOfEffort = parseNum(row['Cost of Effort'])
    const thirdPartyCost = parseNum(row['Third Party Cost'])
    return {
      employee:     row['Employee'] || '',
      client:       row['Company Name'] || '',
      month:        row['Month'] || '',
      forecast:     parseNum(row['Forecast (SAR)']),
      upsell,
      actual,
      costOfEffort,
      thirdPartyCost,
      grossProfit:  actual + upsell - costOfEffort - thirdPartyCost,
      gpMarginPct:  parseNum(row['GP Margin %']),
      date:         row['Date'] || '',
    }
  })
}

// Targets tab's header row has two columns both literally named
// "Dream Targets" (one the SAR figure, one its %) — a named-header parser
// would silently let the second overwrite the first. Parsed by fixed
// column position instead: Employee, GP Budget, GP Floor %, GP Target,
// GP Target %, GP Stretch, GP Stretch %, Dream Target, Dream Target %.
// The four "…%" columns (gpFloorPct/gpTargetPct/gpStretchPct/dreamTargetPct)
// are the sheet's own pre-set margin percentages for each target level —
// not derived/computed here, read straight from their paired column.
export async function fetchAmTargets(accessToken) {
  const range = encodeURIComponent(AM_TABS.TARGETS)
  const data = await sheetsRequest(accessToken, `/values/${range}`, { cache: 'no-store' })
  const values = data.values || []
  if (values.length < 2) return []

  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => ({
      employee:      (row[0] || '').trim(),
      gpBudget:      parseNum(row[1]),
      gpFloorPct:    parseNum(row[2]),
      gpTarget:      parseNum(row[3]),
      gpTargetPct:   parseNum(row[4]),
      gpStretch:     parseNum(row[5]),
      gpStretchPct:  parseNum(row[6]),
      dreamTarget:   parseNum(row[7]),
      dreamTargetPct: parseNum(row[8]),
    }))
}

// Employee names only (see AM_TABS.MARGIN note above) — used purely to
// round out the AM dropdown roster with employees who have no Zoho/Targets
// rows yet, not as a source of any figures.
export async function fetchAmMarginEmployeeNames(accessToken) {
  const rows = await fetchNamedRows(accessToken, AM_TABS.MARGIN)
  const names = new Set()
  rows.forEach(row => {
    const name = (row['Employee'] || '').trim()
    if (name) names.add(name)
  })
  return names
}

// Full AM roster for the dropdown — union of every employee name appearing
// in Zoho, Targets, or Margin, so an AM added to the sheet later (even with
// no active data yet) shows up automatically instead of needing a code change.
export function getAmEmployeeRoster(zohoRows, targetsRows, marginNames) {
  const names = new Set()
  zohoRows.forEach(r => { if (r.employee) names.add(r.employee) })
  targetsRows.forEach(r => { if (r.employee) names.add(r.employee) })
  marginNames.forEach(n => names.add(n))
  return [...names].sort((a, b) => a.localeCompare(b))
}

// Union of clients across every selected employee — the Company Name
// filter's options depend on the current Account Manager selection.
export function getAmClientsForEmployees(zohoRows, employees) {
  const clients = new Set()
  zohoRows.forEach(r => { if (employees.includes(r.employee) && r.client) clients.add(r.client) })
  return [...clients].sort((a, b) => a.localeCompare(b))
}

// Weighted GP Margin % across a set of Zoho rows — sum(Gross Profit) /
// sum(Actual), NOT a naive average of each row's own GP Margin % (that
// would misweight months/clients differently) and NOT sum(Actual+Upsell)
// (the sheet's own per-row "GP Margin %" column divides by Actual+Upsell,
// but Upsell is a one-off add-on rather than recurring revenue, so folding
// it into the YTD margin base understates the recurring-business margin).
function weightedMarginPct(rows) {
  const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0)
  const revenue = rows.reduce((s, r) => s + r.actual, 0)
  return revenue > 0 ? (grossProfit / revenue) * 100 : 0
}

// Rows for any of the selected employees, optionally narrowed to one month
// and/or a set of clients — the shared filter predicate behind every figure
// on the tab that respects the Account Manager/Month/Company Name filters.
export function filterAmRows(zohoRows, employees, month, clients) {
  return zohoRows.filter(r =>
    employees.includes(r.employee) &&
    (!month || month === 'All' || r.month === month) &&
    (!clients || clients.length === 0 || clients.includes(r.client))
  )
}

// "Total Actual" / "Total Upsell" headline figures for the current
// Month/Company Name filter selection.
export function calcAmTotals(filteredRows) {
  return {
    totalActual: Math.round(filteredRows.reduce((s, r) => s + r.actual, 0) * 100) / 100,
    totalUpsell: Math.round(filteredRows.reduce((s, r) => s + r.upsell, 0) * 100) / 100,
  }
}

// "Margin (YTD)" — GP Margin % from January through the real current month
// (elapsedMonths), scoped to the Company Name filter but deliberately NOT
// the Month filter, since this is a fixed "how's my margin trending this
// year" reference figure rather than a per-month one.
export function calcAmMarginYtd(zohoRows, employees, clients, referenceDate = new Date()) {
  const elapsedMonths = Math.min(12, Math.max(1, referenceDate.getMonth() + 1))
  const monthsElapsedSet = new Set(MONTHS.slice(0, elapsedMonths))
  const rows = zohoRows.filter(r =>
    employees.includes(r.employee) &&
    monthsElapsedSet.has(r.month) &&
    (!clients || clients.length === 0 || clients.includes(r.client))
  )
  return Math.round(weightedMarginPct(rows) * 10) / 10
}

// Combined target figures across every selected Account Manager — SAR
// figures (gpBudget/gpTarget/gpStretch/dreamTarget) sum naturally across
// employees, but the "…%" columns are each employee's own pre-set margin
// percentage (not derived from the SAR figures), so there's no single
// correct sum for multiple employees — averaged instead, the closest
// single-number stand-in for "the selected AMs' target margins" that still
// degrades to the exact original per-employee value when only one AM is
// selected.
export function calcAmCombinedTarget(targetsRows, employees) {
  const rows = targetsRows.filter(t => employees.includes(t.employee))
  if (rows.length === 0) return null
  const sum = key => rows.reduce((s, r) => s + r[key], 0)
  const avg = key => Math.round((sum(key) / rows.length) * 10) / 10
  return {
    gpBudget:       sum('gpBudget'),
    gpFloorPct:     avg('gpFloorPct'),
    gpTarget:       sum('gpTarget'),
    gpTargetPct:    avg('gpTargetPct'),
    gpStretch:      sum('gpStretch'),
    gpStretchPct:   avg('gpStretchPct'),
    dreamTarget:    sum('dreamTarget'),
    dreamTargetPct: avg('dreamTargetPct'),
  }
}

// Progress-to-target ring value: (Total Actual ÷ target value) × 100, per
// the requested formula — compares revenue Actual against the SAR target
// figure directly (not Gross Profit), for each of the three target levels.
export function calcAmProgressPct(totalActual, targetValue) {
  if (!targetValue) return 0
  return Math.round((totalActual / targetValue) * 1000) / 10
}

// Chart 1 data — GP Target / GP Stretch / Dream Target side by side, each
// with its target SAR value, the same (filtered) Total Actual repeated for
// all three, and "Remaining to Target" = target − actual for that level.
export function calcAmTargetComparisonChart(target, totalActual) {
  const levels = [
    { category: 'GP Target', targetValue: target?.gpTarget ?? 0 },
    { category: 'GP Stretch', targetValue: target?.gpStretch ?? 0 },
    { category: 'Dream Target', targetValue: target?.dreamTarget ?? 0 },
  ]
  return levels.map(l => ({
    category: l.category,
    targetValue: l.targetValue,
    actual: totalActual,
    remaining: Math.round((l.targetValue - totalActual) * 100) / 100,
  }))
}

// Chart 2 data — monthly Total Upsell / Total Actual / GP Margin % for one
// employee, in calendar order, optionally narrowed to one client via the
// Company Name filter (the Month filter doesn't apply here — this chart IS
// the month-by-month breakdown).
export function calcAmMonthlyTrend(zohoRows, employees, clients) {
  const byMonth = Object.fromEntries(MONTHS.map(m => [m, []]))
  zohoRows.forEach(row => {
    if (!employees.includes(row.employee)) return
    if (clients && clients.length > 0 && !clients.includes(row.client)) return
    if (!byMonth[row.month]) return
    byMonth[row.month].push(row)
  })
  return MONTHS.map(m => {
    const rows = byMonth[m]
    return {
      month: m,
      upsell: Math.round(rows.reduce((s, r) => s + r.upsell, 0) * 100) / 100,
      actual: Math.round(rows.reduce((s, r) => s + r.actual, 0) * 100) / 100,
      gpMarginPct: Math.round(weightedMarginPct(rows) * 10) / 10,
    }
  })
}
