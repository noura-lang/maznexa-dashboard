// ⚠️ تعديل مؤقت للاختبار - يُحذف بعد التأكد من الأرقام وتطبيقها على Google Apps Script مباشرة
//
// يعيد توزيع ساعات "Available (hrs)" و/أو "Logged (hrs)" اليومية لموظفات
// محددات على مستوى الشهر فقط داخل الداشبورد (لا يلمس Google Sheets ولا الـ
// API). يُستخدم للتحقق من رقم شهري صحيح قبل تعديل السكريبت الأساسي في Apps
// Script.

const NADA_MONTHLY_OVERRIDE = {
  '2026-01': 138.00,
  '2026-02': 64.23,
  '2026-03': 84.00,
}

const SARA_MONTHLY_OVERRIDE = {
  '2026-04': 155.00,
}

const SHAQRAN_MONTHLY_OVERRIDE = {
  '2026-01': { hours: 0, capacity: 0 },
}

// Her literal Name field in the Capacity sheet is "MSHAER ." (trailing period).
// The sheet currently reads Hours=56.47 / Capacity=160.00 for Jan 2026; this
// restores the display to the verified-correct Hours=64.22 / Capacity=72.00.
const MSHAER_MONTHLY_OVERRIDE = {
  '2026-01': { hours: 64.22, capacity: 72.00 },
}

// Employees whose Utilization must always read exactly 100% for specific
// months. Unlike EMPLOYEE_MONTHLY_OVERRIDES (which scales toward a target
// monthly sum), this forces every day's "Logged (hrs)" to equal that same
// day's "Available (hrs)" — Capacity is left completely untouched, and
// because Hours is set equal to Capacity on every single day, the monthly
// total is exactly 100%, not just close to it (no rounding residual to
// correct for).
const ALWAYS_100_OVERRIDE = {
  'mohammed al youssef': ['2026-01', '2026-02'],
  'ahmad almazro': ['2026-01', '2026-02'],
}

// A month's override value is either:
//   - a plain number  -> target monthly "Available (hrs)" sum only
//   - { capacity, hours } -> target monthly sums for both "Available (hrs)"
//     and "Logged (hrs)"; either key can be omitted to leave that field alone
//
// `name` must match a row's Name field EXACTLY (case-insensitive, trimmed) —
// this is not a team-level or fuzzy match, so employees on the same team
// (e.g. other "designers") are never touched by another employee's entry.
const EMPLOYEE_MONTHLY_OVERRIDES = [
  { name: 'nada alarjani', monthlyOverride: NADA_MONTHLY_OVERRIDE },
  { name: 'sara ali', monthlyOverride: SARA_MONTHLY_OVERRIDE },
  { name: 'menna shaqran', monthlyOverride: SHAQRAN_MONTHLY_OVERRIDE },
  { name: 'mshaer .', monthlyOverride: MSHAER_MONTHLY_OVERRIDE },
]

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Scales `field` on the given employee's rows within each target month so the
// monthly sum matches `targetsByMonth[month]` exactly, preserving the
// existing day-to-day shape. Per-row rounding to 2 decimals can drift the sum
// slightly off target, so the leftover residual is nudged onto the last row
// of the month.
function scaleFieldToMonthlyTargets(rows, name, field, targetsByMonth) {
  const result = new Map()
  const months = Object.keys(targetsByMonth)
  if (months.length === 0) return result

  const rowsByMonth = {}
  rows.forEach(row => {
    if ((row.Name || '').trim().toLowerCase() !== name) return
    const month = (row.Date || '').slice(0, 7)
    if (!(month in targetsByMonth)) return
    if (!rowsByMonth[month]) rowsByMonth[month] = []
    rowsByMonth[month].push(row)
  })

  for (const [month, monthRows] of Object.entries(rowsByMonth)) {
    const currentSum = monthRows.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0)
    if (currentSum <= 0) continue

    const targetSum = targetsByMonth[month]
    const ratio = targetSum / currentSum

    let roundedSum = 0
    monthRows.forEach(row => {
      const oldValue = parseFloat(row[field]) || 0
      const newValue = round2(oldValue * ratio)
      result.set(row, newValue)
      roundedSum = round2(roundedSum + newValue)
    })

    const residual = round2(targetSum - roundedSum)
    if (residual !== 0) {
      const lastRow = monthRows[monthRows.length - 1]
      result.set(lastRow, round2(result.get(lastRow) + residual))
    }
  }

  return result
}

// Applies EMPLOYEE_MONTHLY_OVERRIDES to daily Capacity rows.
export function applyCapacityTestOverrides(rows) {
  const newAvailableByRow = new Map()
  const newLoggedByRow = new Map()

  for (const { name, monthlyOverride } of EMPLOYEE_MONTHLY_OVERRIDES) {
    const capacityTargets = {}
    const hoursTargets = {}
    for (const [month, spec] of Object.entries(monthlyOverride)) {
      if (typeof spec === 'number') {
        capacityTargets[month] = spec
      } else {
        if (spec.capacity != null) capacityTargets[month] = spec.capacity
        if (spec.hours != null) hoursTargets[month] = spec.hours
      }
    }

    const availMap = scaleFieldToMonthlyTargets(rows, name, 'Available (hrs)', capacityTargets)
    const loggedMap = scaleFieldToMonthlyTargets(rows, name, 'Logged (hrs)', hoursTargets)
    availMap.forEach((v, row) => newAvailableByRow.set(row, v))
    loggedMap.forEach((v, row) => newLoggedByRow.set(row, v))
  }

  for (const [name, months] of Object.entries(ALWAYS_100_OVERRIDE)) {
    rows.forEach(row => {
      if ((row.Name || '').trim().toLowerCase() !== name) return
      const month = (row.Date || '').slice(0, 7)
      if (!months.includes(month)) return
      newLoggedByRow.set(row, round2(parseFloat(row['Available (hrs)']) || 0))
    })
  }

  return rows.map(row => {
    const hasNewAvailable = newAvailableByRow.has(row)
    const hasNewLogged = newLoggedByRow.has(row)
    if (!hasNewAvailable && !hasNewLogged) return row

    const newAvailable = hasNewAvailable
      ? newAvailableByRow.get(row)
      : (parseFloat(row['Available (hrs)']) || 0)
    const newLogged = hasNewLogged
      ? newLoggedByRow.get(row)
      : (parseFloat(row['Logged (hrs)']) || 0)
    const utilization = newAvailable > 0 ? round2((newLogged / newAvailable) * 100) : 0

    return {
      ...row,
      ...(hasNewAvailable ? { 'Available (hrs)': newAvailable.toFixed(2) } : {}),
      ...(hasNewLogged ? { 'Logged (hrs)': newLogged.toFixed(2) } : {}),
      'Utilization %': `${utilization.toFixed(2)}%`,
    }
  })
}
