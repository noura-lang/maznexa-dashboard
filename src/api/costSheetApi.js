import { COST_SHEET_ID } from '../firebase'
import { round2, calcGrowthPct } from './transformData'

// Cost sheet — holds per-employee hourly cost rates (financially sensitive:
// what the agency pays for each hour of work). Like the AM Sheet, this is
// NOT read via the public API key: every request here authenticates as the
// signed-in user's own Google OAuth access token (see src/firebase.js /
// AuthContext), so the data is only reachable by accounts Google has
// actually granted Viewer access to on this file in Drive — not just gated
// by the in-app Permissions flag. Never widen this to a public API-key
// fetch. Hours themselves come from the Main Sheet's Raw Time Log (already
// public — see sheetsApi.js/useSheetData.js), joined against these rates
// client-side in calcEmployeeCostRows below.
const COST_TABS = { COST: 'Cost' }

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
const MONTH_NUM_TO_NAME = {
  '01': 'January', '02': 'February', '03': 'March', '04': 'April',
  '05': 'May', '06': 'June', '07': 'July', '08': 'August',
  '09': 'September', '10': 'October', '11': 'November', '12': 'December',
}

// Cost tab's Date column reads "Jan 2026" / "Jun 2026" — but sheet
// inspection found it isn't consistent about abbreviated vs full month
// names ("Jun 2026" in Cost, "June 2026" in the sheet's own Hours tab), so
// this accepts both. Normalizes to the same "YYYY-MM" key Raw Time Log's
// MONTH column already uses, so the two sheets join directly.
export function parseCostMonthKey(dateStr) {
  const match = (dateStr || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!match) return ''
  const num = MONTH_NAME_TO_NUM[match[1].toLowerCase()]
  return num ? `${match[2]}-${num}` : ''
}

export function formatMonthKey(monthKey) {
  const [year, m] = (monthKey || '').split('-')
  return year && m ? `${MONTH_NUM_TO_NAME[m] || m} ${year}` : monthKey || ''
}

async function sheetsRequest(accessToken, path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${COST_SHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message || `Cost Sheet API error: HTTP ${res.status}`
    )
  }
  return res.json()
}

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

// Raw hourly-cost rates, one row per Employee × Month. `hasRate` is false
// only when the cell was genuinely blank (found once during inspection —
// Shrouq Alofi, Jan 2026) — distinct from a legitimately-entered 0 rate.
export async function fetchCostRates(accessToken) {
  const rows = await fetchNamedRows(accessToken, COST_TABS.COST)
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

// Map key `${monthKey}|${employee.toLowerCase()}` -> rate row. Case-
// insensitive on the employee name — sheet inspection found one mismatch
// ("Menna Shaqran" here vs "menna shaqran" in Raw Time Log's WHO column).
export function buildCostRateMap(costRates) {
  const map = new Map()
  costRates.forEach(r => map.set(`${r.monthKey}|${r.employee.toLowerCase()}`, r))
  return map
}

export function getCostMonthOptions(costRates) {
  return [...new Set(costRates.map(r => r.monthKey))].filter(Boolean).sort()
}

// The join every figure on the Cost Analysis tab is built from: each Raw
// Time Log row's hours × that employee's rate for that same month. Rows
// whose employee has no rate recorded for that month (21 found during
// inspection — hires/leavers the Cost sheet hasn't caught up with) get
// hasRate: false and null costs — callers must render these as "No rate
// recorded", never silently as SAR 0.
export function calcEmployeeCostRows(rawTimeLogRows, costRateMap) {
  return rawTimeLogRows.map(row => {
    const hours = parseNum(row.HOURS)
    const monthKey = row.MONTH || ''
    const employee = row.WHO || ''
    const rateRow = costRateMap.get(`${monthKey}|${employee.toLowerCase()}`)
    const hasRate = !!rateRow?.hasRate
    const actualCost = hasRate ? round2(hours * rateRow.rate) : null
    return {
      employee,
      team: row.TEAM || '',
      client: (row.CLIENT || '').trim(),
      project: (row.PROJECT || '').trim(),
      monthKey,
      hours,
      hasRate,
      actualCost,
      bufferedCost: hasRate ? round2(actualCost * 1.2) : null,
    }
  })
}

export function filterCostRows(rows, month, clients, employees) {
  return rows.filter(r =>
    (!month || month === 'All' || r.monthKey === month) &&
    (!clients || clients.length === 0 || clients.includes(r.client)) &&
    (!employees || employees.length === 0 || employees.includes(r.employee))
  )
}

export function getCostClientOptions(rows) {
  return [...new Set(rows.map(r => r.client).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function getCostEmployeeOptions(rows) {
  return [...new Set(rows.map(r => r.employee).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

// Headline totals for the current filter selection. `knownHours`/`hours`
// distinguish "no cost incurred" from "cost unknown" — hasUnknown flags
// that the totals understate true cost because some hours have no rate.
export function calcCostTotals(rows) {
  let actualCost = 0, bufferedCost = 0, hours = 0, unknownHours = 0
  const unknownEmployees = new Set()
  rows.forEach(r => {
    hours += r.hours
    if (r.hasRate) {
      actualCost += r.actualCost
      bufferedCost += r.bufferedCost
    } else {
      unknownHours += r.hours
      if (r.employee) unknownEmployees.add(r.employee)
    }
  })
  return {
    actualCost: round2(actualCost),
    bufferedCost: round2(bufferedCost),
    bufferAmount: round2(bufferedCost - actualCost),
    hours: round2(hours),
    unknownHours: round2(unknownHours),
    hasUnknown: unknownHours > 0,
    unknownEmployeeCount: unknownEmployees.size,
  }
}

// Shared grouping reducer — keyFields are the row properties that define a
// group (e.g. ['client'], or ['employee', 'monthKey'] for a monthly cut).
// hasNoRate: not a single hour in this group has a known rate (render "No
// rate recorded"). isPartialRate: some but not all hours are covered (the
// shown cost is real but understated) — kept distinct so callers can flag
// each case differently instead of collapsing them into one warning.
function groupCostRows(rows, keyFields) {
  const map = new Map()
  rows.forEach(r => {
    const key = keyFields.map(f => r[f]).join('|')
    if (!map.has(key)) {
      map.set(key, {
        ...Object.fromEntries(keyFields.map(f => [f, r[f]])),
        hours: 0, knownHours: 0, actualCost: 0, bufferedCost: 0,
      })
    }
    const g = map.get(key)
    g.hours += r.hours
    if (r.hasRate) {
      g.knownHours += r.hours
      g.actualCost += r.actualCost
      g.bufferedCost += r.bufferedCost
    }
  })
  return [...map.values()].map(g => ({
    ...g,
    hours: round2(g.hours),
    knownHours: round2(g.knownHours),
    actualCost: round2(g.actualCost),
    bufferedCost: round2(g.bufferedCost),
    hasNoRate: g.knownHours === 0 && g.hours > 0,
    isPartialRate: g.knownHours > 0 && g.knownHours < g.hours,
  }))
}

export function calcCostByClient(rows) {
  return groupCostRows(rows, ['client']).sort((a, b) => b.actualCost - a.actualCost)
}

export function calcCostByEmployeeMonthly(rows) {
  return groupCostRows(rows, ['employee', 'monthKey'])
    .sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : b.actualCost - a.actualCost))
}

export function calcCostByProjectMonthly(rows) {
  return groupCostRows(rows, ['project', 'client', 'monthKey'])
    .sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : b.actualCost - a.actualCost))
}

// Drill-down breakdowns — same grouping reducer, one level deeper than the
// section it's opened from (e.g. a client's row → its employees).
export function calcCostByEmployee(rows) {
  return groupCostRows(rows, ['employee']).sort((a, b) => b.actualCost - a.actualCost)
}
export function calcCostByProject(rows) {
  return groupCostRows(rows, ['project', 'client']).sort((a, b) => b.actualCost - a.actualCost)
}

// Monthly trend — total cost per month (ignoring the Month filter itself,
// same convention as the AM tab's monthly chart: this chart IS the
// month-by-month view), with a period-over-period growth % on Buffered
// Cost, mirroring calcGrowthPct's use everywhere else in the app.
export function calcMonthlyCostTrend(rows) {
  const months = groupCostRows(rows, ['monthKey'])
    .filter(m => m.monthKey)
    .sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1))
  return months.map((m, i) => ({
    ...m,
    label: formatMonthKey(m.monthKey),
    growthPct: i > 0 ? calcGrowthPct(months[i - 1].bufferedCost, m.bufferedCost) : null,
  }))
}
