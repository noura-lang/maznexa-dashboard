import { useMemo, useState } from 'react'
import { format, parseISO, subDays, differenceInCalendarDays } from 'date-fns'
import { useRawTimeLog, useCapacity2026, useTasks } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import {
  filterRows, filterCapacityRows,
  calcOverallKPIs, calcUtilizationByTeam, calcUtilizationByEmployee,
  calcWeeklyUtilizationTrend, getAvailableCapacityMonths,
  calcYTDUtilization, calcYTDMonthlyTrend, calcTeamUtilizationByDayOfWeek,
  utilizationColor, calcHoursByTag, calcTagHoursByEmployee,
  filterTasksByDate, calcTaskStatusByEmployee, buildTasksPivot,
  calcCapacityByEmployee, calcTeamUtilizationSummary, calcCapacitySummary, calcGrowthPct,
} from '../api/transformData'
import { SEQUENTIAL_STOPS, CHART_COLORS } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
  Legend as RechartsLegend, PieChart, Pie,
} from 'recharts'

const UTIL_LEGEND = [
  { label: 'Low',        range: '< 60%',   color: SEQUENTIAL_STOPS[0] },
  { label: 'Fair',       range: '60–75%',  color: SEQUENTIAL_STOPS[1] },
  { label: 'Good',       range: '75–85%',  color: SEQUENTIAL_STOPS[2] },
  { label: 'Very Good',  range: '85–90%',  color: SEQUENTIAL_STOPS[3] },
  { label: 'Excellent',  range: '90–95%',  color: SEQUENTIAL_STOPS[4] },
  { label: 'Provisional',range: '> 95%',   color: SEQUENTIAL_STOPS[5] },
]

const UTIL_LEGEND_EXTRA = (
  <div className="flex flex-wrap gap-x-3 gap-y-1">
    {UTIL_LEGEND.map(l => (
      <span key={l.label} className="flex items-center gap-1 text-xs dark:text-white/60 text-brand-500">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
        {l.label}
      </span>
    ))}
  </div>
)

const COMPLETE_COLOR    = '#6858a2' // dark purple -> white label text
const IN_PROGRESS_COLOR = '#8c8ffe' // light blue   -> dark label text
const TREND_COLOR       = '#9354ff' // brand purple used for the weekly trend line
const TASK_PAGE_SIZE = 50

const TAG_WHITELIST = ['Meeting', 'Reporting', 'Follow up', 'Brainstorming', 'Research', 'Training']
const DAY_FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Fixed tag -> color/text mapping (not rank-based) so the same tag always
// gets the same color across the pie chart and the per-employee chart.
const TAG_COLOR_MAP = Object.fromEntries(TAG_WHITELIST.map((tag, i) => [tag, SEQUENTIAL_STOPS[i]]))
const TAG_TEXT_MAP  = Object.fromEntries(TAG_WHITELIST.map((tag, i) => [tag, i <= 3 ? '#1a0e3d' : '#ffffff']))

const axisLabelStyle = { fill: 'currentColor', fontSize: 11, fontWeight: 600 }
const fmtHours = v => Number(v ?? 0).toFixed(2)
const fmtPct   = v => Math.round(Number(v ?? 0)).toString()

function UtilBadge({ pct }) {
  const { bg, label } = utilizationColor(pct)
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: bg }}
    >
      {label}
    </span>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = Math.round(payload[0]?.value ?? 0)
  const { bg, label: lvl } = utilizationColor(val)
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-1">{label}</p>
      <p>Utilization: <span className="font-bold" style={{ color: bg }}>{val}%</span></p>
      <p className="text-xs mt-0.5 dark:text-white/50 text-brand-400">{lvl}</p>
    </div>
  )
}

function GenericTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-1 max-w-[200px] truncate">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-xs" style={{ color: p.fill || p.color }}>
          {p.name}: <span className="font-bold">{Number(p.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

function TagHoursTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-xs" style={{ color: p.fill || p.color }}>
          {p.name}: <span className="font-bold">{fmtHours(p.value)} hrs</span>
        </p>
      ))}
    </div>
  )
}

function TagPieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold" style={{ color: p.payload.fill }}>{p.name}</p>
      <p className="text-xs mt-0.5">{fmtHours(p.value)} hrs</p>
    </div>
  )
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Light utilization bands (<85%) use the app's dark text color for contrast
// against the light band colors; the two darkest bands (85%+) switch to
// white text — mirrors the SEQUENTIAL_STOPS threshold used elsewhere.
const heatmapCellTextColor = pct => (pct < 85 ? '#1a0e3d' : '#ffffff')

// "Team Utilization per Day" — a Sun-Sat x Team color matrix. Each day row
// gets a distinct tint (from the brand CHART_COLORS ramp) so rows are easy
// to tell apart; each cell's own background is the standard utilization
// color band, so magnitude reads the same way it does in every other chart
// on this tab. Days a team never had capacity scheduled show "Off Day".
function TeamUtilizationHeatmap({ matrix, teams, onCellClick }) {
  if (teams.length === 0) {
    return (
      <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
        No team data for the selected filters.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate" style={{ borderSpacing: '4px' }}>
        <thead>
          <tr>
            <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                           dark:text-white/50 text-brand-500 sticky left-0">
              Day
            </th>
            {teams.map(team => (
              <th key={team} className="text-center py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                        dark:text-white/50 text-brand-500 whitespace-nowrap min-w-[100px]">
                {team}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={row.day}>
              <td
                className="py-2.5 px-3 font-semibold rounded-lg dark:text-white text-brand-900 sticky left-0 whitespace-nowrap"
                style={{ backgroundColor: hexToRgba(CHART_COLORS[i % CHART_COLORS.length], 0.35) }}
              >
                {row.day}
              </td>
              {row.cells.map(cell => (
                <td
                  key={cell.team}
                  onClick={cell.isOffDay ? undefined : () => onCellClick?.(i, cell.team)}
                  className={`text-center py-2.5 px-3 rounded-lg font-semibold transition-opacity
                    ${cell.isOffDay ? 'dark:bg-white/5 bg-brand-100/40' : 'cursor-pointer hover:opacity-75'}`}
                  style={
                    cell.isOffDay
                      ? undefined
                      : { backgroundColor: utilizationColor(cell.utilPct).bg, color: heatmapCellTextColor(cell.utilPct) }
                  }
                >
                  {cell.isOffDay
                    ? <span className="text-xs font-normal dark:text-white/30 text-brand-400">Off Day</span>
                    : `${cell.utilPct}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Recharts hands onClick handlers the rendered item's props, which usually
// nest the original data entry under `.payload` — but not always depending
// on which element fired. Checking both keeps every click site working
// regardless of which Recharts component (Bar/Cell/custom dot) triggered it.
function chartPoint(d) {
  return d?.payload ?? d
}

// Generic period drill-down — opened by clicking a bar/point/cell anywhere
// on this tab that represents a period or a team (month, week, weekday,
// team). `rows` is always a Capacity-sheet row subset that already has the
// main Team/Employee filter applied by the caller — this modal never
// re-derives or loosens that filtering itself, it only aggregates whatever
// subset it's handed. Separate from any future single-employee detail modal.
function PeriodDrillDownModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { label, rows } = drillDown

  const employees = calcCapacityByEmployee(rows).sort((a, b) => b.util - a.util)
  const teams     = calcTeamUtilizationSummary(rows)
  const summary   = calcCapacitySummary(rows)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200
                   dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-base font-semibold dark:text-white text-brand-900">{label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none px-2 dark:text-white/50 text-brand-400
                       hover:dark:text-white hover:text-brand-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 text-xs
                          dark:text-white/60 text-brand-600 border-b dark:border-white/10 border-brand-200 pb-3">
            <span>Employees: <b className="dark:text-white text-brand-900">{employees.length}</b></span>
            <span>Total Logged: <b className="dark:text-white text-brand-900">{fmtHours(summary.hours)}</b></span>
            <span>Total Capacity: <b className="dark:text-white text-brand-900">{fmtHours(summary.capacity)}</b></span>
            <span>Overall Utilization:{' '}
              <b style={{ color: utilizationColor(summary.util).bg }}>{summary.util}%</b>
            </span>
          </div>
        )}

        <div className="overflow-y-auto p-4 space-y-6">
          {rows.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No data for this period with the current filters.
            </p>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 dark:text-white/50 text-brand-500">
                  By Team
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      {['Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                               dark:text-white/50 text-brand-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t, i) => (
                      <tr key={t.team} className={`border-b dark:border-white/5 border-brand-100
                        ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                        <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{t.team}</td>
                        <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(t.hours)}</td>
                        <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(t.capacity)}</td>
                        <td className="py-2 px-3 font-semibold" style={{ color: utilizationColor(t.util).bg }}>
                          {t.util}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 dark:text-white/50 text-brand-500">
                  By Employee
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      {['Employee', 'Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                               dark:text-white/50 text-brand-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e, i) => (
                      <tr key={e.name} className={`border-b dark:border-white/5 border-brand-100
                        ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                        <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{e.name}</td>
                        <td className="py-2 px-3 dark:text-white/70 text-brand-600">{e.team}</td>
                        <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(e.hours)}</td>
                        <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(e.capacity)}</td>
                        <td className="py-2 px-3 font-semibold" style={{ color: utilizationColor(e.util).bg }}>
                          {e.util}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Week-over-week (generalized to "current filter period vs. the immediately
// preceding period of equal length") — so it behaves as literal week-over-week
// when the main filter spans 7 days (the default), and degrades gracefully to
// period-over-period for any other range the user picks.
function WeekOverWeekCard({ currentUtil, previousUtil, delta, currentLabel, previousLabel }) {
  const isUp = delta >= 0
  return (
    <div
      className="card p-5 flex flex-col items-center justify-center gap-1 text-center rounded-2xl
                 bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                 from-brand-200/70 via-brand-100/30 to-transparent"
    >
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
        Week-over-Week Utilization
      </p>
      <p className="text-xs mt-1 dark:text-white/60 text-brand-600">
        {currentLabel}: <span className="font-semibold dark:text-white text-brand-900">{currentUtil}%</span>
      </p>
      <p className={`text-3xl font-bold leading-tight my-0.5 flex items-center justify-center gap-1.5
        ${isUp ? 'text-green-400' : 'text-red-400'}`}>
        {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{delta}%
      </p>
      <p className="text-xs dark:text-white/60 text-brand-600">
        {previousLabel}: <span className="font-semibold dark:text-white text-brand-900">{previousUtil}%</span>
      </p>
    </div>
  )
}

// Combined Highest-vs-Lowest card — one big number (the spread between the
// highest and lowest performer) framed by a small "Max (name): X%" line
// above and "Min (name): Y%" line below. Replaces the four separate
// Top/Lowest Employee/Team cards with two of these (one for Teams, one for
// Employees), same gradient card styling as every other KPI card on the tab.
function HighLowSpreadCard({ label, maxLabel, maxValue, minLabel, minValue }) {
  const hasData = maxValue !== undefined && maxValue !== null && minValue !== undefined && minValue !== null
  const diff = hasData ? Math.round(maxValue - minValue) : null

  return (
    <div
      className="card p-5 flex flex-col items-center justify-center gap-1 text-center rounded-2xl
                 bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                 from-brand-200/70 via-brand-100/30 to-transparent"
    >
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
        {label}
      </p>
      {hasData ? (
        <>
          <p className="text-xs mt-1 dark:text-white/60 text-brand-600">
            Max ({maxLabel}): <span className="font-semibold dark:text-white text-brand-900">{maxValue}%</span>
          </p>
          <p className="text-3xl font-bold dark:text-white text-brand-900 leading-tight my-0.5">{diff}%</p>
          <p className="text-xs dark:text-white/60 text-brand-600">
            Min ({minLabel}): <span className="font-semibold dark:text-white text-brand-900">{minValue}%</span>
          </p>
        </>
      ) : (
        <p className="text-sm dark:text-white/40 text-brand-400 mt-2">No data</p>
      )}
    </div>
  )
}

export default function WeeklyReport() {
  const filters = useFilters()
  const { data: rawRows = [], isLoading: loadingLog, error: errLog } = useRawTimeLog()
  const { data: capRows = [], isLoading: loadingCap, error: errCap } = useCapacity2026()
  const { data: rawTasks = [], isLoading: loadingTasks, error: errTasks } = useTasks()

  const filteredLog = useMemo(() => filterRows(rawRows, filters),        [rawRows, filters])
  const filteredCap = useMemo(() => filterCapacityRows(capRows, filters), [capRows, filters])

  const kpis        = useMemo(() => calcOverallKPIs(filteredLog, filteredCap),        [filteredLog, filteredCap])

  // Team/Employee-only filtered Capacity rows — same main-filter selections
  // as filteredCap, but WITHOUT the main date-range restriction. The YTD
  // widget and the Weekly Trend chart each define their own date scoping
  // (Jan 1 -> cutoff; an independent Month dropdown) that has to stay free
  // to look outside the main filter's date range — but every other
  // dimension of the main filter (Team/Employee) must still narrow them,
  // same as every other chart on this tab. Previously these read raw
  // capRows and ignored the Team/Employee filter entirely — that was the bug.
  const filteredCapNoDateRange = useMemo(
    () => filterCapacityRows(capRows, { selectedTeams: filters.selectedTeams, selectedEmployees: filters.selectedEmployees }),
    [capRows, filters.selectedTeams, filters.selectedEmployees]
  )

  // ─── YTD Utilization widget — Jan 1 through the main filter's end date,
  // narrowed by the main filter's Team/Employee selections (see comment above).
  const ytd        = useMemo(() => calcYTDUtilization(filteredCapNoDateRange, filters.endDate),   [filteredCapNoDateRange, filters.endDate])
  const ytdMonthly = useMemo(() => calcYTDMonthlyTrend(filteredCapNoDateRange, filters.endDate),  [filteredCapNoDateRange, filters.endDate])

  const byTeam      = useMemo(() => calcUtilizationByTeam(filteredCap),  [filteredCap])
  const byEmployee  = useMemo(() => calcUtilizationByEmployee(filteredLog, filteredCap), [filteredLog, filteredCap])
  const byTag       = useMemo(() => calcHoursByTag(filteredLog, TAG_WHITELIST), [filteredLog])
  const tagByEmployee = useMemo(() => calcTagHoursByEmployee(filteredLog, TAG_WHITELIST), [filteredLog])
  const top15TagByEmployee = tagByEmployee.slice(0, 15)

  // Team Utilization per Day (heatmap) — uses filteredCap (team/employee AND
  // date range), per spec, so it reflects the exact period selected above.
  const dayOfWeekHeatmap = useMemo(() => calcTeamUtilizationByDayOfWeek(filteredCap), [filteredCap])

  // byTeam is already sorted descending by utilPct, so the last 6 entries are
  // the lowest 6 — and stay in descending order, matching the Top 5 chart's style.
  const top5    = byTeam.slice(0, 5)
  const bottom6 = byTeam.slice(-6)

  // byEmployee is already sorted descending by utilPct, so the last 5 entries
  // are the lowest 5 — and stay in descending order, matching the Top 5 chart.
  const top5Employees    = byEmployee.slice(0, 5)
  const bottom5Employees = byEmployee.slice(-5)

  // ─── Top/Lowest Employee & Team widgets — same filteredCap/byTeam/byEmployee
  // (main filter + current period) as every other chart above, so these never
  // drift out of sync with the rest of the tab.
  const topTeam        = byTeam.length     > 0 ? byTeam[0]                  : null
  const lowestTeam      = byTeam.length     > 0 ? byTeam[byTeam.length - 1]  : null
  const topEmployee     = byEmployee.length > 0 ? byEmployee[0]              : null
  const lowestEmployee  = byEmployee.length > 0 ? byEmployee[byEmployee.length - 1] : null

  // ─── Week-over-Week — the main filter's current [startDate, endDate] range
  // vs. the immediately preceding range of the same length. Generalizes to
  // "period-over-period" for whatever range width the user has selected, so
  // it stays correct if the main filter isn't set to an exact 7-day window.
  const rangeDays    = differenceInCalendarDays(parseISO(filters.endDate), parseISO(filters.startDate)) + 1
  const prevEndDate   = format(subDays(parseISO(filters.startDate), 1), 'yyyy-MM-dd')
  const prevStartDate = format(subDays(parseISO(prevEndDate), rangeDays - 1), 'yyyy-MM-dd')

  const currentPeriodSummary = useMemo(() => calcCapacitySummary(filteredCap), [filteredCap])
  const previousPeriodRows = useMemo(
    () => filteredCapNoDateRange.filter(r => r.Date && r.Date >= prevStartDate && r.Date <= prevEndDate),
    [filteredCapNoDateRange, prevStartDate, prevEndDate]
  )
  const previousPeriodSummary = useMemo(() => calcCapacitySummary(previousPeriodRows), [previousPeriodRows])
  const weekOverWeekDelta = calcGrowthPct(previousPeriodSummary.util, currentPeriodSummary.util)

  const formatDateRangeLabel = (startStr, endStr) =>
    `${format(parseISO(startStr), 'MMM d')} – ${format(parseISO(endStr), 'MMM d, yyyy')}`
  const currentRangeLabel  = formatDateRangeLabel(filters.startDate, filters.endDate)
  const previousRangeLabel = formatDateRangeLabel(prevStartDate, prevEndDate)

  // ─── Period drill-down modal — opened from a click on any period/team
  // element (YTD month bar, weekly trend point, heatmap cell, team bar).
  // `rows` is always pre-scoped by the caller to the main Team/Employee
  // filter, matching whichever filtered array that chart itself renders from.
  const [periodDrillDown, setPeriodDrillDown] = useState(null) // { label, rows } | null
  function openPeriodDrillDown(label, rows) {
    setPeriodDrillDown({ label, rows })
  }

  function handleMonthBarClick(data) {
    const point = chartPoint(data)
    if (!point?.rangeStart) return
    const rows = filteredCapNoDateRange.filter(r => r.Date && r.Date >= point.rangeStart && r.Date <= point.rangeEnd)
    openPeriodDrillDown(point.monthLabel, rows)
  }

  function handleWeekPointClick(payload) {
    if (!payload?.rangeStart) return
    const rows = filteredCapNoDateRange.filter(r => r.Date && r.Date >= payload.rangeStart && r.Date <= payload.rangeEnd)
    openPeriodDrillDown(
      `${payload.week} (${formatDateRangeLabel(payload.rangeStart, payload.rangeEnd)})`,
      rows
    )
  }

  function handleTeamBarClick(data) {
    const point = chartPoint(data)
    if (!point?.team) return
    const rows = filteredCap.filter(r => r.Team === point.team)
    openPeriodDrillDown(`${point.team} — Team Detail`, rows)
  }

  function handleHeatmapCellClick(dowIndex, team) {
    const rows = filteredCap.filter(r => r.Date && parseISO(r.Date).getDay() === dowIndex && r.Team === team)
    openPeriodDrillDown(`${team} — ${DAY_FULL_NAMES[dowIndex]}`, rows)
  }

  // ─── Weekly Utilization Trend — independent Month dropdown, but still
  // narrowed by the main filter's Team/Employee selections ───────────────────
  // Uses filteredCapNoDateRange (Team/Employee filtered, but not clipped to
  // the main date range) so this chart's own Month dropdown can still reach
  // any month in the sheet, while the Team/Employee filter — the thing this
  // fix is actually about — is no longer ignored.
  const availableTrendMonths = useMemo(() => getAvailableCapacityMonths(filteredCapNoDateRange), [filteredCapNoDateRange])
  const [trendMonth, setTrendMonth] = useState(null)
  const currentMonthKey = format(new Date(), 'yyyy-MM')
  const effectiveTrendMonth =
    trendMonth ?? (availableTrendMonths.includes(currentMonthKey) ? currentMonthKey : (availableTrendMonths[0] || currentMonthKey))
  const [trendYear, trendMonthNum] = effectiveTrendMonth.split('-').map(Number)

  const weeklyTrend = useMemo(
    () => calcWeeklyUtilizationTrend(filteredCapNoDateRange, trendYear, trendMonthNum),
    [filteredCapNoDateRange, trendYear, trendMonthNum]
  )
  const trendDomain = useMemo(() => {
    const vals = weeklyTrend.map(w => w.utilPct)
    if (vals.length === 0) return [0, 100]
    const dataMin = Math.min(...vals)
    const dataMax = Math.max(...vals)
    const pad = Math.max(10, Math.round((dataMax - dataMin) * 0.3))
    return [Math.max(0, Math.floor((dataMin - pad) / 10) * 10), Math.ceil((dataMax + pad) / 10) * 10]
  }, [weeklyTrend])

  const monthSelect = (
    <select
      value={effectiveTrendMonth}
      onChange={e => setTrendMonth(e.target.value)}
      className="filter-input text-xs py-1.5"
    >
      {!availableTrendMonths.includes(effectiveTrendMonth) && (
        <option value={effectiveTrendMonth}>
          {format(new Date(trendYear, trendMonthNum - 1, 1), 'MMMM yyyy')}
        </option>
      )}
      {availableTrendMonths.map(m => {
        const [y, mo] = m.split('-').map(Number)
        return <option key={m} value={m}>{format(new Date(y, mo - 1, 1), 'MMMM yyyy')}</option>
      })}
    </select>
  )

  // Independent date filter for tasks — separate from the global filter bar
  const [taskStartDate, setTaskStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [taskEndDate, setTaskEndDate]     = useState(format(new Date(), 'yyyy-MM-dd'))
  const [taskPage, setTaskPage] = useState(0)

  const filteredTasks = useMemo(
    () => filterTasksByDate(rawTasks, taskStartDate, taskEndDate, 'CREATED DATE'),
    [rawTasks, taskStartDate, taskEndDate]
  )
  const taskStatusByEmployee = useMemo(() => calcTaskStatusByEmployee(filteredTasks), [filteredTasks])
  const taskPivot = useMemo(
    () => buildTasksPivot(filteredTasks).sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1)),
    [filteredTasks]
  )
  const top20TaskStatus = taskStatusByEmployee.slice(0, 20)
  const taskTotalPages  = Math.max(1, Math.ceil(taskPivot.length / TASK_PAGE_SIZE))
  const taskPageRows    = taskPivot.slice(taskPage * TASK_PAGE_SIZE, taskPage * TASK_PAGE_SIZE + TASK_PAGE_SIZE)

  function goToTaskPage(p) {
    setTaskPage(Math.min(Math.max(p, 0), taskTotalPages - 1))
  }

  if (loadingLog || loadingCap) return <LoadingSpinner message="Loading utilization data..." />

  if (errLog || errCap) {
    return (
      <div className="card p-8 text-center mt-6">
        <p className="text-red-400 font-semibold mb-2">Failed to load data</p>
        <p className="text-sm dark:text-white/50 text-brand-500">
          {(errLog || errCap)?.message}
        </p>
        <p className="text-xs mt-3 dark:text-white/30 text-brand-400">
          Make sure VITE_GOOGLE_API_KEY is set in your .env file and the API key has Sheets API access.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-4">
      {/* Top widgets — fixed 2-column layout: Totals / High-Low comparisons / Utilization donuts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard
          label="Total Hours"
          value={kpis.totalLogged.toLocaleString()}
        />
        <KPICard
          label="Total Capacity"
          value={kpis.totalCapacity.toLocaleString()}
        />

        <HighLowSpreadCard
          label="Utilization Comparison Between the Highest and Lowest Performing Teams"
          maxLabel={topTeam?.team} maxValue={topTeam?.utilPct}
          minLabel={lowestTeam?.team} minValue={lowestTeam?.utilPct}
        />
        <HighLowSpreadCard
          label="Highest vs Lowest Employee Utilization"
          maxLabel={topEmployee?.name} maxValue={topEmployee?.utilPct}
          minLabel={lowestEmployee?.name} minValue={lowestEmployee?.utilPct}
        />

        <KPIRingCard
          label="Utilization YTD"
          value={ytd.utilPct}
          sub={`Jan 1 – ${format(parseISO(filters.endDate), 'MMM d, yyyy')}`}
        />
        <KPIRingCard
          label="Overall Utilization"
          value={kpis.utilization}
          sub={utilizationColor(kpis.utilization).label}
        />
      </div>

      {/* Week-over-Week — last widget before the charts begin, full width */}
      <WeekOverWeekCard
        currentUtil={currentPeriodSummary.util}
        previousUtil={previousPeriodSummary.util}
        delta={weekOverWeekDelta}
        currentLabel={currentRangeLabel}
        previousLabel={previousRangeLabel}
      />

      {/* ── Charts ── */}

      <MaximizableChartCard title="YTD Utilization by Month" height={260} modalHeight={460}>
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={ytdMonthly} margin={{ top: 24, bottom: 8 }}>
              <XAxis dataKey="month" tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis domain={[0, 110]} tickFormatter={v => `${Math.round(v)}%`} tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleMonthBarClick}>
                {ytdMonthly.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* Weekly Utilization Trend — Team/Employee filtered, independent Month dropdown */}
      <MaximizableChartCard
        title="Weekly Utilization Trend"
        headerExtra={monthSelect}
        height={280}
        modalHeight={480}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <LineChart data={weeklyTrend} margin={{ top: 28, right: 24, left: 0, bottom: 8 }}>
              <XAxis dataKey="week" tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis domain={trendDomain} tickFormatter={v => `${Math.round(v)}%`} tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="utilPct"
                stroke={TREND_COLOR}
                strokeWidth={3}
                dot={({ key, cx, cy, payload }) => (
                  <circle
                    key={key}
                    cx={cx} cy={cy} r={4} fill={TREND_COLOR} strokeWidth={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleWeekPointClick(payload)}
                  />
                )}
                activeDot={({ key, cx, cy, payload }) => (
                  <circle
                    key={key}
                    cx={cx} cy={cy} r={6} fill={TREND_COLOR} strokeWidth={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleWeekPointClick(payload)}
                  />
                )}
              >
                <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* Team Utilization per Day — Sun-Sat x Team color matrix */}
      <MaximizableChartCard title="Team Utilization per Day" height={320} modalHeight={520}>
        {() => (
          <TeamUtilizationHeatmap
            matrix={dayOfWeekHeatmap.matrix}
            teams={dayOfWeekHeatmap.teams}
            onCellClick={handleHeatmapCellClick}
          />
        )}
      </MaximizableChartCard>

      {/* Top 5 / Bottom 6 teams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MaximizableChartCard title="Top 5 Teams by Utilization" height={280} modalHeight={480}>
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={top5} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                  {top5.map((entry, i) => (
                    <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>

        <MaximizableChartCard title="Bottom 6 Teams by Utilization" height={280} modalHeight={480}>
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={bottom6} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                  {bottom6.map((entry, i) => (
                    <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>
      </div>

      {/* Utilization by Team — full chart */}
      <MaximizableChartCard title="Utilization by Team" headerExtra={UTIL_LEGEND_EXTRA} height={280} modalHeight={480}>
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={byTeam} margin={{ top: 24, bottom: 40 }}>
              <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
              <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                {byTeam.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* Top 5 / Bottom 5 employees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MaximizableChartCard title="Top 5 Employees by Utilization" height={280} modalHeight={480}>
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={top5Employees} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
                  {top5Employees.map((entry, i) => (
                    <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>

        <MaximizableChartCard title="Bottom 5 Employees by Utilization" height={280} modalHeight={480}>
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={bottom5Employees} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
                  {bottom5Employees.map((entry, i) => (
                    <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>
      </div>

      {/* Utilization by Employee — full chart (all employees) */}
      <MaximizableChartCard
        title={`Utilization by Employee — All (${byEmployee.length})`}
        height={380}
        modalHeight={520}
      >
        {h => (
          // Wide, horizontally-scrollable canvas — enough per-bar width to keep
          // each rotated employee name legible even with 30+ employees.
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(900, byEmployee.length * 70) }}>
              <ResponsiveContainer width="100%" height={h}>
                <BarChart data={byEmployee} margin={{ top: 24, bottom: 90 }}>
                  <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                    angle={-35} textAnchor="end" interval={0} />
                  <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
                    {byEmployee.map((entry, i) => (
                      <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                    ))}
                    <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </MaximizableChartCard>

      {/* Employee table */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Utilization by Employee
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Employee', 'Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                         dark:text-white/50 text-brand-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((emp, i) => (
                <tr
                  key={emp.name}
                  className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                >
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{emp.name}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{emp.team}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{emp.logged.toLocaleString()}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{emp.capacity.toLocaleString()}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold" style={{ color: utilizationColor(emp.utilPct).bg }}>
                        {emp.utilPct}%
                      </span>
                      <UtilBadge pct={emp.utilPct} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Time Log Tags — overall distribution */}
      <MaximizableChartCard title="Hours by Time Log Tag" height={320} modalHeight={460}>
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <PieChart>
              <Pie
                data={byTag}
                dataKey="hours"
                nameKey="tag"
                innerRadius={65}
                outerRadius={105}
                paddingAngle={2}
                label={({ tag, hours, percent }) => `${tag}: ${fmtHours(hours)}h (${fmtPct(percent * 100)}%)`}
                labelLine={{ stroke: 'currentColor', strokeOpacity: 0.4 }}
              >
                {byTag.map((entry, i) => (
                  <Cell key={i} fill={TAG_COLOR_MAP[entry.tag]} />
                ))}
              </Pie>
              <Tooltip content={<TagPieTooltip />} />
              <RechartsLegend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* Time Log Tags — per employee */}
      <MaximizableChartCard
        title="Hours by Time Log Tag per Employee (Top 15)"
        height={380}
        modalHeight={560}
      >
        {h => (
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(700, top15TagByEmployee.length * 70) }}>
              <ResponsiveContainer width="100%" height={h}>
                <BarChart data={top15TagByEmployee} margin={{ top: 32, bottom: 90 }}>
                  <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                    angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={fmtHours} />
                  <Tooltip content={<TagHoursTooltip />} />
                  <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
                  {TAG_WHITELIST.map((tag, i) => {
                    const maxTotal = Math.max(...top15TagByEmployee.map(d => d.total), 1)
                    const labelFmt = v => (v > 0 && v / maxTotal > 0.04 ? fmtHours(v) : '')
                    return (
                      <Bar
                        key={tag}
                        dataKey={tag}
                        name={tag}
                        stackId="a"
                        fill={TAG_COLOR_MAP[tag]}
                        radius={i === TAG_WHITELIST.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                      >
                        <LabelList dataKey={tag} position="center" formatter={labelFmt}
                          style={{ fill: TAG_TEXT_MAP[tag], fontSize: 10, fontWeight: 700 }} />
                      </Bar>
                    )
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </MaximizableChartCard>

      {/* Tasks — Complete vs In Progress by employee */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider dark:text-white/50 text-brand-500">
          Task Created Date
        </span>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">From</label>
          <input
            type="date"
            value={taskStartDate}
            onChange={e => { setTaskStartDate(e.target.value); setTaskPage(0) }}
            className="filter-input"
          />
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">To</label>
          <input
            type="date"
            value={taskEndDate}
            onChange={e => { setTaskEndDate(e.target.value); setTaskPage(0) }}
            className="filter-input"
          />
        </div>
        <span className="text-xs dark:text-white/40 text-brand-400">
          Independent of the global date filter above — applies only to the task sections below
        </span>
      </div>

      {loadingTasks ? (
        <LoadingSpinner message="Loading tasks data..." />
      ) : errTasks ? (
        <div className="card p-8 text-center">
          <p className="text-red-400 font-semibold">{errTasks.message}</p>
        </div>
      ) : (
        <>
          <MaximizableChartCard
            title="Tasks Complete vs In Progress by Employee (Top 20)"
            height={420}
            modalHeight={560}
          >
            {h => (
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(900, top20TaskStatus.length * 60) }}>
                  <ResponsiveContainer width="100%" height={h}>
                    <BarChart data={top20TaskStatus} margin={{ top: 24, bottom: 90 }}>
                      <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                        angle={-35} textAnchor="end" interval={0} />
                      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} />
                      <Tooltip content={<GenericTooltip />} />
                      <RechartsLegend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="complete" name="Complete" stackId="a" fill={COMPLETE_COLOR} radius={[0, 0, 0, 0]}>
                        <LabelList dataKey="complete" position="center"
                          formatter={v => (v > 0 ? v : '')} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
                      </Bar>
                      <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={IN_PROGRESS_COLOR} radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="inProgress" position="center"
                          formatter={v => (v > 0 ? v : '')} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </MaximizableChartCard>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">
                Task Details {taskPivot.length > 0 && (
                  <span className="dark:text-white/40 text-brand-400 font-normal">
                    ({taskPivot.length.toLocaleString()} tasks, sorted by most overdue)
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 text-xs dark:text-white/50 text-brand-500">
                <button
                  onClick={() => goToTaskPage(taskPage - 1)}
                  disabled={taskPage === 0}
                  className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30"
                >
                  ‹ Prev
                </button>
                <span>Page {taskPage + 1} of {taskTotalPages}</span>
                <button
                  onClick={() => goToTaskPage(taskPage + 1)}
                  disabled={taskPage >= taskTotalPages - 1}
                  className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30"
                >
                  Next ›
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-white/10 border-brand-200">
                    {['Task Name', 'Assignee', 'Created', 'Start', 'End (Due)', 'Closed', 'Overdue Days'].map(h => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                             dark:text-white/50 text-brand-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {taskPageRows.map((t, i) => (
                    <tr
                      key={t.taskId + i}
                      className={`border-b dark:border-white/5 border-brand-100
                        ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                    >
                      <td className="py-2 px-3 font-medium dark:text-white text-brand-900 max-w-[240px] truncate">{t.taskName || '—'}</td>
                      <td className="py-2 px-3 dark:text-white/70 text-brand-600 max-w-[200px] truncate">{t.assignee || '—'}</td>
                      <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.createdDate || '—'}</td>
                      <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.startDate || '—'}</td>
                      <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.endDate || '—'}</td>
                      <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.closedDate || '—'}</td>
                      <td className="py-2 px-3">
                        {t.overdueDays === null ? (
                          <span className="dark:text-white/30 text-brand-300">—</span>
                        ) : t.overdueDays > 0 ? (
                          <span className="font-semibold" style={{ color: '#6858a2' }}>{t.overdueDays}d</span>
                        ) : (
                          <span className="dark:text-white/50 text-brand-500">0d</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <PeriodDrillDownModal drillDown={periodDrillDown} onClose={() => setPeriodDrillDown(null)} />
    </div>
  )
}
