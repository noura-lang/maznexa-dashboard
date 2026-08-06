import { ACCESS_SHEET_ID } from '../firebase'

// Employees/Permissions tabs of the separate "Access Sheet" — unlike the
// other sheets in this app (sheetsApi.js), this one holds sensitive data
// (employee emails, admin flags) and is NOT publicly shared. Every request
// here authenticates as the signed-in user via their own Google OAuth
// access token (obtained through Firebase's GoogleAuthProvider with the
// `spreadsheets` scope — see src/firebase.js), never the public API key.
// Google still enforces the real Drive-level sharing permission on the
// file itself: a token alone doesn't grant access, the account behind it
// must actually have been shared Viewer/Editor access to this sheet.
export const ACCESS_TABS = {
  EMPLOYEES:   'Employees',
  PERMISSIONS: 'Permissions',
}

// Exact column headers expected in each tab — the Access Sheet must be set
// up with these headers verbatim (see setup notes). Order doesn't matter;
// lookup below is by header name, not position.
export const EMPLOYEES_COLUMNS = ['Email', 'Name', 'Team', 'Role']
export const PERMISSION_COLUMNS = [
  'Email', 'Weekly Report', 'Billable View', 'Hours Report', 'Utilization',
  'Task Details', 'Tags', 'Account Managers Performance', 'Cost Analysis', 'Business Development',
  'Data Scope', 'Financial Access', 'Export', 'Admin',
]

async function sheetsRequest(accessToken, path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err?.error?.message || `Access Sheet API error: HTTP ${res.status}`
    )
  }
  return res.json()
}

// Column index (0-based) -> A1 letter, e.g. 0 -> 'A', 26 -> 'AA'.
function colLetter(index) {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

// Reads one tab as an array of row objects keyed by its header row, same
// shape as sheetsApi.js's fetchRange — plus the 1-based sheet row number
// on each object (`_row`) so writes can target the exact row later.
export async function fetchAccessRows(accessToken, tabName) {
  const range = encodeURIComponent(tabName)
  const data = await sheetsRequest(accessToken, `/values/${range}`, { cache: 'no-store' })
  const values = data.values || []
  if (values.length < 2) return []

  const [rawHeaders, ...rows] = values
  const headers = rawHeaders.map(h => h.trim())

  // Compute each row's real sheet row number from its position BEFORE
  // filtering blank rows out — filtering first and indexing the result
  // would silently misalign every row after the first gap, pointing writes
  // (updateAccessRow) at the wrong employee's row.
  return rows
    .map((row, i) => ({ row, sheetRow: i + 2 })) // +1 for header row, +1 to convert 0-based to 1-based
    .filter(({ row }) => row.some(cell => cell !== ''))
    .map(({ row, sheetRow }) => ({
      _row: sheetRow,
      ...Object.fromEntries(headers.map((h, j) => [h, (row[j] ?? '').trim()])),
    }))
}

export const fetchEmployees   = accessToken => fetchAccessRows(accessToken, ACCESS_TABS.EMPLOYEES)
export const fetchPermissions = accessToken => fetchAccessRows(accessToken, ACCESS_TABS.PERMISSIONS)

// Overwrites specific cells in one row via a single values.update call
// (valueInputOption=RAW — values are written exactly as given, no Sheets
// formula/date parsing). `rowValues` is an object of {header: value};
// `columns` fixes the column order written (must match the sheet's actual
// column order for the target range).
export async function updateAccessRow(accessToken, tabName, rowNumber, columns, rowValues) {
  const lastCol = colLetter(columns.length - 1)
  const range = encodeURIComponent(`${tabName}!A${rowNumber}:${lastCol}${rowNumber}`)
  const values = [columns.map(col => String(rowValues[col] ?? ''))]

  await sheetsRequest(accessToken, `/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: `${tabName}!A${rowNumber}:${lastCol}${rowNumber}`, values }),
  })
}

const TRUTHY = new Set(['true', 'yes', '1'])
export const parseBool = value => TRUTHY.has(String(value ?? '').trim().toLowerCase())
export const boolToCell = value => (value ? 'TRUE' : 'FALSE')

export const DATA_SCOPES = {
  MY_DATA: 'My Data Only',
  MY_TEAM: 'My Team Only',
  ALL:     'All Employees',
}

// Permissions a user gets when their email has no row in the Permissions
// tab yet (Employee record exists, but the admin hasn't assigned access) —
// everything denied, most restrictive Data Scope, until an admin fills
// their row in via the Admin Panel.
export const DEFAULT_DENIED_PERMISSIONS = {
  weeklyReport:    false,
  billableView:    false,
  hoursReport:     false,
  utilization:     false,
  taskDetails:     false,
  tags:            false,
  amPerformance:   false,
  costAnalysis:    false,
  bizDev:          false,
  dataScope:       DATA_SCOPES.MY_DATA,
  financialAccess: false,
  export:          false,
  admin:           false,
}

export function parsePermissionsRow(row) {
  if (!row) return DEFAULT_DENIED_PERMISSIONS
  return {
    weeklyReport:    parseBool(row['Weekly Report']),
    billableView:    parseBool(row['Billable View']),
    hoursReport:     parseBool(row['Hours Report']),
    utilization:     parseBool(row['Utilization']),
    taskDetails:     parseBool(row['Task Details']),
    tags:            parseBool(row['Tags']),
    amPerformance:   parseBool(row['Account Managers Performance']),
    costAnalysis:    parseBool(row['Cost Analysis']),
    bizDev:          parseBool(row['Business Development']),
    dataScope:       row['Data Scope'] || DATA_SCOPES.MY_DATA,
    financialAccess: parseBool(row['Financial Access']),
    export:          parseBool(row['Export']),
    admin:           parseBool(row['Admin']),
  }
}

// Inverse of parsePermissionsRow — builds the {header: value} object
// updateAccessRow expects, for the Admin Panel's save action.
export function permissionsToRow(email, permissions) {
  return {
    Email:             email,
    'Weekly Report':   boolToCell(permissions.weeklyReport),
    'Billable View':   boolToCell(permissions.billableView),
    'Hours Report':    boolToCell(permissions.hoursReport),
    'Utilization':     boolToCell(permissions.utilization),
    'Task Details':    boolToCell(permissions.taskDetails),
    'Tags':            boolToCell(permissions.tags),
    'Account Managers Performance': boolToCell(permissions.amPerformance),
    'Cost Analysis':   boolToCell(permissions.costAnalysis),
    'Business Development': boolToCell(permissions.bizDev),
    'Data Scope':      permissions.dataScope,
    'Financial Access': boolToCell(permissions.financialAccess),
    'Export':          boolToCell(permissions.export),
    'Admin':           boolToCell(permissions.admin),
  }
}

// Appends a brand-new row to the Permissions tab for an employee who has
// none yet (Admin Panel — assigning access for the first time).
export async function appendPermissionsRow(accessToken, email, permissions) {
  const range = encodeURIComponent(`${ACCESS_TABS.PERMISSIONS}!A1`)
  const rowValues = permissionsToRow(email, permissions)
  const values = [PERMISSION_COLUMNS.map(col => String(rowValues[col] ?? ''))]

  await sheetsRequest(
    accessToken,
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  )
}
