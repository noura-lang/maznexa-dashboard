import { applyCapacityTestOverrides } from './testOverrides'

const API_KEY       = import.meta.env.VITE_GOOGLE_API_KEY
const MAIN_SHEET_ID = import.meta.env.VITE_MAIN_SHEET_ID  || '1JpgRXx1PFe-_t4LvnAmJ3XkIM_rrFAYJDPTYv-upSDo'
const TASKS_SHEET_ID = import.meta.env.VITE_TASKS_SHEET_ID || '1FJk53DZqI9gp2qdcJnvY3qH0f3MduzrgoKWlx-4m4Mk'
const TASKS_TAB     = import.meta.env.VITE_TASKS_SHEET_TAB || 'Raw Tasks'

// Tab names — must match exactly what is written in the Google Sheet
export const SHEET_TABS = {
  RAW_TIME_LOG:    'Raw Time Log',
  CAPACITY_2026:   'Capacity',
  CAPACITY_2025:   'Capacity 2025',
  TASKS:           TASKS_TAB,
}

async function fetchRange(spreadsheetId, sheetName) {
  if (!API_KEY) {
    throw new Error(
      'Google API key missing. Add VITE_GOOGLE_API_KEY to your .env file.'
    )
  }

  const range = encodeURIComponent(`${sheetName}`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${API_KEY}`

  // Google's API rejects unknown query params (e.g. a `_ts` cache-buster),
  // so cache-busting happens purely on the fetch call instead: `no-store`
  // tells the browser to skip its HTTP cache entirely, without touching the
  // URL sent to Google.
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message || `Google Sheets API error: HTTP ${res.status}`
    )
  }

  const { values = [] } = await res.json()
  if (values.length < 2) return []

  const [rawHeaders, ...rows] = values
  const headers = rawHeaders.map(h => h.trim())

  return rows
    .filter(row => row.some(cell => cell !== ''))
    .map(row =>
      Object.fromEntries(headers.map((h, i) => [h, (row[i] ?? '').trim()]))
    )
}

// Sheets tag deactivated/removed employees with a trailing Arabic annotation
// (e.g. "Misbah Shameer (محذوف)") in the Name/WHO/Assignee columns. Left in
// place, this breaks employee-name joins across sheets (Raw Time Log's WHO
// vs Capacity's Name) since the two sides no longer match exactly.
const ARABIC_PAREN_SUFFIX = /\s*\([؀-ۿ\s]+\)\s*$/

function cleanNameField(rows, field) {
  return rows.map(row => {
    if (!row[field]) return row
    return { ...row, [field]: row[field].replace(ARABIC_PAREN_SUFFIX, '').trim() }
  })
}

function cleanMultiNameField(rows, field) {
  return rows.map(row => {
    if (!row[field]) return row
    const cleaned = row[field]
      .split(',')
      .map(name => name.replace(ARABIC_PAREN_SUFFIX, '').trim())
      .join(', ')
    return { ...row, [field]: cleaned }
  })
}

export const fetchRawTimeLog   = () => fetchRange(MAIN_SHEET_ID, SHEET_TABS.RAW_TIME_LOG)
  .then(rows => cleanNameField(rows, 'WHO'))

// ⚠️ testOverrides.js applies a TEMPORARY test-only display correction —
// see that file for details. Remove this import + call once verified.
export const fetchCapacity2026 = () => fetchRange(MAIN_SHEET_ID, SHEET_TABS.CAPACITY_2026)
  .then(rows => cleanNameField(rows, 'Name'))
  .then(rows => applyCapacityTestOverrides(rows))

export const fetchCapacity2025 = () => fetchRange(MAIN_SHEET_ID, SHEET_TABS.CAPACITY_2025)
  .then(rows => cleanNameField(rows, 'Name'))

export const fetchTasks        = () => fetchRange(TASKS_SHEET_ID, SHEET_TABS.TASKS)
  .then(rows => cleanNameField(rows, 'CREATED BY'))
  .then(rows => cleanNameField(rows, 'COMPLETED BY'))
  .then(rows => cleanMultiNameField(rows, 'ASSIGNEE(S)'))
