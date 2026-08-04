import {
  parseISO, isWithinInterval, startOfDay, endOfDay, getWeek, getYear, differenceInCalendarDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addWeeks, isAfter, format,
} from 'date-fns'
import { SEQUENTIAL_STOPS } from '../utils/chartColors'

// ─── Filtering ──────────────────────────────────────────────────────────────

export function filterRows(rows, { startDate, endDate, selectedTeams, selectedEmployees, selectedClients }) {
  const start = startDate ? startOfDay(parseISO(startDate)) : null
  const end   = endDate   ? endOfDay(parseISO(endDate))     : null

  return rows.filter(row => {
    if (start && end) {
      const rowDate = parseISO(row.DATE)
      if (!isWithinInterval(rowDate, { start, end })) return false
    }
    if (selectedTeams.length > 0 && !selectedTeams.includes(row.TEAM)) return false
    if (selectedEmployees.length > 0 && !selectedEmployees.includes(row.WHO)) return false
    if (selectedClients?.length > 0 && !selectedClients.includes(row.CLIENT)) return false
    return true
  })
}

export function filterCapacityRows(rows, { startDate, endDate, selectedTeams, selectedEmployees }) {
  const start = startDate ? startOfDay(parseISO(startDate)) : null
  const end   = endDate   ? endOfDay(parseISO(endDate))     : null

  return rows.filter(row => {
    if (start && end) {
      const rowDate = parseISO(row.Date)
      if (!isWithinInterval(rowDate, { start, end })) return false
    }
    if (selectedTeams.length > 0 && !selectedTeams.includes(row.Team)) return false
    if (selectedEmployees.length > 0 && !selectedEmployees.includes(row.Name)) return false
    return true
  })
}

// "Capacity 2025" rows are stored at monthly granularity (Date = "YYYY-MM"),
// while "Capacity" (current year) rows are daily (Date = "YYYY-MM-DD") — a
// plain string-prefix match works for both without needing to parse dates.
export function filterCapacityByMonth(rows, year, month) {
  if (!month) return rows
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return rows.filter(r => (r.Date || '').startsWith(prefix))
}

// Cumulative "Jan 1 through the given month" slice of a single year's rows —
// lets Year/Quarter/Month comparison charts track the Comparison tab's Month
// filter (e.g. Month=Jun -> only Jan-Jun counts) instead of always using the
// full year. "YYYY-MM" string comparison works for both monthly (2025) and
// daily (2026) Date formats since both start with "YYYY-MM".
//
// The "Capacity" (2026) sheet also carries several trailing months of the
// prior year for continuity (e.g. 2025-07..2025-12 rows sitting alongside
// 2026 rows) — without a lower bound, "2025-12" <= "2026-07" is true, so a
// year=2026 YTD query would silently pull in all of H2 2025 too. Both bounds
// are required to keep a year's YTD slice scoped to that year alone.
export function filterCapacityYTD(rows, year, throughMonth) {
  if (!throughMonth) return rows
  const minPrefix = `${year}-01`
  const maxPrefix = `${year}-${String(throughMonth).padStart(2, '0')}`
  return rows.filter(r => {
    const ym = (r.Date || '').slice(0, 7)
    return ym >= minPrefix && ym <= maxPrefix
  })
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

export function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const k = row[key] || 'Unknown'
    if (!acc[k]) acc[k] = []
    acc[k].push(row)
    return acc
  }, {})
}

export function sumHours(rows) {
  return rows.reduce((s, r) => s + (parseFloat(r.HOURS) || 0), 0)
}

export function round2(n) {
  return Math.round(n * 100) / 100
}

// All Utilization/Growth/share percentages across the dashboard are shown as
// whole numbers (e.g. 85%, not 85.13%) — round at the source so every chart,
// table, and tooltip that consumes these fields stays consistent.
export function roundPct(n) {
  return Math.round(n)
}

// ─── Unique value extractors (for filter dropdowns) ──────────────────────────

export function getUniqueTeams(rows) {
  return [...new Set(rows.map(r => r.TEAM).filter(Boolean))].sort()
}

export function getUniqueEmployees(rows, selectedTeams = []) {
  return [
    ...new Set(
      rows
        .filter(r => selectedTeams.length === 0 || selectedTeams.includes(r.TEAM))
        .map(r => r.WHO)
        .filter(Boolean)
    ),
  ].sort()
}

// Capacity-sheet variants (Team/Name columns, not TEAM/WHO)
export function getUniqueCapacityTeams(rows) {
  return [...new Set(rows.map(r => r.Team).filter(Boolean))].sort()
}

export function getUniqueCapacityEmployees(rows, selectedTeams = []) {
  return [
    ...new Set(
      rows
        .filter(r => selectedTeams.length === 0 || selectedTeams.includes(r.Team))
        .map(r => r.Name)
        .filter(Boolean)
    ),
  ].sort()
}

export function getUniqueClients(rows) {
  return [...new Set(rows.map(r => r.CLIENT).filter(Boolean))].sort()
}

export function getUniqueProjects(rows) {
  return [...new Set(rows.map(r => r.PROJECT).filter(Boolean))].sort()
}

// ─── Weekly Report aggregations ──────────────────────────────────────────────

// Single source of truth for every Utilization % computed on the Weekly
// Report tab: Utilization % = (sum of Logged hrs) ÷ (sum of Available hrs) ×
// 100, both read exclusively from the Capacity sheet. Every chart/widget
// below funnels its logged/available pair through this one function instead
// of inlining the ternary — so there is exactly one place this formula
// lives for this tab. (Other tabs compute their own utilization inline and
// are intentionally left untouched — this function is not shared with them,
// even where their formula happens to look identical.)
export function calculateUtilization(logged, available) {
  return available > 0 ? roundPct((logged / available) * 100) : 0
}

// Both totalLogged and totalCapacity read exclusively from the Capacity
// sheet (not Raw Time Log) — this is what lets "Overall Utilization" always
// reconcile exactly with any period slice of the Weekly/Monthly Trend charts
// below, since they all sum the same Logged (hrs)/Available (hrs) columns.
export function calcOverallKPIs(capacityRows) {
  const totalLogged   = round2(capacityRows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
  const totalCapacity = round2(capacityRows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
  const utilization = calculateUtilization(totalLogged, totalCapacity)

  return { totalLogged, totalCapacity, utilization }
}

// Weekly Report's team-level utilization (Top N / Bottom N / full "Utilization
// by Team" charts) is computed directly from the Capacity sheet's own Logged
// (hrs) and Available (hrs) columns — grouped by Team — rather than deriving
// "logged" from a separate Raw Time Log sum, so it stays reconciled with the
// per-employee capacity rows the sheet already aggregates per day.
export function calcUtilizationByTeam(capacityRows) {
  const capacityByTeam = groupBy(capacityRows, 'Team')

  return Object.keys(capacityByTeam).map(team => {
    const rows     = capacityByTeam[team]
    const logged   = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
    const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
    const utilPct  = calculateUtilization(logged, capacity)
    return { team, logged, capacity, utilPct }
  }).filter(t => !(t.logged === 0 && t.capacity === 0))
    .sort((a, b) => b.utilPct - a.utilPct)
}

// Both logged and capacity read exclusively from the Capacity sheet, grouped
// by Name — same single-source rule as calcOverallKPIs/calcUtilizationByTeam
// above (previously this merged in a separate Raw Time Log sum for "logged",
// which could disagree with the Capacity sheet's own Logged (hrs) column).
export function calcUtilizationByEmployee(capacityRows) {
  const capacityByEmp = groupBy(capacityRows, 'Name')

  return Object.keys(capacityByEmp).map(name => {
    const rows     = capacityByEmp[name]
    const logged   = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
    const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
    const utilPct  = calculateUtilization(logged, capacity)
    const team     = rows[0]?.Team || ''
    return { name, team, logged, capacity, utilPct }
  }).filter(e => !(e.logged === 0 && e.capacity === 0))
    .sort((a, b) => b.utilPct - a.utilPct)
}

// Distinct "YYYY-MM" months present in a Capacity-sheet-shaped rows array
// (Date column), newest first — powers the Weekly Trend chart's independent
// Month dropdown.
export function getAvailableCapacityMonths(capacityRows) {
  return [...new Set(capacityRows.map(r => (r.Date || '').slice(0, 7)).filter(Boolean))]
    .sort()
    .reverse()
}

// Company-wide (all employees, all teams) weekly utilization trend for a
// single calendar month — entirely independent of the tab's date/team/
// employee filters, per its own Month dropdown. Weeks run Sunday-Saturday;
// a week straddling the month boundary is clipped to just the days that
// actually fall inside the selected month (a standard partial week), so the
// hours/capacity summed for "Week 1" or the last week never leak into the
// neighboring month.
export function calcWeeklyUtilizationTrend(capacityRows, year, month) {
  const monthStart = startOfMonth(new Date(year, month - 1, 1))
  const monthEnd    = endOfMonth(monthStart)

  const weekRanges = []
  let cursor = startOfWeek(monthStart, { weekStartsOn: 0 })
  while (!isAfter(cursor, monthEnd)) {
    const weekEnd     = endOfWeek(cursor, { weekStartsOn: 0 })
    const rangeStart  = cursor    < monthStart ? monthStart : cursor
    const rangeEnd    = weekEnd   > monthEnd   ? monthEnd   : weekEnd
    weekRanges.push({ rangeStart, rangeEnd })
    cursor = addWeeks(cursor, 1)
  }

  return weekRanges.map(({ rangeStart, rangeEnd }, i) => {
    const rows = capacityRows.filter(r => {
      if (!r.Date) return false
      const d = parseISO(r.Date)
      return d >= rangeStart && d <= rangeEnd
    })
    const logged   = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
    const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
    const utilPct  = calculateUtilization(logged, capacity)
    // rangeStart/rangeEnd (as "YYYY-MM-DD" strings, matching the Date column
    // format) are carried along so a click on this week's bar/point can
    // re-derive the exact same row subset for a drill-down, without
    // duplicating the week-boundary math above.
    return {
      week: `Week ${i + 1}`,
      rangeStart: format(rangeStart, 'yyyy-MM-dd'),
      rangeEnd: format(rangeEnd, 'yyyy-MM-dd'),
      logged, capacity, utilPct,
    }
  })
}

// ─── Year-to-Date Utilization widget (Weekly Report) ──────────────────────────
// Company-wide (all employees, all teams) — Jan 1 of the cutoff date's year
// through the cutoff date itself. `capacityRows` is expected to be the raw
// Capacity sheet rows (already passed through applyCapacityTestOverrides at
// fetch time in sheetsApi.js), so the Nada Alarjani / Sara Ali / menna
// shaqran corrections are already baked into every row's Logged/Available
// figures by the time they reach here — no separate override step needed.

function sumLoggedCapacity(rows) {
  const logged   = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
  const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
  const utilPct  = calculateUtilization(logged, capacity)
  return { logged, capacity, utilPct }
}

export function calcYTDUtilization(capacityRows, cutoffDate) {
  const yearStart = `${cutoffDate.slice(0, 4)}-01-01`
  const rows = capacityRows.filter(r => r.Date && r.Date >= yearStart && r.Date <= cutoffDate)
  return { ...sumLoggedCapacity(rows), startDate: yearStart, endDate: cutoffDate }
}

// One entry per calendar month from January through the cutoff date's month
// — full-month totals except the cutoff's own month, which is clipped to
// only the days that have actually elapsed (a standard partial month).
export function calcYTDMonthlyTrend(capacityRows, cutoffDate) {
  const year     = Number(cutoffDate.slice(0, 4))
  const endMonth = Number(cutoffDate.slice(5, 7))

  const months = []
  for (let m = 1; m <= endMonth; m++) {
    const rangeStart = `${year}-${String(m).padStart(2, '0')}-01`
    const rangeEnd = m === endMonth
      ? cutoffDate
      : format(endOfMonth(new Date(year, m - 1, 1)), 'yyyy-MM-dd')
    months.push({ m, rangeStart, rangeEnd })
  }

  return months.map(({ m, rangeStart, rangeEnd }) => {
    const rows = capacityRows.filter(r => r.Date && r.Date >= rangeStart && r.Date <= rangeEnd)
    // rangeStart/rangeEnd/monthLabel let a click on this month's bar re-derive
    // the exact row subset and a human-readable title for a drill-down modal.
    return {
      month: format(new Date(year, m - 1, 1), 'MMM'),
      monthLabel: format(new Date(year, m - 1, 1), 'MMMM yyyy'),
      rangeStart, rangeEnd,
      ...sumLoggedCapacity(rows),
    }
  })
}

// ─── Billable vs Non-Billable vs Exchange ────────────────────────────────────
// Category is derived strictly from CLIENT (not a per-employee/manual default),
// since one employee can log time against several clients in the same period.

const NON_BILLABLE_CLIENTS = ['maznexa', 'mazenixa']
const EXCHANGE_CLIENTS     = ['sanad - eyen', 'bold influence']

export function getRowCategory(row) {
  const client = (row.CLIENT || '').trim().toLowerCase()
  if (NON_BILLABLE_CLIENTS.includes(client)) return 'nonBillable'
  if (EXCHANGE_CLIENTS.includes(client))     return 'exchange'
  return 'billable'
}

export function calcBillableByEmployee(rows) {
  const byEmp = groupBy(rows, 'WHO')
  return Object.entries(byEmp).map(([name, empRows]) => {
    const billable    = round2(sumHours(empRows.filter(r => getRowCategory(r) === 'billable')))
    const nonBillable = round2(sumHours(empRows.filter(r => getRowCategory(r) === 'nonBillable')))
    const exchange    = round2(sumHours(empRows.filter(r => getRowCategory(r) === 'exchange')))
    const team        = empRows[0]?.TEAM || ''
    return { name, team, billable, nonBillable, exchange, total: round2(billable + nonBillable + exchange) }
  }).sort((a, b) => b.total - a.total)
}

export function calcBillableByTeam(rows) {
  const byTeam = groupBy(rows, 'TEAM')
  return Object.entries(byTeam).map(([team, teamRows]) => {
    const billable    = round2(sumHours(teamRows.filter(r => getRowCategory(r) === 'billable')))
    const nonBillable = round2(sumHours(teamRows.filter(r => getRowCategory(r) === 'nonBillable')))
    const exchange    = round2(sumHours(teamRows.filter(r => getRowCategory(r) === 'exchange')))
    return { team, billable, nonBillable, exchange, total: round2(billable + nonBillable + exchange) }
  }).sort((a, b) => b.total - a.total)
}

// Month/quarter keys are derived from the MONTH column ("YYYY-MM"), which
// sorts correctly as a plain string — no date parsing needed.
export function monthKey(row) {
  return row.MONTH || ''
}

export function quarterKey(row) {
  if (!row.MONTH) return ''
  const [year, month] = row.MONTH.split('-').map(Number)
  if (!year || !month) return ''
  return `${year}-Q${Math.ceil(month / 3)}`
}

export function calcBillableByPeriod(rows, periodKeyFn) {
  const byPeriod = {}
  rows.forEach(row => {
    const period = periodKeyFn(row)
    if (!period) return
    if (!byPeriod[period]) byPeriod[period] = []
    byPeriod[period].push(row)
  })
  return Object.entries(byPeriod).map(([period, periodRows]) => {
    const billable    = round2(sumHours(periodRows.filter(r => getRowCategory(r) === 'billable')))
    const nonBillable = round2(sumHours(periodRows.filter(r => getRowCategory(r) === 'nonBillable')))
    const exchange    = round2(sumHours(periodRows.filter(r => getRowCategory(r) === 'exchange')))
    return { period, billable, nonBillable, exchange, total: round2(billable + nonBillable + exchange) }
  }).sort((a, b) => a.period.localeCompare(b.period)) // chronological, not by value — this is a trend series
}

// Converts absolute hours into a 0-100 share per row (billable + nonBillable
// + exchange = 100), for 100%-stacked "share of time" charts.
export function toCategoryPercent(rows) {
  return rows.map(r => {
    const total = r.billable + r.nonBillable + r.exchange
    return {
      ...r,
      billablePct:    total > 0 ? roundPct((r.billable / total) * 100) : 0,
      nonBillablePct: total > 0 ? roundPct((r.nonBillable / total) * 100) : 0,
      exchangePct:    total > 0 ? roundPct((r.exchange / total) * 100) : 0,
    }
  })
}

// ─── Hours by Client & Project ───────────────────────────────────────────────

export function calcHoursByClient(rows) {
  const byClient = groupBy(rows, 'CLIENT')
  return Object.entries(byClient)
    .map(([client, r]) => ({ client, hours: round2(sumHours(r)) }))
    .sort((a, b) => b.hours - a.hours)
}

export function calcHoursByTag(rows, tagWhitelist = null) {
  const scoped  = tagWhitelist ? rows.filter(r => tagWhitelist.includes(r['TIME LOG TAG'])) : rows
  const byTag   = groupBy(scoped, 'TIME LOG TAG')
  return Object.entries(byTag)
    .map(([tag, r]) => ({ tag, hours: round2(sumHours(r)) }))
    .sort((a, b) => b.hours - a.hours)
}

export function calcTagHoursByEmployee(rows, tagWhitelist) {
  const scoped = rows.filter(r => tagWhitelist.includes(r['TIME LOG TAG']))
  const byEmp  = groupBy(scoped, 'WHO')
  return Object.entries(byEmp).map(([name, empRows]) => {
    const perTag = Object.fromEntries(
      tagWhitelist.map(tag => [tag, round2(sumHours(empRows.filter(r => r['TIME LOG TAG'] === tag)))])
    )
    const total = round2(Object.values(perTag).reduce((s, v) => s + v, 0))
    return { name, ...perTag, total }
  }).sort((a, b) => b.total - a.total)
}

// Drill-down for the "Hours by Time Log Tag" donut — every employee who
// logged hours under one specific tag, descending by hours. `rows` is
// whatever already-filtered Raw Time Log rows the donut itself was built
// from, so this always matches the slice the user clicked.
export function calcEmployeeHoursByTag(rows, tag) {
  const scoped = rows.filter(r => r['TIME LOG TAG'] === tag)
  const byEmp  = groupBy(scoped, 'WHO')
  return Object.entries(byEmp)
    .map(([name, empRows]) => ({ name, hours: round2(sumHours(empRows)) }))
    .sort((a, b) => b.hours - a.hours)
}

export function calcHoursByProject(rows) {
  const byProject = groupBy(rows, 'PROJECT')
  return Object.entries(byProject)
    .map(([project, r]) => ({
      project,
      client: r[0]?.CLIENT || '',
      hours: round2(sumHours(r)),
    }))
    .sort((a, b) => b.hours - a.hours)
}

export function calcPivotTable(rows, rowKey, colKey) {
  const pivot = {}
  const colSet = new Set()

  rows.forEach(row => {
    const r = row[rowKey] || 'Unknown'
    const c = row[colKey] || 'Unknown'
    colSet.add(c)
    if (!pivot[r]) pivot[r] = {}
    pivot[r][c] = round2((pivot[r][c] || 0) + (parseFloat(row.HOURS) || 0))
  })

  const cols = [...colSet].sort()
  const data = Object.entries(pivot).map(([rowLabel, colData]) => ({
    label: rowLabel,
    total: round2(Object.values(colData).reduce((s, v) => s + v, 0)),
    ...Object.fromEntries(cols.map(c => [c, colData[c] || 0])),
  })).sort((a, b) => b.total - a.total)

  return { data, cols }
}

// ─── Team Utilization per Day (Weekly Report heatmap) ─────────────────────────
// For each weekday (Sun-Sat) x Team, sums every matching Capacity row's
// Logged/Available (hrs) across the whole filtered date range and derives a
// single utilization % per cell — so "Monday" reflects every Monday inside
// the selected period, not just the most recent one. A team/day cell with
// zero Available hrs across the whole range (i.e. that team never had
// capacity scheduled on that weekday within the filter) is flagged isOffDay
// so the UI can show "Off Day" instead of a misleading 0%.
const DAY_OF_WEEK_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function calcTeamUtilizationByDayOfWeek(capacityRows) {
  const teams = getUniqueCapacityTeams(capacityRows)

  const matrix = DAY_OF_WEEK_LABELS.map((day, dowIndex) => {
    const dayRows = capacityRows.filter(r => r.Date && parseISO(r.Date).getDay() === dowIndex)
    const cells = teams.map(team => {
      const rows     = dayRows.filter(r => r.Team === team)
      const logged   = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)'])   || 0), 0))
      const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
      const isOffDay = capacity === 0
      const utilPct  = calculateUtilization(logged, capacity)
      return { team, logged, capacity, utilPct, isOffDay }
    })
    return { day, cells }
  })

  return { teams, matrix }
}

// ─── Weekly Report-only variants of shared Comparison-tab helpers ───────────
// calcCapacityByEmployee/calcTeamUtilizationSummary/calcCapacitySummary below
// (in the Comparison section) are also used by the Comparison tab — these are
// deliberate duplicates (not a shared/modified version of those) so Weekly
// Report's period drill-down modal and Week-over-Week widget can route
// through calculateUtilization without touching Comparison's own numbers.

export function calcCapacitySummaryForWeeklyReport(rows) {
  const hours    = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)']) || 0), 0))
  const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
  const util     = calculateUtilization(hours, capacity)
  return { hours, capacity, util }
}

export function calcTeamUtilizationSummaryForWeeklyReport(rows) {
  const byTeam = groupBy(rows, 'Team')
  return Object.entries(byTeam)
    .map(([team, r]) => ({ team, ...calcCapacitySummaryForWeeklyReport(r) }))
    .sort((a, b) => b.util - a.util)
}

export function calcCapacityByEmployeeForWeeklyReport(rows) {
  const byEmp = groupBy(rows, 'Name')
  return Object.entries(byEmp).map(([name, r]) => {
    const hours    = round2(r.reduce((s, x) => s + (parseFloat(x['Logged (hrs)']) || 0), 0))
    const capacity = round2(r.reduce((s, x) => s + (parseFloat(x['Available (hrs)']) || 0), 0))
    const util     = calculateUtilization(hours, capacity)
    const team     = r[0]?.Team || ''
    return { name, team, hours, capacity, util }
  }).filter(e => e.hours > 0 || e.capacity > 0)
}

// ─── Utilization color coding ─────────────────────────────────────────────────

export function utilizationColor(pct) {
  if (pct < 60)  return { bg: SEQUENTIAL_STOPS[0], label: 'Low' }
  if (pct < 75)  return { bg: SEQUENTIAL_STOPS[1], label: 'Fair' }
  if (pct < 85)  return { bg: SEQUENTIAL_STOPS[2], label: 'Good' }
  if (pct < 90)  return { bg: SEQUENTIAL_STOPS[3], label: 'Very Good' }
  if (pct < 95)  return { bg: SEQUENTIAL_STOPS[4], label: 'Excellent' }
  return           { bg: SEQUENTIAL_STOPS[5],      label: 'Professional' }
}

// ─── Comparison (2025 vs 2026) ────────────────────────────────────────────────

// Rows for deactivated/deleted employees (see the "(محذوف)" name cleanup in
// sheetsApi.js) can still sit in the Capacity sheet with 0 hours and 0
// capacity every day forever. Counting them as "active headcount" makes the
// employee count look frozen across months — only count someone once they
// actually have non-zero capacity or logged hours in the scoped rows.
function countActiveEmployees(rows) {
  return new Set(
    rows
      .filter(r => (parseFloat(r['Available (hrs)']) || 0) > 0 || (parseFloat(r['Logged (hrs)']) || 0) > 0)
      .map(r => r.Name)
  ).size
}

// Same "active" definition as countActiveEmployees, but returns the actual
// names instead of just a count — used by the Team/Grand Summary Employees
// column drill-down, so the modal's list always matches the cell's number.
export function getActiveEmployeeNames(rows) {
  return [...new Set(
    rows
      .filter(r => (parseFloat(r['Available (hrs)']) || 0) > 0 || (parseFloat(r['Logged (hrs)']) || 0) > 0)
      .map(r => r.Name)
  )].sort((a, b) => a.localeCompare(b))
}

// Unified Growth % used everywhere in the Comparison dashboard: relative
// change from 2025 to 2026, e.g. 81.7% -> 85.8% = (85.8-81.7)/81.7*100 = 5.02%.
export function calcGrowthPct(util2025, util2026) {
  if (!util2025) return 0
  return roundPct(((util2026 - util2025) / util2025) * 100)
}

export function calcComparisonByEmployee(cap2025Rows, cap2026Rows) {
  function aggregate(rows) {
    const byEmp = groupBy(rows, 'Name')
    return Object.fromEntries(
      Object.entries(byEmp).map(([name, r]) => {
        const logged   = round2(r.reduce((s, x) => s + (parseFloat(x['Logged (hrs)']) || 0), 0))
        const capacity = round2(r.reduce((s, x) => s + (parseFloat(x['Available (hrs)']) || 0), 0))
        const team     = r[0]?.Team || ''
        const utilPct  = capacity > 0 ? roundPct((logged / capacity) * 100) : 0
        return [name, { logged, capacity, utilPct, team }]
      })
    )
  }

  const data2025 = aggregate(cap2025Rows)
  const data2026 = aggregate(cap2026Rows)
  const names    = [...new Set([...Object.keys(data2025), ...Object.keys(data2026)])]

  return names.map(name => ({
    name,
    team:         data2025[name]?.team || data2026[name]?.team || '',
    hours2025:    data2025[name]?.logged || 0,
    hours2026:    data2026[name]?.logged || 0,
    capacity2025: data2025[name]?.capacity || 0,
    capacity2026: data2026[name]?.capacity || 0,
    util2025:     data2025[name]?.utilPct || 0,
    util2026:     data2026[name]?.utilPct || 0,
    delta:        calcGrowthPct(data2025[name]?.utilPct || 0, data2026[name]?.utilPct || 0),
  })).sort((a, b) => b.util2026 - a.util2026)
}

export function calcComparisonByTeam(cap2025Rows, cap2026Rows) {
  function aggregate(rows) {
    const byTeam = groupBy(rows, 'Team')
    return Object.fromEntries(
      Object.entries(byTeam).map(([team, r]) => {
        const logged   = r.reduce((s, x) => s + (parseFloat(x['Logged (hrs)']) || 0), 0)
        const capacity = r.reduce((s, x) => s + (parseFloat(x['Available (hrs)']) || 0), 0)
        const empCount = countActiveEmployees(r)
        const utilPct  = capacity > 0 ? roundPct((logged / capacity) * 100) : 0
        return [team, { logged: round2(logged), capacity: round2(capacity), utilPct, empCount }]
      })
    )
  }

  const data2025 = aggregate(cap2025Rows)
  const data2026 = aggregate(cap2026Rows)
  const teams    = [...new Set([...Object.keys(data2025), ...Object.keys(data2026)])]

  return teams.map(team => ({
    team,
    hours2025:     data2025[team]?.logged || 0,
    hours2026:     data2026[team]?.logged || 0,
    capacity2025:  data2025[team]?.capacity || 0,
    capacity2026:  data2026[team]?.capacity || 0,
    util2025:      data2025[team]?.utilPct || 0,
    util2026:      data2026[team]?.utilPct || 0,
    empCount2025:  data2025[team]?.empCount || 0,
    empCount2026:  data2026[team]?.empCount || 0,
    delta:         calcGrowthPct(data2025[team]?.utilPct || 0, data2026[team]?.utilPct || 0),
  })).sort((a, b) => b.util2026 - a.util2026)
}

// ─── Yearly / Quarterly / Monthly capacity summaries (Comparison dashboard) ──
// These operate directly on Capacity sheet rows (Date, Name, Team,
// Available (hrs), Logged (hrs)). "Capacity 2025" rows are monthly
// ("YYYY-MM"); the current-year "Capacity" tab rows are daily
// ("YYYY-MM-DD") — slicing the first 7 chars of Date works for both.

function capMonthNum(row) {
  const ym = (row.Date || '').slice(0, 7) // "YYYY-MM"
  const m  = Number(ym.slice(5, 7))
  return m >= 1 && m <= 12 ? m : null
}

function capQuarterNum(row) {
  const m = capMonthNum(row)
  return m ? Math.ceil(m / 3) : null
}

export function calcCapacitySummary(rows) {
  const hours    = round2(rows.reduce((s, r) => s + (parseFloat(r['Logged (hrs)']) || 0), 0))
  const capacity = round2(rows.reduce((s, r) => s + (parseFloat(r['Available (hrs)']) || 0), 0))
  const util     = capacity > 0 ? roundPct((hours / capacity) * 100) : 0
  const empCount = countActiveEmployees(rows)
  return { hours, capacity, util, empCount }
}

export function calcYearlyComparison(cap2025Rows, cap2026Rows) {
  const y2025 = calcCapacitySummary(cap2025Rows)
  const y2026 = calcCapacitySummary(cap2026Rows)
  return {
    hours2025: y2025.hours, hours2026: y2026.hours,
    capacity2025: y2025.capacity, capacity2026: y2026.capacity,
    util2025: y2025.util, util2026: y2026.util,
    empCount2025: y2025.empCount, empCount2026: y2026.empCount,
    growthPct: calcGrowthPct(y2025.util, y2026.util),
  }
}

export function calcQuarterlyComparison(cap2025Rows, cap2026Rows) {
  return [1, 2, 3, 4].map(q => {
    const s2025 = calcCapacitySummary(cap2025Rows.filter(r => capQuarterNum(r) === q))
    const s2026 = calcCapacitySummary(cap2026Rows.filter(r => capQuarterNum(r) === q))
    return {
      quarter: `Q${q}`,
      hours2025: s2025.hours, hours2026: s2026.hours,
      capacity2025: s2025.capacity, capacity2026: s2026.capacity,
      util2025: s2025.util, util2026: s2026.util,
      empCount2025: s2025.empCount, empCount2026: s2026.empCount,
      growthPct: calcGrowthPct(s2025.util, s2026.util),
    }
  })
}

// ─── Comparison dashboard drill-downs ────────────────────────────────────
// Clicking an Employees/Hours/Capacity cell in the Quarterly or Monthly
// table narrows the same Capacity/Time-Log rows that produced that cell
// down to one year + one period, so the modal always reconciles with the
// number the user clicked.

export function filterCapacityByQuarter(rows, quarter) {
  return rows.filter(r => capQuarterNum(r) === quarter)
}

// Single-year per-employee breakdown (vs. calcComparisonByEmployee, which
// merges 2025 and 2026 side by side) — used to drill into one year's cell.
export function calcCapacityByEmployee(rows) {
  const byEmp = groupBy(rows, 'Name')
  return Object.entries(byEmp).map(([name, r]) => {
    const hours    = round2(r.reduce((s, x) => s + (parseFloat(x['Logged (hrs)']) || 0), 0))
    const capacity = round2(r.reduce((s, x) => s + (parseFloat(x['Available (hrs)']) || 0), 0))
    const util     = capacity > 0 ? roundPct((hours / capacity) * 100) : 0
    const team     = r[0]?.Team || ''
    return { name, team, hours, capacity, util }
  }).filter(e => e.hours > 0 || e.capacity > 0)
}

// Raw Time Log rows (WHO/TEAM/CLIENT/PROJECT/HOURS/DATE) carry the
// project/client detail the aggregated Capacity sheet doesn't — used for the
// Hours drill-down. DATE is daily ("YYYY-MM-DD"); 2025 rows may not exist at
// all since Raw Time Log only goes back as far as the sheet's history.
export function filterTimeLogByMonth(rows, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return rows.filter(r => (r.DATE || '').startsWith(prefix))
}

export function filterTimeLogByQuarter(rows, year, quarter) {
  return rows.filter(r => {
    const ym = (r.DATE || '').slice(0, 7)
    if (!ym.startsWith(`${year}-`)) return false
    const m = Number(ym.slice(5, 7))
    return m >= 1 && m <= 12 && Math.ceil(m / 3) === quarter
  })
}

// One row per calendar month present in `rows` — used to find the
// highest/lowest utilization month within a single year.
export function calcMonthlyUtilizationTrend(rows) {
  const byMonth = {}
  rows.forEach(r => {
    const m = capMonthNum(r)
    if (!m) return
    if (!byMonth[m]) byMonth[m] = []
    byMonth[m].push(r)
  })
  return Object.entries(byMonth)
    .map(([m, r]) => ({ month: Number(m), ...calcCapacitySummary(r) }))
    .sort((a, b) => a.month - b.month)
}

export function calcTeamUtilizationSummary(rows) {
  const byTeam = groupBy(rows, 'Team')
  return Object.entries(byTeam)
    .map(([team, r]) => ({ team, ...calcCapacitySummary(r) }))
    .sort((a, b) => b.util - a.util)
}

// ─── Tasks Sheet ──────────────────────────────────────────────────────────────

export function filterTasksByDate(rows, startDate, endDate, dateField = 'CREATED DATE') {
  if (!startDate || !endDate) return rows
  const start = startOfDay(parseISO(startDate))
  const end   = endOfDay(parseISO(endDate))

  return rows.filter(row => {
    if (!row[dateField]) return false
    const d = parseISO(row[dateField])
    return isWithinInterval(d, { start, end })
  })
}

function splitAssignees(value) {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// Scopes raw task rows down to only tasks with at least one assignee in
// `allowedNames` — the Team/Employee Data Scope enforcement point shared by
// every task-based widget on Weekly Report (Task Status, Task Details pivot,
// Overdue by Employee), mirroring the allowedNames pattern Task Details tab's
// own tag chart already uses (calcTaskCountByEmployeeForTagFiltered below).
export function filterTasksByAllowedNames(taskRows, allowedNames) {
  if (!allowedNames) return taskRows
  return taskRows.filter(row => splitAssignees(row['ASSIGNEE(S)']).some(n => allowedNames.has(n)))
}

export function calcTaskCountByEmployee(rows) {
  const counts = {}
  rows.forEach(row => {
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      counts[name] = (counts[name] || 0) + 1
    })
  })
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

export function calcTaskStatusByEmployee(rows) {
  const byEmp = {}
  rows.forEach(row => {
    const isComplete = row.STATUS === 'completed'
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      if (!byEmp[name]) byEmp[name] = { name, complete: 0, inProgress: 0 }
      if (isComplete) byEmp[name].complete += 1
      else byEmp[name].inProgress += 1
    })
  })
  return Object.values(byEmp).sort(
    (a, b) => (b.complete + b.inProgress) - (a.complete + a.inProgress)
  )
}

export function calcOverdueDays(row, today = new Date()) {
  if (!row['DUE DATE']) return null
  const due       = parseISO(row['DUE DATE'])
  const reference = row['COMPLETED DATE'] ? parseISO(row['COMPLETED DATE']) : today
  const days      = differenceInCalendarDays(reference, due)
  return days > 0 ? days : 0
}

// ─── Overdue Tasks by Employee (Weekly Report chart) ──────────────────────
// Counts each employee's currently-overdue tasks (Overdue Days > 0 — the
// exact same calcOverdueDays rule the Task Details table's "Overdue Days"
// column already uses) out of whatever task rows are passed in, so this
// chart's numbers always trace back to that same table. Team membership
// (for the Business Development/Trainees exclusion) is looked up from the
// full, unfiltered Capacity rows — a stable Name -> Team map — since task
// rows carry no Team column of their own and the Task Details table itself
// isn't scoped by the main Team/Employee filter either.
const OVERDUE_CHART_EXCLUDED_TEAMS = ['business development', 'trainees']

export function calcOverdueTaskCountByEmployee(taskRows, capacityRows) {
  const nameToTeam = {}
  capacityRows.forEach(r => {
    if (r.Name && !(r.Name in nameToTeam)) nameToTeam[r.Name] = r.Team || ''
  })

  const today = new Date()
  const counts = {}
  taskRows.forEach(row => {
    const overdueDays = calcOverdueDays(row, today)
    if (!overdueDays || overdueDays <= 0) return
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      counts[name] = (counts[name] || 0) + 1
    })
  })

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count, team: nameToTeam[name] || '' }))
    .filter(e => !OVERDUE_CHART_EXCLUDED_TEAMS.includes(e.team.trim().toLowerCase()))
    .sort((a, b) => b.count - a.count)
}

export function buildTasksPivot(rows) {
  const today = new Date()
  return rows.map(row => ({
    taskId:      row['TASK ID'],
    taskName:    row['TASK NAME'],
    assignee:    row['ASSIGNEE(S)'],
    createdDate: row['CREATED DATE'],
    startDate:   row['START DATE'],
    endDate:     row['DUE DATE'],
    closedDate:  row['COMPLETED DATE'],
    status:      row['STATUS'],
    overdueDays: calcOverdueDays(row, today),
  }))
}

// Drill-down for the "Hours by Time Log Tag per Employee" chart — every task
// (from the Tasks sheet) assigned to one specific employee, scoped to the
// tab's currently active date range (Created Date, same field the Task
// Details table's own date filtering already keys off).
export function getEmployeeTasksInRange(taskRows, employeeName, startDate, endDate) {
  const scoped = filterTasksByDate(taskRows, startDate, endDate, 'CREATED DATE')
  return scoped
    .filter(row => splitAssignees(row['ASSIGNEE(S)']).includes(employeeName))
    .map(row => ({
      taskId:      row['TASK ID'],
      taskName:    row['TASK NAME'],
      status:      row['STATUS'] === 'completed' ? 'Complete' : 'In Progress',
      createdDate: row['CREATED DATE'],
      dueDate:     row['DUE DATE'],
    }))
}

// ─── Task Details tab ──────────────────────────────────────────────────────
// A separate, fuller read of the same Tasks sheet used above — this tab also
// reads TEAM, STAGE, PRIORITY, ESTIMATED HRS, LOGGED HRS, TAGS, DESCRIPTION,
// and any "CF: ..." custom field column. The Tasks sheet's own STATUS enum
// is only 'new' | 'completed' | 'reopened' — there is no "in progress"
// status. "In Progress" instead comes from the separate STAGE column (a
// per-task-list workflow/kanban stage), which does have that value — with
// inconsistent casing ("In Progress" vs "In progress") in the source data,
// hence the case-insensitive compare below.
const TASK_STAGE_IN_PROGRESS = 'in progress'

export function getUniqueTaskTags(rows) {
  const set = new Set()
  rows.forEach(r => splitAssignees(r['TAGS']).forEach(t => set.add(t)))
  return [...set].sort()
}

// Per-employee task summary (one row per assignee — a multi-assignee task
// counts once for each person on it). Team is looked up from the Capacity
// sheet's Name -> Team map rather than the task row's own (frequently blank)
// TEAM column — same reliability reasoning as calcOverdueTaskCountByEmployee
// above. New/Complete come straight from STATUS; In Progress from STAGE;
// Overdue from the same calcOverdueDays rule used everywhere else. These
// aren't mutually exclusive (e.g. a task can be both overdue and "in
// progress") — each column is an independent count, not a partition of Total.
export function calcTaskSummaryByEmployee(taskRows, capacityRows) {
  const nameToTeam = {}
  capacityRows.forEach(r => {
    if (r.Name && !(r.Name in nameToTeam)) nameToTeam[r.Name] = r.Team || ''
  })

  const today = new Date()
  const byEmp = {}
  taskRows.forEach(row => {
    const status = (row.STATUS || '').trim().toLowerCase()
    const stage  = (row.STAGE  || '').trim().toLowerCase()
    const overdueDays = calcOverdueDays(row, today)
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      if (!byEmp[name]) {
        byEmp[name] = { name, team: nameToTeam[name] || '', total: 0, complete: 0, new: 0, inProgress: 0, overdue: 0 }
      }
      const e = byEmp[name]
      e.total += 1
      if (status === 'completed') e.complete += 1
      if (status === 'new') e.new += 1
      if (stage === TASK_STAGE_IN_PROGRESS) e.inProgress += 1
      if (overdueDays && overdueDays > 0) e.overdue += 1
    })
  })

  return Object.values(byEmp).sort((a, b) => b.total - a.total)
}

// Full task list for one employee (Task Details tab's employee drill-down
// modal) — every column the Teamwork-style task detail modal needs, plus the
// raw row itself so that modal can also read STAGE/PRIORITY/TAGS/CF fields
// without a second lookup.
export function getEmployeeTaskList(taskRows, employeeName) {
  const today = new Date()
  return taskRows
    .filter(row => splitAssignees(row['ASSIGNEE(S)']).includes(employeeName))
    .map(row => ({
      taskId:        row['TASK ID'],
      taskName:      row['TASK NAME'],
      status:        row['STATUS'],
      createdDate:   row['CREATED DATE'],
      startDate:     row['START DATE'],
      dueDate:       row['DUE DATE'],
      completedDate: row['COMPLETED DATE'],
      overdueDays:   calcOverdueDays(row, today),
      row,
    }))
    .sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1))
}

// Task counts (+ summed Logged Hrs) per employee for one specific tag —
// unfiltered by Team/Employee/Data Scope. No longer used anywhere (Task
// Details tab's "Tasks by Employee — by Tag" chart switched to the
// allowedNames-aware calcTaskCountByEmployeeForTagFiltered below, so its
// scope-locked employees only ever see their own Team's counts) — left in
// place rather than deleted in case it's still useful as a genuinely
// unfiltered read.
export function calcTaskCountByEmployeeForTag(taskRows, tag) {
  const byEmp = {}
  taskRows.forEach(row => {
    if (!splitAssignees(row['TAGS']).includes(tag)) return
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      if (!byEmp[name]) byEmp[name] = { name, count: 0, loggedHrs: 0 }
      byEmp[name].count += 1
      byEmp[name].loggedHrs = round2(byEmp[name].loggedHrs + (parseFloat(row['LOGGED HRS']) || 0))
    })
  })
  return Object.values(byEmp).sort((a, b) => b.count - a.count)
}

// Total Logged Hrs per Teamwork task ID, summed from the Main Sheet's "Raw
// Time Log" tab — the Tasks sheet's own LOGGED HRS column is blank/zero for
// most rows, so calcHoursByTaskTag below (and the Task Detail modal's Time
// Logs table) both read actual logged time from here instead, joined by
// TASK ID. Built once as a Map so per-task lookups stay O(1) rather than
// re-scanning the whole Raw Time Log sheet for every task.
function sumLoggedHoursByTaskId(rawTimeLogRows) {
  const byId = new Map()
  rawTimeLogRows.forEach(row => {
    const id = String(row['TASK ID'] ?? '').trim()
    if (!id) return
    const hrs = parseFloat(row['HOURS']) || 0
    byId.set(id, (byId.get(id) || 0) + hrs)
  })
  return byId
}

// Total Logged Hrs per tag, summed across the whole team (not broken out per
// employee) — Task Details tab's "Total Hours by Tag" chart. Each task's
// actual logged hours come from Raw Time Log (via sumLoggedHoursByTaskId
// above), not the Tasks sheet's own LOGGED HRS column. A task carrying more
// than one tag contributes its full logged hours to each of its tags (not
// split between them), matching calcTaskCountByEmployeeForTag's per-tag
// counting above. `allowedNames`, when given, scopes to tasks with at least
// one assignee in that set — pass the tab's currently filtered employee-name
// set (same Team/Employee filter the rest of the tab applies) so this
// respects the active filter; pass null for no scoping.
export function calcHoursByTaskTag(taskRows, rawTimeLogRows, allowedNames = null) {
  const loggedByTaskId = sumLoggedHoursByTaskId(rawTimeLogRows)
  const byTag = {}
  taskRows.forEach(row => {
    if (allowedNames && !splitAssignees(row['ASSIGNEE(S)']).some(n => allowedNames.has(n))) return
    const tags = splitAssignees(row['TAGS'])
    if (tags.length === 0) return
    const taskId = String(row['TASK ID'] ?? '').trim()
    const hrs = loggedByTaskId.get(taskId) || 0
    tags.forEach(tag => {
      byTag[tag] = round2((byTag[tag] || 0) + hrs)
    })
  })
  return Object.entries(byTag)
    .map(([tag, hours]) => ({ tag, hours }))
    .sort((a, b) => b.hours - a.hours)
}

function normalizeTag(tag) {
  return (tag || '').trim().toLowerCase()
}

// Tags tab groupings — actual tag casing/spacing in the sheet varies
// ("offline design" vs "Offline Design", "Shooting Day" vs "shooting day"),
// so every lookup against these goes through normalizeTag() rather than an
// exact string match. All three groups' tags were confirmed present in the
// live "Raw Tasks" sheet.
export const TAG_GROUPS = [
  {
    key: 'design',
    mainLabel: 'Total Design',
    subTags: [
      { label: 'Total Post',            tag: 'Post' },
      { label: 'Total Banner',          tag: 'Banner' },
      { label: 'Total Reels',           tag: 'Reels' },
      { label: 'Total Offline Design',  tag: 'Offline Design' },
      { label: 'Total Campaign Design', tag: 'Campaign Design' },
    ],
  },
  {
    key: 'edit',
    mainLabel: 'Total Edit',
    subTags: [
      { label: 'Total Edit Post', tag: 'Edit Post' },
      { label: 'Total Edit Reel', tag: 'Edit Reel' },
      { label: 'Total Edit',      tag: 'Edit' },
    ],
  },
  {
    key: 'shooting',
    mainLabel: 'Total Shooting',
    subTags: [
      { label: 'Video Shooting', tag: 'video shooting' },
      { label: 'Photo Shooting', tag: 'Photo shooting' },
      { label: 'Shooting Day',   tag: 'shooting day' },
    ],
  },
]

// Task counts per tag group for the Tags tab. Each group's main widget sums
// its member tags' task counts — a task carrying two tags from the same
// group counts once per tag (not deduplicated), matching the same
// "contributes fully to every tag it carries" convention already used by
// calcHoursByTaskTag above. Each sub-widget is that one tag's count alone.
// `allowedNames`, when given, scopes to tasks with at least one assignee in
// that set (the tab's currently filtered employee-name set); pass null for
// no scoping.
function countTasksByNormalizedTag(taskRows, allowedNames) {
  const countByTag = {}
  taskRows.forEach(row => {
    if (allowedNames && !splitAssignees(row['ASSIGNEE(S)']).some(n => allowedNames.has(n))) return
    splitAssignees(row['TAGS']).forEach(tag => {
      const key = normalizeTag(tag)
      countByTag[key] = (countByTag[key] || 0) + 1
    })
  })
  return countByTag
}

export function calcTagGroupCounts(taskRows, allowedNames = null) {
  const countByTag = countTasksByNormalizedTag(taskRows, allowedNames)

  return TAG_GROUPS.map(group => {
    const subs = group.subTags.map(sub => ({
      label: sub.label,
      count: countByTag[normalizeTag(sub.tag)] || 0,
    }))
    return {
      key: group.key,
      mainLabel: group.mainLabel,
      total: subs.reduce((sum, sub) => sum + sub.count, 0),
      subs,
    }
  })
}

// Task counts for an arbitrary, caller-ordered list of tags — the Tags
// tab's pie charts ("Total Number of Design"/"Total Number of Edit"),
// which show a different tag subset/order than the TAG_GROUPS widgets
// above. Same normalized-tag matching and allowedNames scoping.
export function calcTaskCountsForTags(taskRows, tags, allowedNames = null) {
  const countByTag = countTasksByNormalizedTag(taskRows, allowedNames)
  return tags.map(({ label, tag }) => ({ label, count: countByTag[normalizeTag(tag)] || 0 }))
}

// Task counts per employee for a single tag, respecting the shared Team/
// Employee filter (and therefore Data Scope) via `allowedNames` — the Tags
// tab's "Number of <Tag> by Employee" bar charts, and Task Details tab's
// "Tasks by Employee — by Tag" chart. A multi-assignee task counts once
// per assignee.
export function calcTaskCountByEmployeeForTagFiltered(taskRows, tag, allowedNames = null) {
  const key = normalizeTag(tag)
  const byEmp = {}
  taskRows.forEach(row => {
    if (!splitAssignees(row['TAGS']).some(t => normalizeTag(t) === key)) return
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      if (allowedNames && !allowedNames.has(name)) return
      byEmp[name] = (byEmp[name] || 0) + 1
    })
  })
  return Object.entries(byEmp)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

// Logged hours per employee for a single tag — the Tags tab's "Total Hours
// — <Tag> by Employee" bar charts. Hours come from the Main Sheet's Raw
// Time Log (joined by TASK ID via sumLoggedHoursByTaskId, same source as
// calcHoursByTaskTag above), not the Tasks sheet's own LOGGED HRS column.
// A task's full logged hours count toward every one of its assignees (not
// split between co-assignees on the same task).
export function calcHoursByEmployeeForTag(taskRows, rawTimeLogRows, tag, allowedNames = null) {
  const loggedByTaskId = sumLoggedHoursByTaskId(rawTimeLogRows)
  const key = normalizeTag(tag)
  const byEmp = {}
  taskRows.forEach(row => {
    if (!splitAssignees(row['TAGS']).some(t => normalizeTag(t) === key)) return
    const taskId = String(row['TASK ID'] ?? '').trim()
    const hrs = loggedByTaskId.get(taskId) || 0
    splitAssignees(row['ASSIGNEE(S)']).forEach(name => {
      if (allowedNames && !allowedNames.has(name)) return
      byEmp[name] = round2((byEmp[name] || 0) + hrs)
    })
  })
  return Object.entries(byEmp)
    .map(([name, hours]) => ({ name, hours }))
    .sort((a, b) => b.hours - a.hours)
}

// Drill-down for the Tags tab's pie charts — every task carrying the given
// tag, scoped by the same allowedNames set the rest of the tab uses. One
// row per task (not per assignee — Assignee(s) is shown as the raw
// comma-joined string since a task can carry more than one).
export function getTasksForTag(taskRows, tag, allowedNames = null) {
  const key = normalizeTag(tag)
  const today = new Date()
  return taskRows
    .filter(row => splitAssignees(row['TAGS']).some(t => normalizeTag(t) === key))
    .filter(row => !allowedNames || splitAssignees(row['ASSIGNEE(S)']).some(n => allowedNames.has(n)))
    .map(row => ({
      taskId:      row['TASK ID'],
      taskName:    row['TASK NAME'],
      assignee:    row['ASSIGNEE(S)'] || '',
      status:      row['STATUS'],
      createdDate: row['CREATED DATE'],
      dueDate:     row['DUE DATE'],
      overdueDays: calcOverdueDays(row, today),
    }))
}

// Drill-down for the Tags tab's per-employee bar charts — every task
// tagged with `tag` where `employeeName` is one of the assignees. Logged
// hours are always computed (joined via Raw Time Log by TASK ID, same
// source as calcHoursByEmployeeForTag above) so the modal can show them for
// the "hours" charts and simply omit the column for the "count" charts.
export function getTasksForEmployeeAndTag(taskRows, rawTimeLogRows, employeeName, tag) {
  const key = normalizeTag(tag)
  const loggedByTaskId = sumLoggedHoursByTaskId(rawTimeLogRows)
  const today = new Date()
  return taskRows
    .filter(row => splitAssignees(row['TAGS']).some(t => normalizeTag(t) === key))
    .filter(row => splitAssignees(row['ASSIGNEE(S)']).includes(employeeName))
    .map(row => {
      const taskId = String(row['TASK ID'] ?? '').trim()
      return {
        taskId,
        taskName:    row['TASK NAME'],
        status:      row['STATUS'],
        createdDate: row['CREATED DATE'],
        dueDate:     row['DUE DATE'],
        overdueDays: calcOverdueDays(row, today),
        loggedHrs:   round2(loggedByTaskId.get(taskId) || 0),
      }
    })
}

// Itemized time-log entries for one task (Task Detail modal's "TIME LOGS"
// table) — pulled from the Main Sheet's "Raw Time Log" tab and matched by
// TASK ID, since the Tasks sheet's own LOGGED HRS column is unreliable
// (blank/zero for most rows there). Both sheets carry TASK ID as a plain
// numeric string; comparing as trimmed strings avoids false mismatches from
// stray whitespace or number-vs-text formatting differences between them.
export function getTaskTimeLogs(rawTimeLogRows, taskId) {
  const id = String(taskId ?? '').trim()
  if (!id) return []
  return rawTimeLogRows
    .filter(row => String(row['TASK ID'] ?? '').trim() === id)
    .map(row => ({
      who:      row['WHO'] || '',
      date:     row['DATE'] || '',
      hours:    parseFloat(row['HOURS']) || 0,
      billable: row['BILLABLE'] || '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

// Every "CF: ..." custom field present (non-empty) on a task row — the
// Task Detail modal's "Custom Fields" tab. Purely data-driven: whatever
// custom field columns exist in the sheet for this task show up here
// automatically, nothing hardcoded by name.
export function getTaskCustomFields(row) {
  return Object.entries(row)
    .filter(([key, value]) => key.startsWith('CF: ') && value && String(value).trim())
    .map(([key, value]) => ({ label: key.replace(/^CF:\s*/, ''), value }))
}
