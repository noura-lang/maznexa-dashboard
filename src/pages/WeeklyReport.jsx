import { useMemo, useState } from 'react'
import { format, parseISO, subDays, differenceInCalendarDays } from 'date-fns'
import { useRawTimeLog, useCapacity2026, useTasks } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import { useTheme } from '../context/ThemeContext'
import {
  filterRows, filterCapacityRows,
  calcOverallKPIs, calcUtilizationByTeam, calcUtilizationByEmployee,
  calcWeeklyUtilizationTrend, getAvailableCapacityMonths,
  calcYTDUtilization, calcYTDMonthlyTrend, calcTeamUtilizationByDayOfWeek,
  utilizationColor, calcHoursByTag, calcTagHoursByEmployee, calcEmployeeHoursByTag,
  filterTasksByDate, calcTaskStatusByEmployee, buildTasksPivot, calcOverdueTaskCountByEmployee,
  getEmployeeTasksInRange, calcTaskSummaryByEmployee, filterTasksByAllowedNames,
  calcCapacityByEmployeeForWeeklyReport, calcTeamUtilizationSummaryForWeeklyReport,
  calcCapacitySummaryForWeeklyReport, calcGrowthPct,
} from '../api/transformData'
import { SEQUENTIAL_STOPS, CHART_COLORS, sequentialColor } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import TeamworkLink from '../components/common/TeamworkLink'
import Dropdown from '../components/common/Dropdown'
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
  { label: 'Professional',range: '> 95%',  color: SEQUENTIAL_STOPS[5] },
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
// Task Details' MaximizableChartCard uses `h === TASK_DETAILS_MODAL_HEIGHT`
// (the render-prop's height argument) to detect "am I rendering inside the
// maximized modal" — the modal shows the full unpaginated task list with no
// Prev/Next controls, the compact card shows the normal paginated view.
const TASK_DETAILS_HEIGHT = 500
const TASK_DETAILS_MODAL_HEIGHT = 700

const TAG_WHITELIST = ['Meeting', 'Reporting', 'Follow up', 'Brainstorming', 'Research', 'Training']
const DAY_FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Fixed tag -> color/text mapping (not rank-based) so the same tag always
// gets the same color across the pie chart and the per-employee chart.
const TAG_COLOR_MAP = Object.fromEntries(TAG_WHITELIST.map((tag, i) => [tag, SEQUENTIAL_STOPS[i]]))
const TAG_TEXT_MAP  = Object.fromEntries(TAG_WHITELIST.map((tag, i) => [tag, i <= 3 ? '#1a0e3d' : '#ffffff']))

// ─── Dark Mode bar "depth" (Weekly Report only) ───────────────────────────
// Every bar-chart color used on this tab (utilizationColor's 6 stops, the
// Overdue Tasks chart's sequentialColor ramp, and the two fixed
// Complete/In-Progress colors) is one of these same 7 hex values — CHART_COLORS
// is their exact superset. That makes a fixed, pre-computed gradient per
// color tractable instead of generating one dynamically per render.
function shadeColor(hex, percent) {
  const h = hex.replace('#', '')
  const num = parseInt(h, 16)
  const amt = Math.round(2.55 * percent)
  const clamp = v => Math.max(0, Math.min(255, v))
  const r = clamp((num >> 16) + amt)
  const g = clamp(((num >> 8) & 0x00ff) + amt)
  const b = clamp((num & 0x0000ff) + amt)
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`
}

const barGradientId = hex => `wr-bar-grad-${hex.replace('#', '')}`

// Lighter-top/darker-bottom vertical gradient per color, only swapped in for
// Dark Mode — Light Mode keeps its existing flat Cell/Bar fills untouched.
function barFill(hex, isDark) {
  return isDark ? `url(#${barGradientId(hex)})` : hex
}

// Rendered ONCE for the whole tab (see <BarDepthDefsRoot/> in the main
// component's return) — NOT once per chart. Every one of this tab's ~10
// <BarChart> instances renders its own separate <svg>; earlier this
// component was dropped into each of them individually, which meant the
// SAME 7 gradient `id`s existed many times over in the document. `id` must
// be document-unique — with duplicates, `fill="url(#id)"` resolution across
// sibling SVGs is undefined/browser-dependent, and can silently resolve to
// nothing (an invisible bar, geometry and label unaffected) instead of a
// color. A single shared <defs> — referenced across every chart's own SVG
// via the same `url(#id)` mechanism, which works fine across sibling SVGs
// as long as the id is unique — removes the collision entirely. This was
// the "YTD Utilization by Month" bars-invisible bug.
function BarDepthDefsRoot() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {CHART_COLORS.map(c => (
          <linearGradient key={c} id={barGradientId(c)} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shadeColor(c, 18)} />
            <stop offset="100%" stopColor={shadeColor(c, -18)} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  )
}

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
            <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                           dark:text-white/50 text-brand-500 sticky left-0">
              Day
            </th>
            {teams.map(team => (
              <th key={team} className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider
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

  const employees = calcCapacityByEmployeeForWeeklyReport(rows).sort((a, b) => b.util - a.util)
  const teams     = calcTeamUtilizationSummaryForWeeklyReport(rows)
  const summary   = calcCapacitySummaryForWeeklyReport(rows)

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
                <h4 className="text-xs font-medium uppercase tracking-wider mb-2 dark:text-white/50 text-brand-500">
                  By Team
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      {['Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
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
                <h4 className="text-xs font-medium uppercase tracking-wider mb-2 dark:text-white/50 text-brand-500">
                  By Employee
                </h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      {['Employee', 'Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
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

// Employee's task list — opened by clicking a bar in "Hours by Time Log Tag
// per Employee". `tasks` is already scoped to that employee + the tab's
// active date range by the caller. Same modal shell/style as
// PeriodDrillDownModal above.
function EmployeeTasksModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { name, tasks } = drillDown

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200
                   dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-base font-semibold dark:text-white text-brand-900">{name} — Tasks</h3>
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

        <div className="overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No tasks found for this employee in the current period.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Task Name', 'Status', 'Created', 'Due Date'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={i} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900 max-w-[260px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate" title={t.taskName}>{t.taskName || '—'}</span>
                        <TeamworkLink taskId={t.taskId} />
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: t.status === 'Complete' ? COMPLETE_COLOR : IN_PROGRESS_COLOR,
                          color: t.status === 'Complete' ? '#ffffff' : '#1a0e3d',
                        }}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.createdDate || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.dueDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// Per-tag employee breakdown — opened by clicking a slice of the "Hours by
// Time Log Tag" donut. `employees` is already scoped to that tag + the
// current filters by the caller. Same modal shell/style as the others above.
function TagEmployeesModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { tag, employees } = drillDown

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200
                   dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-base font-semibold dark:text-white text-brand-900">{tag} — by Employee</h3>
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

        <div className="overflow-y-auto p-4">
          {employees.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No hours logged under this tag for the current filters.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Employee', 'Hours'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500">
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
                    <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">{fmtHours(e.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      style={{ minHeight: UTIL_WIDGET_MIN_HEIGHT }}
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

const UTILIZATION_TARGET = 88
// Shared explicit height for the Utilization Target gauge and Week-over-Week
// cards, so they always match regardless of their differing internal
// content shapes (a semi-circle SVG vs. plain text lines) — inline style,
// not a Tailwind arbitrary class, since the value needs to be a real shared
// constant rather than a string Tailwind's build-time scanner can pick up.
const UTIL_WIDGET_MIN_HEIGHT = 200

// Semi-circle progress gauge vs. a fixed 88% target. Arc color turns green
// once the current period's Overall Utilization reaches/exceeds the target
// (a clear positive signal), brand purple otherwise.
function UtilizationTargetGauge({ current, target = UTILIZATION_TARGET }) {
  const pct = Math.max(0, Math.min(100, Math.round(current)))
  const diff = pct - target
  const isAbove = diff >= 0
  const arcColor = isAbove ? '#22c55e' : '#9354ff'
  const data = [{ v: pct }, { v: Math.max(0, 100 - pct) }]
  // Wrapper div and ResponsiveContainer must share the same explicit height —
  // a mismatch here (previously 110px wrapper vs. 190px chart) is what let
  // the SVG spill past its box and overlap the "Target" text below it.
  // Sized so title + gauge + target line + remaining line fit UTIL_WIDGET_MIN_HEIGHT
  // (matching Week-over-Week's card height) without cramming or empty space.
  const GAUGE_HEIGHT = 90
  // Fixed pixel radii (not percentages) — percentage radii on a semi-circle
  // (cy at the very bottom) get sized by Recharts as if fitting a FULL circle
  // in the box, which can shrink the visible arc unpredictably and put the
  // hollow center's actual pixel bounds somewhere other than where the "85%"
  // label was positioned, reading as an overlap. Fixed px values make both
  // the arc and the label's safe zone deterministic.
  const OUTER_R = 78
  const INNER_R = 42

  return (
    <div
      className="card p-5 flex flex-col items-center justify-center gap-2 rounded-2xl w-full
                 bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                 from-brand-200/70 via-brand-100/30 to-transparent"
      style={{ minHeight: UTIL_WIDGET_MIN_HEIGHT }}
    >
      {/* 1. Title */}
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500 text-center">
        Utilization Target
      </p>

      {/* 2. Gauge, with its own dedicated space */}
      <div className="relative w-full" style={{ height: GAUGE_HEIGHT }}>
        <ResponsiveContainer width="100%" height={GAUGE_HEIGHT}>
          <PieChart>
            <Pie
              data={data}
              dataKey="v"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={INNER_R}
              outerRadius={OUTER_R}
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={arcColor} />
              <Cell fill="rgba(140,143,254,0.15)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* 3. Current utilization — anchored inside the guaranteed-hollow
            band (radius < INNER_R, i.e. never reaches the colored arc),
            centered on the semi-circle's horizontal diameter (cy). */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-end justify-center"
          style={{ height: INNER_R }}
        >
          <span className="text-3xl font-bold leading-none" style={{ color: arcColor }}>{pct}%</span>
        </div>
      </div>

      {/* 4. Target, on its own line */}
      <p className="text-xs dark:text-white/60 text-brand-600">
        Target: <span className="font-semibold dark:text-white text-brand-900">{target}%</span>
      </p>

      {/* 5. Remaining/above target, on its own line */}
      <p className={`text-xs font-semibold ${isAbove ? 'text-green-400' : 'dark:text-white/60 text-brand-600'}`}>
        {isAbove ? `+${diff}% above target` : `${Math.abs(diff)}% remaining to reach target`}
      </p>
    </div>
  )
}

export default function WeeklyReport() {
  const { isDark } = useTheme()
  const filters = useFilters()
  const { data: rawRows = [], isLoading: loadingLog, error: errLog } = useRawTimeLog()
  const { data: capRows = [], isLoading: loadingCap, error: errCap } = useCapacity2026()
  const { data: rawTasks = [], isLoading: loadingTasks, error: errTasks } = useTasks()

  const filteredLog = useMemo(() => filterRows(rawRows, filters),        [rawRows, filters])
  const filteredCap = useMemo(() => filterCapacityRows(capRows, filters), [capRows, filters])

  const kpis        = useMemo(() => calcOverallKPIs(filteredCap), [filteredCap])

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
  const byEmployee  = useMemo(() => calcUtilizationByEmployee(filteredCap), [filteredCap])
  const byTag       = useMemo(() => calcHoursByTag(filteredLog, TAG_WHITELIST), [filteredLog])
  const tagByEmployee = useMemo(() => calcTagHoursByEmployee(filteredLog, TAG_WHITELIST), [filteredLog])
  const top15TagByEmployee = tagByEmployee.slice(0, 15)

  // Team Utilization per Day (heatmap) — uses filteredCap (team/employee AND
  // date range), per spec, so it reflects the exact period selected above.
  const dayOfWeekHeatmap = useMemo(() => calcTeamUtilizationByDayOfWeek(filteredCap), [filteredCap])
  // Flattened for export only — the heatmap's own matrix/teams shape (one row
  // per day, one cell object per team) isn't directly spreadsheet-able.
  const heatmapExportRows = useMemo(
    () => dayOfWeekHeatmap.matrix.map(row => ({
      day: row.day,
      ...Object.fromEntries(row.cells.map(c => [c.team, c])),
    })),
    [dayOfWeekHeatmap]
  )
  const heatmapExportColumns = useMemo(() => [
    { key: 'day', label: 'Day' },
    ...dayOfWeekHeatmap.teams.map(team => ({
      key: team,
      label: team,
      format: cell => (cell?.isOffDay ? 'Off Day' : `${cell?.utilPct ?? 0}%`),
    })),
  ], [dayOfWeekHeatmap])

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

  const currentPeriodSummary = useMemo(() => calcCapacitySummaryForWeeklyReport(filteredCap), [filteredCap])
  const previousPeriodRows = useMemo(
    () => filteredCapNoDateRange.filter(r => r.Date && r.Date >= prevStartDate && r.Date <= prevEndDate),
    [filteredCapNoDateRange, prevStartDate, prevEndDate]
  )
  const previousPeriodSummary = useMemo(() => calcCapacitySummaryForWeeklyReport(previousPeriodRows), [previousPeriodRows])
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

  // ─── "Hours by Time Log Tag per Employee" drill-down — click any segment
  // of an employee's stacked bar to see their task list (Tasks sheet),
  // scoped to that employee + the tab's active main-filter date range.
  const [employeeTasksDrillDown, setEmployeeTasksDrillDown] = useState(null) // { name, tasks } | null
  function handleTagPerEmployeeBarClick(data) {
    const point = chartPoint(data)
    if (!point?.name) return
    const tasks = getEmployeeTasksInRange(rawTasks, point.name, filters.startDate, filters.endDate)
    setEmployeeTasksDrillDown({ name: point.name, tasks })
  }

  // ─── "Hours by Time Log Tag" donut drill-down — click a slice to see every
  // employee who logged hours under that tag, from the same filteredLog rows
  // the donut itself was built from.
  const [tagEmployeesDrillDown, setTagEmployeesDrillDown] = useState(null) // { tag, employees } | null
  function handleTagPieClick(data) {
    const point = chartPoint(data)
    if (!point?.tag) return
    const employees = calcEmployeeHoursByTag(filteredLog, point.tag)
    setTagEmployeesDrillDown({ tag: point.tag, employees })
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

  const monthSelectOptions = [
    ...(!availableTrendMonths.includes(effectiveTrendMonth)
      ? [{ value: effectiveTrendMonth, label: format(new Date(trendYear, trendMonthNum - 1, 1), 'MMMM yyyy') }]
      : []),
    ...availableTrendMonths.map(m => {
      const [y, mo] = m.split('-').map(Number)
      return { value: m, label: format(new Date(y, mo - 1, 1), 'MMMM yyyy') }
    }),
  ]

  const monthSelect = (
    <Dropdown
      options={monthSelectOptions}
      value={effectiveTrendMonth}
      onChange={setTrendMonth}
      buttonClassName="text-xs py-1.5"
    />
  )

  // Independent date filter for tasks — separate from the global filter bar
  const [taskStartDate, setTaskStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [taskEndDate, setTaskEndDate]     = useState(format(new Date(), 'yyyy-MM-dd'))
  const [taskPage, setTaskPage] = useState(0)

  // Data Scope enforcement (My Data Only / My Team Only / All Employees) for
  // every task-based widget below (Task Status, Task Details pivot, Overdue
  // by Employee) — same allowedNames pattern Task Details tab's own charts
  // already use. Built from the full, unfiltered rawTasks/capRows (not
  // filteredTasks) so team resolution never depends on this section's own
  // independent date filter.
  const taskSummaryFull = useMemo(
    () => calcTaskSummaryByEmployee(rawTasks, capRows),
    [rawTasks, capRows]
  )
  const filteredEmployeeNames = useMemo(() => {
    const scoped = taskSummaryFull.filter(e =>
      (filters.selectedTeams.length === 0 || filters.selectedTeams.includes(e.team)) &&
      (filters.selectedEmployees.length === 0 || filters.selectedEmployees.includes(e.name))
    )
    return new Set(scoped.map(e => e.name))
  }, [taskSummaryFull, filters.selectedTeams, filters.selectedEmployees])

  const filteredTasks = useMemo(() => {
    const byDate = filterTasksByDate(rawTasks, taskStartDate, taskEndDate, 'CREATED DATE')
    return filterTasksByAllowedNames(byDate, filteredEmployeeNames)
  }, [rawTasks, taskStartDate, taskEndDate, filteredEmployeeNames])
  const taskStatusByEmployee = useMemo(() => calcTaskStatusByEmployee(filteredTasks), [filteredTasks])
  const taskPivot = useMemo(
    () => buildTasksPivot(filteredTasks).sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1)),
    [filteredTasks]
  )
  const allTaskStatus = taskStatusByEmployee

  // Overdue Tasks by Employee — same filteredTasks the Task Details pivot
  // above renders (Overdue Days > 0, now also Team/Employee Data Scope
  // scoped). Team looked up from the full, unfiltered Capacity rows so the
  // Business Development/Trainees exclusion is reliable regardless of scope.
  const overdueByEmployee = useMemo(
    () => calcOverdueTaskCountByEmployee(filteredTasks, capRows),
    [filteredTasks, capRows]
  )
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
    <div className="space-y-6 pt-4 weekly-report-tab">
      <BarDepthDefsRoot />

      {/* Top widgets — fixed 2-column layout: Totals / High-Low comparisons / Utilization donuts.
          Wrapped as one combined data-pdf-section — this whole block is "page 1's
          KPI cards" for the PDF export, captured and placed as a single unit. */}
      <div data-pdf-section data-pdf-title="KPI Summary" className="space-y-6">
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

      {/* Utilization Target gauge — near the YTD/Overall Utilization donuts above */}
      <UtilizationTargetGauge current={kpis.utilization} />

      {/* Week-over-Week — last widget before the charts begin, full width */}
      <WeekOverWeekCard
        currentUtil={currentPeriodSummary.util}
        previousUtil={previousPeriodSummary.util}
        delta={weekOverWeekDelta}
        currentLabel={currentRangeLabel}
        previousLabel={previousRangeLabel}
      />
      </div>

      {/* ── Charts ── */}

      <MaximizableChartCard
        title="YTD Utilization by Month"
        height={260}
        modalHeight={460}
        exportRows={ytdMonthly}
        exportColumns={[
          { key: 'month', label: 'Month' },
          { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
        ]}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={ytdMonthly} margin={{ top: 24, bottom: 8 }}>
              <XAxis dataKey="month" tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis domain={[0, 110]} tickFormatter={v => `${Math.round(v)}%`} tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleMonthBarClick}>
                {ytdMonthly.map((entry, i) => (
                  <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
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
        exportRows={weeklyTrend}
        exportColumns={[
          { key: 'week', label: 'Week' },
          { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
        ]}
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
      <MaximizableChartCard
        title="Team Utilization per Day"
        height={320}
        modalHeight={520}
        exportRows={heatmapExportRows}
        exportColumns={heatmapExportColumns}
      >
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
        <MaximizableChartCard
          title="Top 5 Teams by Utilization"
          height={280}
          modalHeight={480}
          exportRows={top5}
          exportColumns={[
            { key: 'team', label: 'Team' },
            { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
          ]}
        >
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={top5} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                  {top5.map((entry, i) => (
                    <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>

        <MaximizableChartCard
          title="Bottom 6 Teams by Utilization"
          height={280}
          modalHeight={480}
          exportRows={bottom6}
          exportColumns={[
            { key: 'team', label: 'Team' },
            { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
          ]}
        >
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={bottom6} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                  {bottom6.map((entry, i) => (
                    <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>
      </div>

      {/* Utilization by Team — full chart */}
      <MaximizableChartCard
        title="Utilization by Team"
        headerExtra={UTIL_LEGEND_EXTRA}
        height={280}
        modalHeight={480}
        exportRows={byTeam}
        exportColumns={[
          { key: 'team', label: 'Team' },
          { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
        ]}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={byTeam} margin={{ top: 24, bottom: 40 }}>
              <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
              <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[6, 6, 0, 0]} cursor="pointer" onClick={handleTeamBarClick}>
                {byTeam.map((entry, i) => (
                  <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
                ))}
                <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* Top 5 / Bottom 5 employees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MaximizableChartCard
          title="Top 5 Employees by Utilization"
          height={280}
          modalHeight={480}
          exportRows={top5Employees}
          exportColumns={[
            { key: 'name', label: 'Employee' },
            { key: 'team', label: 'Team' },
            { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
          ]}
        >
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={top5Employees} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
                  {top5Employees.map((entry, i) => (
                    <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
                  ))}
                  <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </MaximizableChartCard>

        <MaximizableChartCard
          title="Bottom 5 Employees by Utilization"
          height={280}
          modalHeight={480}
          exportRows={bottom5Employees}
          exportColumns={[
            { key: 'name', label: 'Employee' },
            { key: 'team', label: 'Team' },
            { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
          ]}
        >
          {h => (
            <ResponsiveContainer width="100%" height={h}>
              <BarChart data={bottom5Employees} margin={{ top: 24, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
                <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
                  {bottom5Employees.map((entry, i) => (
                    <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
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
        exportRows={byEmployee}
        exportColumns={[
          { key: 'name', label: 'Employee' },
          { key: 'team', label: 'Team' },
          { key: 'logged', label: 'Logged (hrs)' },
          { key: 'capacity', label: 'Capacity (hrs)' },
          { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
        ]}
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
                      <Cell key={i} fill={barFill(utilizationColor(entry.utilPct).bg, isDark)} />
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
      <MaximizableChartCard
        title="Utilization by Employee"
        exportRows={byEmployee}
        exportColumns={[
          { key: 'name', label: 'Employee' },
          { key: 'team', label: 'Team' },
          { key: 'logged', label: 'Logged (hrs)' },
          { key: 'capacity', label: 'Capacity (hrs)' },
          { key: 'utilPct', label: 'Utilization %', format: v => `${Math.round(v)}%` },
        ]}
      >
        {() => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Employee', 'Team', 'Logged (hrs)', 'Capacity (hrs)', 'Utilization'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
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
                        <span className="font-semibold dark:text-white text-brand-900">
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
        )}
      </MaximizableChartCard>

      {/* Time Log Tags — overall distribution */}
      <MaximizableChartCard
        title="Hours by Time Log Tag"
        height={320}
        modalHeight={460}
        exportRows={byTag}
        exportColumns={[
          { key: 'tag', label: 'Tag' },
          { key: 'hours', label: 'Hours', format: fmtHours },
        ]}
      >
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
                cursor="pointer"
                onClick={handleTagPieClick}
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
        exportRows={top15TagByEmployee}
        exportColumns={[
          { key: 'name', label: 'Employee' },
          ...TAG_WHITELIST.map(tag => ({ key: tag, label: tag, format: fmtHours })),
          { key: 'total', label: 'Total (hrs)', format: fmtHours },
        ]}
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
                        fill={barFill(TAG_COLOR_MAP[tag], isDark)}
                        radius={i === TAG_WHITELIST.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                        cursor="pointer"
                        onClick={handleTagPerEmployeeBarClick}
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
        <span className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
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
        <span className="text-xs font-light dark:text-white/40 text-brand-400">
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
            title={`Tasks Complete vs In Progress by Employee — All (${allTaskStatus.length})`}
            height={420}
            modalHeight={560}
            exportRows={allTaskStatus}
            exportColumns={[
              { key: 'name', label: 'Employee' },
              { key: 'complete', label: 'Complete' },
              { key: 'inProgress', label: 'In Progress' },
            ]}
          >
            {h => (
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(900, allTaskStatus.length * 60) }}>
                  <ResponsiveContainer width="100%" height={h}>
                    <BarChart data={allTaskStatus} margin={{ top: 32, bottom: 90 }}>
                      <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                        angle={-35} textAnchor="end" interval={0} />
                      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} />
                      <Tooltip content={<GenericTooltip />} />
                      <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
                      <Bar dataKey="complete" name="Complete" stackId="a" fill={barFill(COMPLETE_COLOR, isDark)} radius={[0, 0, 0, 0]}>
                        <LabelList dataKey="complete" position="center"
                          formatter={v => (v > 0 ? v : '')} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
                      </Bar>
                      <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={barFill(IN_PROGRESS_COLOR, isDark)} radius={[6, 6, 0, 0]}>
                        <LabelList dataKey="inProgress" position="center"
                          formatter={v => (v > 0 ? v : '')} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </MaximizableChartCard>

          {/* Overdue Tasks by Employee — same task rows as Task Details below,
              Overdue Days > 0 only, Business Development & Trainees excluded */}
          <MaximizableChartCard
            title="Overdue Tasks by Employee"
            height={380}
            modalHeight={520}
            exportRows={overdueByEmployee}
            exportColumns={[
              { key: 'name', label: 'Employee' },
              { key: 'count', label: 'Overdue Tasks' },
            ]}
          >
            {h => (
              overdueByEmployee.length === 0 ? (
                <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
                  No overdue tasks for the current filters.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <div style={{ minWidth: Math.max(900, overdueByEmployee.length * 60) }}>
                    <ResponsiveContainer width="100%" height={h}>
                      <BarChart data={overdueByEmployee} margin={{ top: 24, bottom: 90 }}>
                        <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                          angle={-35} textAnchor="end" interval={0} />
                        <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} allowDecimals={false} />
                        <Tooltip content={<GenericTooltip />} />
                        <Bar dataKey="count" name="Overdue Tasks" radius={[6, 6, 0, 0]}>
                          {overdueByEmployee.map((_, i) => (
                            <Cell key={i} fill={barFill(sequentialColor(i, overdueByEmployee.length), isDark)} />
                          ))}
                          <LabelList dataKey="count" position="top" style={axisLabelStyle} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
            )}
          </MaximizableChartCard>

          <MaximizableChartCard
            title={taskPivot.length > 0
              ? `Task Details (${taskPivot.length.toLocaleString()} tasks, sorted by most overdue)`
              : 'Task Details'}
            height={TASK_DETAILS_HEIGHT}
            modalHeight={TASK_DETAILS_MODAL_HEIGHT}
            exportRows={taskPivot}
            exportColumns={[
              { key: 'taskName', label: 'Task Name' },
              { key: 'assignee', label: 'Assignee' },
              { key: 'createdDate', label: 'Created' },
              { key: 'startDate', label: 'Start' },
              { key: 'endDate', label: 'End (Due)' },
              { key: 'closedDate', label: 'Closed' },
              { key: 'overdueDays', label: 'Overdue Days', format: v => (v === null ? '' : v) },
            ]}
          >
            {h => {
              const maximized = h === TASK_DETAILS_MODAL_HEIGHT
              const rows = maximized ? taskPivot : taskPageRows
              return (
                <>
                  {!maximized && (
                    <div className="flex items-center justify-end gap-2 text-xs dark:text-white/50 text-brand-500 mb-3">
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
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b dark:border-white/10 border-brand-200">
                          {['Task Name', 'Assignee', 'Created', 'Start', 'End (Due)', 'Closed', 'Overdue Days'].map(hd => (
                            <th key={hd} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                                   dark:text-white/50 text-brand-500 whitespace-nowrap">
                              {hd}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((t, i) => (
                          <tr
                            key={t.taskId + i}
                            className={`border-b dark:border-white/5 border-brand-100
                              ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                          >
                            <td className="py-2 px-3 font-medium dark:text-white text-brand-900 max-w-[240px]">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate" title={t.taskName}>{t.taskName || '—'}</span>
                                <TeamworkLink taskId={t.taskId} />
                              </div>
                            </td>
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
                </>
              )
            }}
          </MaximizableChartCard>
        </>
      )}

      <PeriodDrillDownModal drillDown={periodDrillDown} onClose={() => setPeriodDrillDown(null)} />
      <EmployeeTasksModal drillDown={employeeTasksDrillDown} onClose={() => setEmployeeTasksDrillDown(null)} />
      <TagEmployeesModal drillDown={tagEmployeesDrillDown} onClose={() => setTagEmployeesDrillDown(null)} />
    </div>
  )
}
