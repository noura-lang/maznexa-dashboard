import { useEffect, useMemo, useRef, useState } from 'react'
import { format, subDays, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import { useCapacity2025, useCapacity2026, useRawTimeLog } from '../hooks/useSheetData'
import {
  filterCapacityByMonth, filterCapacityByQuarter, filterCapacityYTD, calcYearlyComparison, calcQuarterlyComparison,
  calcMonthlyUtilizationTrend, calcTeamUtilizationSummary, calcCapacitySummary,
  calcComparisonByTeam, calcComparisonByEmployee, calcCapacityByEmployee, calcGrowthPct, utilizationColor,
  getUniqueCapacityTeams, getUniqueCapacityEmployees, getActiveEmployeeNames,
  filterTimeLogByMonth, filterTimeLogByQuarter, calcHoursByProject,
} from '../api/transformData'
import MultiSelect from '../components/common/MultiSelect'
import Dropdown from '../components/common/Dropdown'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Greeting from '../components/common/Greeting'
import ChartTitleBadge from '../components/common/ChartTitleBadge'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import SortableTh from '../components/common/SortableTh'
import { useSortableRows } from '../hooks/useSortableRows'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { DATA_SCOPES, DEFAULT_DENIED_PERMISSIONS } from '../api/accessSheetApi'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend as RechartsLegend, Cell, LabelList, PieChart, Pie,
  ComposedChart, Line,
} from 'recharts'

const COLOR_2025 = '#6858a2' // primary purple
const COLOR_2026 = '#8c8ffe' // secondary blue
const GROWTH_COLOR = '#3d2b7a' // darkest purple, for the growth-% line
const EMP_COUNT_COLOR = '#e6b800' // gold, distinct from the utilization bars/growth line sharing this chart

const fmtHours = v => Number(v ?? 0).toFixed(2)
const fmtPct   = v => Math.round(Number(v ?? 0)).toString()

const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const DATE_OPTIONS = [
  { id: 'all',         label: 'All' },
  { id: 'today',       label: 'Today' },
  { id: 'yesterday',   label: 'Yesterday' },
  { id: 'thisWeek',    label: 'This Week' },
  { id: 'thisMonth',   label: 'This Month' },
  { id: 'thisQuarter', label: 'This Quarter' },
  { id: 'thisYear',    label: 'This Year' },
  { id: 'last7',       label: 'Last 7 Days' },
  { id: 'last30',      label: 'Last 30 Days' },
]

const QUARTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'Q1',  label: 'Q1' },
  { id: 'Q2',  label: 'Q2' },
  { id: 'Q3',  label: 'Q3' },
  { id: 'Q4',  label: 'Q4' },
]

// The Date sub-filter only has day-level granularity to work with on the
// current-year sheet (daily rows); "Capacity 2025" rows are monthly, so a
// day range can't slice them further — Month/Team/Employee already do that.
function applyDateFilter(rows, dateOption) {
  if (dateOption === 'all') return rows
  const today = new Date()
  let start, end
  switch (dateOption) {
    case 'today':       start = today; end = today; break
    case 'yesterday':   start = subDays(today, 1); end = subDays(today, 1); break
    case 'thisWeek':    start = startOfWeek(today); end = today; break
    case 'thisMonth':   start = startOfMonth(today); end = today; break
    case 'thisQuarter': start = startOfQuarter(today); end = today; break
    case 'thisYear':    start = startOfYear(today); end = today; break
    case 'last7':       start = subDays(today, 6); end = today; break
    case 'last30':      start = subDays(today, 29); end = today; break
    default: return rows
  }
  const s = format(start, 'yyyy-MM-dd')
  const e = format(end, 'yyyy-MM-dd')
  return rows.filter(r => r.Date >= s && r.Date <= e)
}

function HoursTooltip({ active, payload, label }) {
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

function PercentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-2">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-xs" style={{ color: p.fill || p.color }}>
          {p.name}: <span className="font-bold">{fmtPct(p.value)}%</span>
        </p>
      ))}
    </div>
  )
}

// Team-by-Month combo chart's tooltip — every series is a percentage
// (Utilization % bars, Growth % line) except the Employee Count bar, which
// is a plain headcount; unlike HoursTooltip/PercentTooltip it isn't reused
// elsewhere.
function ComboTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-2 max-w-[180px] truncate">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.fill || p.stroke || p.color }}>
          {p.name}: <span className="font-bold">{p.dataKey === 'empCount2026' ? p.value : `${fmtPct(p.value)}%`}</span>
        </p>
      ))}
    </div>
  )
}

function DeltaBadge({ delta }) {
  const pos = delta >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold
      ${pos ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
      {pos ? '▲' : '▼'} {fmtPct(Math.abs(delta))}%
    </span>
  )
}

function InProgressBadge({ text = 'Data in progress — partial period' }) {
  return (
    <p className="text-center text-xs mt-2 font-medium" style={{ color: COLOR_2026 }}>
      ⏳ {text}
    </p>
  )
}

function NoDataYet({ monthName, lastDataMonthName }) {
  return (
    <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
      <p className="dark:text-white/50 text-brand-500 font-medium">No data yet for {monthName} 2026</p>
      <p className="text-xs dark:text-white/30 text-brand-400 mt-1">
        This month hasn't started — the Capacity sheet only has data through {lastDataMonthName} 2026.
      </p>
    </div>
  )
}

// Utilization donut with a big centered percentage.
function UtilDonut({ label, value, color }) {
  const data = [{ v: value }, { v: Math.max(0, 100 - value) }]
  return (
    <div className="relative flex flex-col items-center">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="v" innerRadius={68} outerRadius={90} startAngle={90} endAngle={-270} stroke="none">
            <Cell fill={color} />
            <Cell fill="rgba(140,143,254,0.12)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 top-0 flex flex-col items-center justify-center" style={{ height: 200 }}>
        <span className="text-3xl font-bold" style={{ color }}>{fmtPct(value)}%</span>
        <span className="text-xs dark:text-white/50 text-brand-500 mt-1">{label}</span>
      </div>
    </div>
  )
}

// A "2025 vs 2026" pair-of-bars mini chart, reused for Year/Quarter/Month
// comparisons — each metric gets its own axis (never hours + % together).
// A row's `status: 'partial'` (in-progress quarter/month) renders the 2026
// bar at reduced opacity so it never reads as a completed period.
function CompareBarChart({ data, dataKeyPrefix, xKey, unit, height = 220, onBarClick }) {
  const key2025 = `${dataKeyPrefix}2025`
  const key2026 = `${dataKeyPrefix}2026`
  // On-bar labels are rounded to whole numbers here (not fmtHours' 2-decimal
  // form) purely for legibility — the tooltip still shows full precision.
  // Long decimal strings ("245.32") were the main cause of adjacent-bar
  // label collisions on categories with many months (Month Comparison, up
  // to 12 side-by-side pairs); the smaller font + wider bar gap below cover
  // the rest of it.
  const labelFormatter = unit === '%' ? (v => `${fmtPct(v)}%`) : (v => Math.round(v).toLocaleString())
  const tooltip = unit === '%' ? <PercentTooltip /> : <HoursTooltip />
  const barCursor = onBarClick ? { cursor: 'pointer' } : {}

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 32, bottom: 8 }} barGap={6} barCategoryGap="18%">
        <XAxis dataKey={xKey} tick={{ fill: 'currentColor', fontSize: 11 }} />
        <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={unit === '%' ? (v => `${Math.round(v)}%`) : fmtHours} />
        <Tooltip content={tooltip} />
        <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 8, fontSize: '12px' }} />
        <Bar dataKey={key2025} name="2025" fill={COLOR_2025} radius={[4, 4, 0, 0]}
          onClick={onBarClick ? () => onBarClick(2025) : undefined} {...barCursor}>
          <LabelList dataKey={key2025} position="top" formatter={labelFormatter} style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
        </Bar>
        <Bar dataKey={key2026} name="2026" fill={COLOR_2026} radius={[4, 4, 0, 0]}
          onClick={onBarClick ? () => onBarClick(2026) : undefined} {...barCursor}>
          {data.map((d, i) => (
            <Cell key={i} fill={COLOR_2026} fillOpacity={d.status === 'partial' ? 0.4 : 1} />
          ))}
          <LabelList dataKey={key2026} position="top" formatter={labelFormatter} style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// One "Comparison" section: Hours + Utilization mini-charts side by side,
// with growth% / headcount shown as badges (never mixed onto a bar axis).
// `onBarClick(year)` is optional — only the Year section wires it up, to open
// a drill-down of exactly the employee rows that were summed into that bar.
function ComparisonSection({
  title, data, xKey, growthPct, empCount2025, empCount2026,
  traineeCount2025, traineeCount2026, onBarClick,
}) {
  const periodColumn = { key: xKey, label: 'Period' }
  const hoursColumns = [
    periodColumn,
    { key: 'hours2025', label: 'Hours 2025', format: fmtHours },
    { key: 'hours2026', label: 'Hours 2026', format: fmtHours },
  ]
  const utilColumns = [
    periodColumn,
    { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
    { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
  ]
  return (
    <div className="card p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 mb-4">
        <div />
        <h3 className="justify-self-center">
          <ChartTitleBadge>{title}</ChartTitleBadge>
        </h3>
        <div className="justify-self-end flex items-center gap-3 flex-wrap text-xs dark:text-white/60 text-brand-600">
          {empCount2025 !== undefined && (
            <span>Employees: <b style={{ color: COLOR_2025 }}>{empCount2025}</b> → <b style={{ color: COLOR_2026 }}>{empCount2026}</b></span>
          )}
          {traineeCount2025 !== undefined && (
            <span className="flex items-center gap-1">
              Trainees: <b style={{ color: COLOR_2025 }}>{traineeCount2025}</b> → <b style={{ color: COLOR_2026 }}>{traineeCount2026}</b>
              {traineeCount2025 > 0 && <DeltaBadge delta={calcGrowthPct(traineeCount2025, traineeCount2026)} />}
            </span>
          )}
          {growthPct !== undefined && (
            <span className="flex items-center gap-1">Growth <DeltaBadge delta={growthPct} /></span>
          )}
        </div>
      </div>
      {onBarClick && (
        <p className="text-xs font-light dark:text-white/40 text-brand-400 -mt-2 mb-4">
          Click a bar to see the employee-level breakdown behind it.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MaximizableChartCard title="Hours" height={220} modalHeight={420} exportRows={data} exportColumns={hoursColumns}>
          {h => <CompareBarChart data={data} dataKeyPrefix="hours" xKey={xKey} unit="hrs" onBarClick={onBarClick} height={h} />}
        </MaximizableChartCard>
        <MaximizableChartCard title="Utilization %" height={220} modalHeight={420} exportRows={data} exportColumns={utilColumns}>
          {h => <CompareBarChart data={data} dataKeyPrefix="util" xKey={xKey} unit="%" onBarClick={onBarClick} height={h} />}
        </MaximizableChartCard>
      </div>
    </div>
  )
}

// A table cell whose value opens a drill-down modal — used for Employees /
// Hours / Capacity columns only; Utilization and Growth % stay plain since
// they're derived ratios, not something to drill into.
function DrillCell({ children, color, onClick }) {
  return (
    <td className="py-2 px-3 dark:text-white/70 text-brand-600">
      <button
        type="button"
        onClick={onClick}
        className="hover:underline decoration-dotted underline-offset-2 cursor-pointer text-left"
        style={color ? { color } : undefined}
      >
        {children}
      </button>
    </td>
  )
}

function DrillDownModal({ drillDown, data, onClose }) {
  if (!drillDown) return null
  const { metric, year, label } = drillDown
  const color = year === 2025 ? COLOR_2025 : COLOR_2026
  const metricTitle = { employees: 'Employees', hours: 'Hours Breakdown', capacity: 'Capacity', detail: 'Utilization Detail' }[metric]
  const rows = data?.rows || []
  const totalHours    = rows.reduce((s, r) => s + (r.hours || 0), 0)
  const totalCapacity = rows.reduce((s, r) => s + (r.capacity || 0), 0)
  const totalUtil      = totalCapacity > 0 ? Math.round((totalHours / totalCapacity) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   dark:bg-brand-900 bg-white border dark:border-white/10 border-brand-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-sm font-semibold dark:text-white text-brand-900">
            {metricTitle} — <span style={{ color }}>{label} {year}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-lg leading-none px-2 dark:text-white/50 text-brand-400
                       hover:dark:text-white hover:text-brand-800"
          >
            ✕
          </button>
        </div>
        {metric !== 'hours' && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 text-xs
                          dark:text-white/60 text-brand-600 border-b dark:border-white/10 border-brand-200 pb-3">
            <span>Employees counted: <b className="dark:text-white text-brand-900">{rows.length}</b></span>
            <span>Total hours: <b className="dark:text-white text-brand-900">{fmtHours(totalHours)}</b></span>
            <span>Total capacity: <b className="dark:text-white text-brand-900">{fmtHours(totalCapacity)}</b></span>
            <span>Overall utilization: <b style={{ color }}>{totalUtil}%</b></span>
          </div>
        )}
        <div className="overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              {metric === 'hours' && year === 2025
                ? "No project/client-level detail available for 2025 — the Raw Time Log sheet doesn't go back that far. 2025 figures come from the aggregated Capacity 2025 sheet only."
                : 'No data found for this period.'}
            </p>
          ) : metric === 'hours' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Project', 'Client', 'Hours'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.project}-${i}`} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{r.project || 'Unknown'}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{r.client || '—'}</td>
                    <td className="py-2 px-3 font-semibold" style={{ color }}>{fmtHours(r.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Employee', 'Team', 'Hours', 'Capacity', 'Utilization'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{r.name}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs">{r.team}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(r.hours)}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(r.capacity)}</td>
                    <td className="py-2 px-3 font-semibold" style={{ color }}>{fmtPct(r.util)}%</td>
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

// Employees-column drill-down for the Team Utilization Comparison by Month
// table (and its Grand Summary row) — a plain name list, distinct from
// DrillDownModal's per-employee hours/capacity/util breakdown since there's
// no metric to show here beyond "who counted toward this number".
function TeamEmployeesModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { team, year, names } = drillDown
  const color = year === 2025 ? COLOR_2025 : COLOR_2026
  const heading = team === 'Grand Summary' ? 'All Teams' : `${team} Team`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   dark:bg-brand-900 bg-white border dark:border-white/10 border-brand-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-sm font-semibold dark:text-white text-brand-900">
            {heading} — <span style={{ color }}>{year}</span>{' '}
            <span className="font-normal dark:text-white/50 text-brand-500">
              ({names.length} employee{names.length === 1 ? '' : 's'})
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-lg leading-none px-2 dark:text-white/50 text-brand-400
                       hover:dark:text-white hover:text-brand-800"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {names.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No employees found for this period.
            </p>
          ) : (
            <ul className="space-y-1">
              {names.map((name, i) => (
                <li key={name} className={`px-3 py-2 rounded-lg text-sm font-medium dark:text-white text-brand-900
                  ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ComparisonTab() {
  const { isDark } = useTheme()
  const { data: cap2025 = [], isLoading: l1, error: e1 } = useCapacity2025()
  const { data: cap2026 = [], isLoading: l2, error: e2 } = useCapacity2026()
  const { data: rawTimeLog = [] } = useRawTimeLog()
  const { employee, permissions: rawPermissions } = useAuth()
  const permissions = rawPermissions || DEFAULT_DENIED_PERMISSIONS
  const dataScope = permissions.dataScope
  const scopeLocksTeam     = dataScope === DATA_SCOPES.MY_TEAM || dataScope === DATA_SCOPES.MY_DATA
  const scopeLocksEmployee = dataScope === DATA_SCOPES.MY_DATA

  // ── Page-level filters (independent of the app's global date filter) ──
  const [selectedDate, setSelectedDate]     = useState('all')
  const [selectedMonth, setSelectedMonth]   = useState(new Date().getMonth() + 1)
  const [selectedQuarter, setSelectedQuarter] = useState('all')
  const [selectedTeams, setSelectedTeams]     = useState([])
  const [selectedEmployees, setSelectedEmployees] = useState([])
  // Independent of the Team multi-select above: a one-click way to drop
  // Trainees/owner from every calculation on this tab (matches how the Zoho
  // reference report is scoped) without having to deselect them by hand each
  // time Team resets to "All".
  const [excludeTraineesOwner, setExcludeTraineesOwner] = useState(false)

  const allCapRows = useMemo(() => [...cap2025, ...cap2026], [cap2025, cap2026])
  const teamOptions = useMemo(() => getUniqueCapacityTeams(allCapRows), [allCapRows])
  const employeeOptions = useMemo(
    () => getUniqueCapacityEmployees(allCapRows, selectedTeams),
    [allCapRows, selectedTeams]
  )

  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && teamOptions.length > 0) {
      setSelectedTeams(teamOptions)
      setSelectedEmployees(getUniqueCapacityEmployees(allCapRows, teamOptions))
      initialized.current = true
    }
  }, [teamOptions, allCapRows])

  // Data Scope enforcement — same override pattern as FilterBar.jsx, applied
  // here too since this tab keeps its own independent Team/Employee filter
  // state instead of the global FilterContext one.
  useEffect(() => {
    if (!employee) return
    if (dataScope === DATA_SCOPES.MY_DATA) {
      setSelectedTeams(employee.team ? [employee.team] : teamOptions)
      setSelectedEmployees(employee.name ? [employee.name] : [])
    } else if (dataScope === DATA_SCOPES.MY_TEAM && employee.team) {
      setSelectedTeams([employee.team])
      setSelectedEmployees(getUniqueCapacityEmployees(allCapRows, [employee.team]))
    }
  }, [dataScope, employee, allCapRows, teamOptions])

  const EXCLUDED_TEAMS = ['trainees', 'owner']
  function applyTeamEmp(rows) {
    return rows.filter(r =>
      (selectedTeams.length === 0 || selectedTeams.includes(r.Team)) &&
      (selectedEmployees.length === 0 || selectedEmployees.includes(r.Name)) &&
      (!excludeTraineesOwner || !EXCLUDED_TEAMS.includes((r.Team || '').trim().toLowerCase()))
    )
  }

  // Full-year scope (Team/Employee filtered only) — feeds Year/Quarter charts & the max/min cards
  const cap2025All = useMemo(() => applyTeamEmp(cap2025), [cap2025, selectedTeams, selectedEmployees, excludeTraineesOwner])
  const cap2026All = useMemo(() => applyTeamEmp(cap2026), [cap2026, selectedTeams, selectedEmployees, excludeTraineesOwner])

  // Month-scoped (Team/Employee + Month + Date) — feeds donuts, the Month snapshot, the Team combo chart, both tables
  const cap2025Month = useMemo(() => filterCapacityByMonth(cap2025All, 2025, selectedMonth), [cap2025All, selectedMonth])
  const cap2026Month = useMemo(
    () => applyDateFilter(filterCapacityByMonth(cap2026All, 2026, selectedMonth), selectedDate),
    [cap2026All, selectedMonth, selectedDate]
  )

  const monthSummary2025 = useMemo(() => calcCapacitySummary(cap2025Month), [cap2025Month])
  const monthSummary2026 = useMemo(() => calcCapacitySummary(cap2026Month), [cap2026Month])

  // The Capacity (2026) sheet only has rows through today, so the current
  // quarter/month is necessarily incomplete — derive that boundary from the
  // actual data (not just the client clock) and treat anything after it as
  // "not started yet" rather than a misleading 0%.
  const lastDataDate = useMemo(
    () => cap2026.reduce((max, r) => (r.Date > max ? r.Date : max), ''),
    [cap2026]
  )
  const lastDataMonth   = lastDataDate ? Number(lastDataDate.slice(5, 7)) : (new Date().getMonth() + 1)
  const lastDataQuarter = Math.ceil(lastDataMonth / 3)
  const isMonthFuture   = selectedMonth > lastDataMonth
  const isMonthPartial  = selectedMonth === lastDataMonth

  // Year/Quarter/Month comparison charts all track the Month filter: they
  // only ever count data from Jan 1 through the selected month, not the
  // full year — so picking "Jun" shows a true Jan-Jun year-to-date slice.
  const cap2025YTD = useMemo(() => filterCapacityYTD(cap2025All, 2025, selectedMonth), [cap2025All, selectedMonth])
  const cap2026YTD = useMemo(() => filterCapacityYTD(cap2026All, 2026, selectedMonth), [cap2026All, selectedMonth])

  // Year, Quarter, and Month comparison charts must all read from this same
  // cap2025YTD/cap2026YTD pair — computing any of them from the un-truncated
  // cap2025All/cap2026All instead is what caused the same month to show two
  // different totals depending on which chart rendered it.
  const yearly    = useMemo(() => calcYearlyComparison(cap2025YTD, cap2026YTD), [cap2025YTD, cap2026YTD])
  // Trainee headcount for the "Comparison of Utilization by Year" chart —
  // same cap2025YTD/cap2026YTD scope as `yearly` above (so it respects the
  // Team/Employee/Month filters and the Exclude Trainees & Owner toggle the
  // same way the Employees badge next to it does), narrowed to the
  // "Trainees" team only.
  const traineeCount2025 = useMemo(
    () => calcCapacitySummary(cap2025YTD.filter(r => (r.Team || '').trim().toLowerCase() === 'trainees')).empCount,
    [cap2025YTD]
  )
  const traineeCount2026 = useMemo(
    () => calcCapacitySummary(cap2026YTD.filter(r => (r.Team || '').trim().toLowerCase() === 'trainees')).empCount,
    [cap2026YTD]
  )
  const quarterly = useMemo(() => calcQuarterlyComparison(cap2025YTD, cap2026YTD), [cap2025YTD, cap2026YTD])
  const quarterlyAnnotated = useMemo(() => quarterly
    .map((q, i) => {
      const qNum = i + 1
      const status = qNum < lastDataQuarter ? 'complete' : qNum === lastDataQuarter ? 'partial' : 'future'
      return { ...q, status }
    })
    .filter(q => q.status !== 'future'), [quarterly, lastDataQuarter])
  // Cap the visible quarters at whichever quarter contains the selected
  // Month (e.g. Month=Jun -> quarterCutoff=2 -> only Q1-Q2 show).
  const quarterCutoff = Math.ceil(selectedMonth / 3)
  const quarterlyInRange = useMemo(
    () => quarterlyAnnotated.filter((q, i) => (i + 1) <= quarterCutoff),
    [quarterlyAnnotated, quarterCutoff]
  )
  const quarterlyFiltered = useMemo(
    () => selectedQuarter === 'all' ? quarterlyInRange : quarterlyInRange.filter(q => q.quarter === selectedQuarter),
    [quarterlyInRange, selectedQuarter]
  )

  // YTD-truncated trend (Jan through the selected Month) — feeds both the
  // "Month Comparison" chart and the "Highest vs Lowest Monthly Utilization"
  // cards below, built from the same cap2025YTD/cap2026YTD as the Year and
  // Quarter charts so a given month always reports the same totals
  // everywhere it appears, and picking Month=Jun never surfaces a Jul-Dec
  // month as the year's max/min.
  const monthlyTrendYTD2025 = useMemo(() => calcMonthlyUtilizationTrend(cap2025YTD), [cap2025YTD])
  const monthlyTrendYTD2026 = useMemo(() => calcMonthlyUtilizationTrend(cap2026YTD), [cap2026YTD])
  const monthlyCompared = useMemo(() => {
    const map2025 = Object.fromEntries(monthlyTrendYTD2025.map(m => [m.month, m]))
    const map2026 = Object.fromEntries(monthlyTrendYTD2026.map(m => [m.month, m]))
    const months = []
    for (let m = 1; m <= selectedMonth; m++) {
      const d2025 = map2025[m]
      const d2026 = map2026[m]
      months.push({
        month: m,
        label: MONTH_SHORT[m - 1],
        empCount2025: d2025?.empCount || 0,
        empCount2026: d2026?.empCount || 0,
        hours2025: d2025?.hours || 0,
        hours2026: d2026?.hours || 0,
        capacity2025: d2025?.capacity || 0,
        capacity2026: d2026?.capacity || 0,
        util2025: d2025?.util || 0,
        util2026: d2026?.util || 0,
        growthPct: calcGrowthPct(d2025?.util || 0, d2026?.util || 0),
        status: m === lastDataMonth ? 'partial' : 'complete',
      })
    }
    return months
  }, [monthlyTrendYTD2025, monthlyTrendYTD2026, selectedMonth, lastDataMonth])
  // Exclude the in-progress current month from 2026's max/min — comparing a
  // partial month against complete ones would crown it unfairly. Filtering
  // the YTD-truncated trend (not the full-year one) means this naturally
  // resolves to "nothing to exclude" once Month is set earlier than the
  // sheet's actual last data month.
  const monthlyTrend2026Complete = useMemo(
    () => monthlyTrendYTD2026.filter(m => m.month < lastDataMonth),
    [monthlyTrendYTD2026, lastDataMonth]
  )
  const teamSummary2025  = useMemo(() => calcTeamUtilizationSummary(cap2025YTD), [cap2025YTD])
  const teamSummary2026  = useMemo(() => calcTeamUtilizationSummary(cap2026YTD), [cap2026YTD])

  const maxMonth2025 = monthlyTrendYTD2025.length ? [...monthlyTrendYTD2025].sort((a, b) => b.util - a.util)[0] : null
  const minMonth2025 = monthlyTrendYTD2025.length ? [...monthlyTrendYTD2025].sort((a, b) => a.util - b.util)[0] : null
  const maxMonth2026 = monthlyTrend2026Complete.length ? [...monthlyTrend2026Complete].sort((a, b) => b.util - a.util)[0] : null
  const minMonth2026 = monthlyTrend2026Complete.length ? [...monthlyTrend2026Complete].sort((a, b) => a.util - b.util)[0] : null

  const maxTeam2025 = teamSummary2025[0] || null
  const minTeam2025 = teamSummary2025[teamSummary2025.length - 1] || null
  const maxTeam2026 = teamSummary2026[0] || null
  const minTeam2026 = teamSummary2026[teamSummary2026.length - 1] || null

  const teamByMonth     = useMemo(() => calcComparisonByTeam(cap2025Month, cap2026Month),     [cap2025Month, cap2026Month])
  const employeeByMonth = useMemo(() => calcComparisonByEmployee(cap2025Month, cap2026Month), [cap2025Month, cap2026Month])

  const monthlyComparedExport = useMemo(
    () => monthlyCompared.map(row => ({ ...row, monthLabel: MONTH_FULL[row.month - 1] })),
    [monthlyCompared]
  )

  const grandSummary = useMemo(() => {
    const s2025 = calcCapacitySummary(cap2025Month)
    const s2026 = calcCapacitySummary(cap2026Month)
    return {
      team: 'Grand Summary',
      empCount2025: s2025.empCount, hours2025: s2025.hours, capacity2025: s2025.capacity, util2025: s2025.util,
      empCount2026: s2026.empCount, hours2026: s2026.hours, capacity2026: s2026.capacity, util2026: s2026.util,
      delta: calcGrowthPct(s2025.util, s2026.util),
    }
  }, [cap2025Month, cap2026Month])

  // Employee table's own sub-filters — independent of the page-level ones
  const [tableTeams, setTableTeams] = useState([])
  const [tableEmployees, setTableEmployees] = useState([])
  const tableTeamOptions = useMemo(() => getUniqueCapacityTeams([...cap2025Month, ...cap2026Month]), [cap2025Month, cap2026Month])
  const tableEmployeeOptions = useMemo(
    () => getUniqueCapacityEmployees([...cap2025Month, ...cap2026Month], tableTeams),
    [cap2025Month, cap2026Month, tableTeams]
  )
  const tableInitialized = useRef(false)
  useEffect(() => {
    if (!tableInitialized.current && tableTeamOptions.length > 0) {
      setTableTeams(tableTeamOptions)
      setTableEmployees(tableEmployeeOptions)
      tableInitialized.current = true
    }
  }, [tableTeamOptions])

  // Data Scope enforcement for this table's own sub-filters too.
  useEffect(() => {
    if (!employee) return
    const monthCapRows = [...cap2025Month, ...cap2026Month]
    if (dataScope === DATA_SCOPES.MY_DATA) {
      setTableTeams(employee.team ? [employee.team] : tableTeamOptions)
      setTableEmployees(employee.name ? [employee.name] : [])
    } else if (dataScope === DATA_SCOPES.MY_TEAM && employee.team) {
      setTableTeams([employee.team])
      setTableEmployees(getUniqueCapacityEmployees(monthCapRows, [employee.team]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataScope, employee, cap2025Month, cap2026Month, tableTeamOptions])

  const employeeTableRows = useMemo(
    () => employeeByMonth.filter(row =>
      (tableTeams.length === 0 || tableTeams.includes(row.team)) &&
      (tableEmployees.length === 0 || tableEmployees.includes(row.name))
    ),
    [employeeByMonth, tableTeams, tableEmployees]
  )
  const employeeByMonthIndexed = useMemo(() => employeeTableRows.map((row, i) => ({ ...row, _idx: i })), [employeeTableRows])
  const employeeByMonthTableSort = useSortableRows(employeeByMonthIndexed, '_idx', 'asc')
  const employeeByMonthTableSorted = employeeByMonthTableSort.sorted

  const teamByMonthExport = useMemo(() => [...teamByMonth, grandSummary], [teamByMonth, grandSummary])

  // Clickable-header sort for this tab's 4 tables — each source array's
  // current order (chronological for Quarter/Month, calc-determined for
  // Team/Employee) is preserved as the default view by sorting on a
  // synthetic `_idx` position field until the user clicks a header; Grand
  // Summary stays pinned as a footer row, outside the sorted body, like any
  // total row. Doesn't touch quarterlyFiltered/monthlyCompared/teamByMonth/
  // employeeTableRows themselves — those still feed the charts/exports above.
  const quarterlyIndexed = useMemo(() => quarterlyFiltered.map((row, i) => ({ ...row, _idx: i })), [quarterlyFiltered])
  const quarterlyTableSort = useSortableRows(quarterlyIndexed, '_idx', 'asc')
  const quarterlyTableSorted = quarterlyTableSort.sorted

  const monthlyIndexed = useMemo(() => monthlyCompared.map((row, i) => ({ ...row, _idx: i })), [monthlyCompared])
  const monthlyTableSort = useSortableRows(monthlyIndexed, '_idx', 'asc')
  const monthlyTableSorted = monthlyTableSort.sorted

  const teamByMonthIndexed = useMemo(() => teamByMonth.map((row, i) => ({ ...row, _idx: i })), [teamByMonth])
  const teamByMonthTableSort = useSortableRows(teamByMonthIndexed, '_idx', 'asc')
  const teamByMonthTableSorted = teamByMonthTableSort.sorted

  // ── Drill-down: clicking an Employees/Hours/Capacity cell in the Quarterly
  // or Monthly table opens a modal scoped to that exact year + period, using
  // the same cap2025YTD/cap2026YTD rows the cell's own number came from.
  const timeLogFiltered = useMemo(
    () => rawTimeLog.filter(r =>
      (selectedTeams.length === 0 || selectedTeams.includes(r.TEAM)) &&
      (selectedEmployees.length === 0 || selectedEmployees.includes(r.WHO)) &&
      (!excludeTraineesOwner || !EXCLUDED_TEAMS.includes((r.TEAM || '').trim().toLowerCase()))
    ),
    [rawTimeLog, selectedTeams, selectedEmployees, excludeTraineesOwner]
  )
  const [drillDown, setDrillDown] = useState(null) // { metric, year, kind, value, label } | null
  function openDrillDown(metric, year, kind, value, label) {
    setDrillDown({ metric, year, kind, value, label })
  }
  const drillDownData = useMemo(() => {
    if (!drillDown) return null
    const { metric, year, kind, value } = drillDown
    const capSource = year === 2025 ? cap2025YTD : cap2026YTD

    if (metric === 'hours' && kind !== 'year') {
      const logSource = timeLogFiltered
      const periodLogRows = kind === 'quarter'
        ? filterTimeLogByQuarter(logSource, year, value)
        : filterTimeLogByMonth(logSource, year, value)
      return { metric, rows: calcHoursByProject(periodLogRows) }
    }

    // "year" needs no further narrowing — capSource (cap2025YTD/cap2026YTD)
    // is already exactly the row set calcYearlyComparison summed for this bar.
    const periodCapRows = kind === 'year'
      ? capSource
      : kind === 'quarter'
        ? filterCapacityByQuarter(capSource, value)
        : filterCapacityByMonth(capSource, year, value)
    const employees = calcCapacityByEmployee(periodCapRows)
    const rows = metric === 'capacity' || metric === 'detail'
      ? [...employees].sort((a, b) => b.capacity - a.capacity)
      : [...employees].sort((a, b) => b.util - a.util)
    return { metric, rows }
  }, [drillDown, cap2025YTD, cap2026YTD, timeLogFiltered])

  // ── Employees-column drill-down for the "Team Utilization Comparison by
  // Month" table (and its Grand Summary row) — sourced from the exact same
  // cap2025Month/cap2026Month rows calcComparisonByTeam/calcCapacitySummary
  // summed to produce that cell's count, so the modal's name list always
  // reconciles with the number clicked.
  const [teamEmpDrillDown, setTeamEmpDrillDown] = useState(null) // { team, year, names } | null
  function openTeamEmpDrillDown(team, year) {
    const rows = year === 2025 ? cap2025Month : cap2026Month
    const scoped = team === 'Grand Summary' ? rows : rows.filter(r => r.Team === team)
    setTeamEmpDrillDown({ team, year, names: getActiveEmployeeNames(scoped) })
  }

  function resetAll() {
    setSelectedDate('all')
    setSelectedMonth(new Date().getMonth() + 1)
    setSelectedQuarter('all')
    setSelectedTeams(teamOptions)
    setSelectedEmployees(getUniqueCapacityEmployees(allCapRows, teamOptions))
    setExcludeTraineesOwner(false)
  }

  const monthName = MONTH_FULL[selectedMonth - 1]
  const yearRangeLabel = selectedMonth === 12 ? 'Full Year' : `Jan - ${MONTH_SHORT[selectedMonth - 1]}`

  if (l1 || l2) return <LoadingSpinner message="Loading comparison data..." />
  if (e1 || e2) return (
    <div className="card p-8 text-center mt-6">
      <p className="text-red-400 font-semibold">{(e1 || e2)?.message}</p>
    </div>
  )

  return (
    <div className="space-y-6 pt-4">
      <Greeting />

      {/* Filters — Comparison doesn't render the shared <FilterBar/> (App.jsx
          skips it for this tab), so this is its equivalent "main filter bar".
          Sticky at top-0 like FilterBar itself — Header is normal (non-sticky)
          flow content now, so this is the first thing that pins on scroll. */}
      <div className="card p-4 flex flex-wrap items-center gap-3 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Date</label>
          <Dropdown
            options={DATE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
            value={selectedDate}
            onChange={setSelectedDate}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Month</label>
          <Dropdown
            options={MONTH_SHORT.map((name, i) => ({ value: i + 1, label: name }))}
            value={selectedMonth}
            onChange={setSelectedMonth}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Quarter</label>
          <Dropdown
            options={QUARTER_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
            value={selectedQuarter}
            onChange={setSelectedQuarter}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Team</label>
          <MultiSelect options={teamOptions} value={selectedTeams}
            onChange={val => { setSelectedTeams(val); setSelectedEmployees(getUniqueCapacityEmployees(allCapRows, val)) }}
            placeholder="All Teams" disabled={scopeLocksTeam} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Employee</label>
          <MultiSelect options={employeeOptions} value={selectedEmployees} onChange={setSelectedEmployees} placeholder="All Employees" disabled={scopeLocksEmployee} />
        </div>
        <label className="flex items-center gap-2 text-xs dark:text-white/60 text-brand-600 font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={excludeTraineesOwner}
            onChange={e => setExcludeTraineesOwner(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
          />
          Exclude Trainees &amp; Owner
        </label>
        <button
          onClick={resetAll}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors ml-auto
                     dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10
                     text-brand-500 hover:text-brand-700 hover:bg-brand-100"
        >
          ↺ Reset
        </button>
      </div>
      <p className="text-xs font-light dark:text-white/40 text-brand-400 -mt-3">
        Date narrows the current-year (2026) view within the selected Month; 2025 data is stored monthly so it always reflects the full month.
      </p>

      {/* Donuts */}
      <div className="card p-5">
        <h3 className="mb-2 flex justify-center">
          <ChartTitleBadge>Utilization — {monthName}</ChartTitleBadge>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UtilDonut label={`Utilization ${monthName} 2025`} value={monthSummary2025.util} color={COLOR_2025} />
          {isMonthFuture ? (
            <NoDataYet monthName={monthName} lastDataMonthName={MONTH_FULL[lastDataMonth - 1]} />
          ) : (
            <div>
              <UtilDonut label={`Utilization ${monthName} 2026`} value={monthSummary2026.util} color={COLOR_2026} />
              {isMonthPartial && <InProgressBadge />}
            </div>
          )}
        </div>
      </div>

      {/* Max/Min cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MinMaxCard
          isDark={isDark}
          title="Highest vs Lowest Monthly Utilization 2025"
          maxLabel={maxMonth2025 ? MONTH_FULL[maxMonth2025.month - 1] : '—'} maxValue={maxMonth2025?.util}
          minLabel={minMonth2025 ? MONTH_FULL[minMonth2025.month - 1] : '—'} minValue={minMonth2025?.util}
        />
        <MinMaxCard
          isDark={isDark}
          title="Top vs Lowest Team Utilization 2025"
          maxLabel={maxTeam2025?.team || '—'} maxValue={maxTeam2025?.util}
          minLabel={minTeam2025?.team || '—'} minValue={minTeam2025?.util}
        />
        <MinMaxCard
          isDark={isDark}
          title="Highest vs Lowest Monthly Utilization 2026"
          maxLabel={maxMonth2026 ? MONTH_FULL[maxMonth2026.month - 1] : '—'} maxValue={maxMonth2026?.util}
          minLabel={minMonth2026 ? MONTH_FULL[minMonth2026.month - 1] : '—'} minValue={minMonth2026?.util}
        />
        <MinMaxCard
          isDark={isDark}
          title="Top vs Lowest Team Utilization 2026"
          maxLabel={maxTeam2026?.team || '—'} maxValue={maxTeam2026?.util}
          minLabel={minTeam2026?.team || '—'} minValue={minTeam2026?.util}
        />
      </div>

      {/* Year / Quarter / Month comparison sections */}
      <ComparisonSection
        title={`Comparison of Utilization by Year${yearRangeLabel === 'Full Year' ? '' : ` — Year to Date (${yearRangeLabel})`}`}
        data={[{
          label: yearRangeLabel,
          hours2025: yearly.hours2025, hours2026: yearly.hours2026,
          util2025: yearly.util2025, util2026: yearly.util2026,
          status: isMonthPartial ? 'partial' : 'complete',
        }]}
        xKey="label"
        growthPct={yearly.growthPct}
        empCount2025={yearly.empCount2025}
        empCount2026={yearly.empCount2026}
        traineeCount2025={traineeCount2025}
        traineeCount2026={traineeCount2026}
        onBarClick={year => openDrillDown('detail', year, 'year', null, yearRangeLabel)}
      />

      <ComparisonSection
        title={`Quarterly Comparison for 2025 vs 2026${selectedQuarter !== 'all' ? ` — ${selectedQuarter}` : ''}`}
        data={quarterlyFiltered.map(q => ({ ...q, label: q.status === 'partial' ? `${q.quarter} (In Progress)` : q.quarter }))}
        xKey="label"
      />

      {/* Quarterly table — same columns as the Team table, grouped by Quarter */}
      <MaximizableChartCard
        title="Quarterly Comparison for 2025 vs 2026"
        exportRows={quarterlyFiltered}
        exportColumns={[
          { key: 'quarter', label: 'Quarter' },
          { key: 'empCount2025', label: 'Employees 2025' },
          { key: 'hours2025', label: 'Hours 2025', format: fmtHours },
          { key: 'capacity2025', label: 'Capacity 2025', format: fmtHours },
          { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
          { key: 'empCount2026', label: 'Employees 2026' },
          { key: 'hours2026', label: 'Hours 2026', format: fmtHours },
          { key: 'capacity2026', label: 'Capacity 2026', format: fmtHours },
          { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
          { key: 'growthPct', label: 'Growth %', format: fmtPct },
        ]}
      >
        {() => (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'quarter', label: 'Quarter' }, { key: 'empCount2025', label: 'Employees 2025' },
                  { key: 'hours2025', label: 'Hours 2025' }, { key: 'capacity2025', label: 'Capacity 2025' },
                  { key: 'util2025', label: 'Utilization 2025' }, { key: 'empCount2026', label: 'Employees 2026' },
                  { key: 'hours2026', label: 'Hours 2026' }, { key: 'capacity2026', label: 'Capacity 2026' },
                  { key: 'util2026', label: 'Utilization 2026' }, { key: 'growthPct', label: 'Growth %' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={quarterlyTableSort.sortKey === col.key} dir={quarterlyTableSort.sortDir}
                    onClick={() => quarterlyTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {quarterlyTableSorted.map((row, i) => (
                <tr key={row.quarter} className={`border-b dark:border-white/5 border-brand-100
                  ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">
                    {row.quarter}
                    {row.status === 'partial' && (
                      <span className="ml-2 text-xs font-normal" style={{ color: COLOR_2026 }}>⏳ In Progress</span>
                    )}
                  </td>
                  <DrillCell onClick={() => openDrillDown('employees', 2025, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{row.empCount2025}</DrillCell>
                  <DrillCell onClick={() => openDrillDown('hours', 2025, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{fmtHours(row.hours2025)}</DrillCell>
                  <DrillCell onClick={() => openDrillDown('capacity', 2025, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{fmtHours(row.capacity2025)}</DrillCell>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2025 }}>{fmtPct(row.util2025)}%</td>
                  <DrillCell onClick={() => openDrillDown('employees', 2026, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{row.empCount2026}</DrillCell>
                  <DrillCell onClick={() => openDrillDown('hours', 2026, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{fmtHours(row.hours2026)}</DrillCell>
                  <DrillCell onClick={() => openDrillDown('capacity', 2026, 'quarter', Number(row.quarter.slice(1)), row.quarter)}>{fmtHours(row.capacity2026)}</DrillCell>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2026 }}>{fmtPct(row.util2026)}%</td>
                  <td className="py-2 px-3"><DeltaBadge delta={row.growthPct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </MaximizableChartCard>

      {/* Monthly Comparison Table — same shape as the Quarterly table above,
          one row per month from Jan through the selected Month filter. */}
      {isMonthFuture ? (
        <div className="card p-8">
          <h3 className="text-sm font-semibold mb-2 dark:text-white/80 text-brand-800">
            Monthly Comparison Table for 2025 vs 2026 — {monthName}
          </h3>
          <NoDataYet monthName={monthName} lastDataMonthName={MONTH_FULL[lastDataMonth - 1]} />
        </div>
      ) : (
        <MaximizableChartCard
          title={`Monthly Comparison Table for 2025 vs 2026 — Jan - ${monthName}`}
          exportRows={monthlyComparedExport}
          exportColumns={[
            { key: 'monthLabel', label: 'Month' },
            { key: 'empCount2025', label: 'Employees 2025' },
            { key: 'hours2025', label: 'Hours 2025', format: fmtHours },
            { key: 'capacity2025', label: 'Capacity 2025', format: fmtHours },
            { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
            { key: 'empCount2026', label: 'Employees 2026' },
            { key: 'hours2026', label: 'Hours 2026', format: fmtHours },
            { key: 'capacity2026', label: 'Capacity 2026', format: fmtHours },
            { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
            { key: 'growthPct', label: 'Growth %', format: fmtPct },
          ]}
        >
          {() => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {[
                    { key: 'month', label: 'Month' }, { key: 'empCount2025', label: 'Employees 2025' },
                    { key: 'hours2025', label: 'Hours 2025' }, { key: 'capacity2025', label: 'Capacity 2025' },
                    { key: 'util2025', label: 'Utilization 2025' }, { key: 'empCount2026', label: 'Employees 2026' },
                    { key: 'hours2026', label: 'Hours 2026' }, { key: 'capacity2026', label: 'Capacity 2026' },
                    { key: 'util2026', label: 'Utilization 2026' }, { key: 'growthPct', label: 'Growth %' },
                  ].map(col => (
                    <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                      active={monthlyTableSort.sortKey === col.key} dir={monthlyTableSort.sortDir}
                      onClick={() => monthlyTableSort.handleSort(col.key)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyTableSorted.map((row, i) => (
                  <tr key={row.month} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">
                      {MONTH_FULL[row.month - 1]}
                      {row.status === 'partial' && (
                        <span className="ml-2 text-xs font-normal" style={{ color: COLOR_2026 }}>⏳ In Progress</span>
                      )}
                    </td>
                    <DrillCell onClick={() => openDrillDown('employees', 2025, 'month', row.month, MONTH_FULL[row.month - 1])}>{row.empCount2025}</DrillCell>
                    <DrillCell onClick={() => openDrillDown('hours', 2025, 'month', row.month, MONTH_FULL[row.month - 1])}>{fmtHours(row.hours2025)}</DrillCell>
                    <DrillCell onClick={() => openDrillDown('capacity', 2025, 'month', row.month, MONTH_FULL[row.month - 1])}>{fmtHours(row.capacity2025)}</DrillCell>
                    <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2025 }}>{fmtPct(row.util2025)}%</td>
                    <DrillCell onClick={() => openDrillDown('employees', 2026, 'month', row.month, MONTH_FULL[row.month - 1])}>{row.empCount2026}</DrillCell>
                    <DrillCell onClick={() => openDrillDown('hours', 2026, 'month', row.month, MONTH_FULL[row.month - 1])}>{fmtHours(row.hours2026)}</DrillCell>
                    <DrillCell onClick={() => openDrillDown('capacity', 2026, 'month', row.month, MONTH_FULL[row.month - 1])}>{fmtHours(row.capacity2026)}</DrillCell>
                    <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2026 }}>{fmtPct(row.util2026)}%</td>
                    <td className="py-2 px-3"><DeltaBadge delta={row.growthPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </MaximizableChartCard>
      )}

      {isMonthFuture ? (
        <div className="card p-8">
          <h3 className="text-sm font-semibold mb-2 dark:text-white/80 text-brand-800">
            Month Comparison for 2025 vs 2026 — {monthName}
          </h3>
          <NoDataYet monthName={monthName} lastDataMonthName={MONTH_FULL[lastDataMonth - 1]} />
        </div>
      ) : (
        <ComparisonSection
          title={`Month Comparison for 2025 vs 2026 — Jan - ${monthName}${isMonthPartial ? ' (In Progress)' : ''}`}
          data={monthlyCompared}
          xKey="label"
        />
      )}

      {isMonthFuture ? (
        <div className="card p-8">
          <h3 className="text-sm font-semibold mb-2 dark:text-white/80 text-brand-800">
            Team &amp; Employee Utilization Comparison by Month — {monthName}
          </h3>
          <NoDataYet monthName={monthName} lastDataMonthName={MONTH_FULL[lastDataMonth - 1]} />
        </div>
      ) : (
      <>
      {isMonthPartial && (
        <p className="text-xs font-medium text-center" style={{ color: COLOR_2026 }}>
          ⏳ {monthName} 2026 is still in progress — figures below reflect data through {lastDataDate}.
        </p>
      )}
      {/* Team combo chart — bars = utilization % (left axis) + employee
          count (own hidden axis, own scale), line = growth % (right axis).
          Employee Count bars are clickable, same as the table's Employees
          column below — opens the same drill-down modal. */}
      <MaximizableChartCard
        title={`Team Utilization Comparison by Month — ${monthName}`}
        height={Math.max(320, teamByMonth.length * 8) + 60}
        modalHeight={Math.max(420, teamByMonth.length * 10) + 100}
        exportRows={teamByMonth}
        exportColumns={[
          { key: 'team', label: 'Team' },
          { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
          { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
          { key: 'empCount2026', label: 'Employee Count' },
          { key: 'delta', label: 'Growth %', format: fmtPct },
        ]}
      >
        {h => (
          <>
            <p className="text-xs font-light dark:text-white/40 text-brand-400 mb-4 text-center">
              Bars = utilization % and employee count. Line (right axis) = utilization growth %. Click an Employee Count bar to see who's counted in it.
            </p>
            <ResponsiveContainer width="100%" height={h}>
              <ComposedChart data={teamByMonth} margin={{ top: 32, bottom: 60 }}>
                <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" height={70} interval={0} />
                <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={v => `${Math.round(v)}%`}
                  label={{ value: 'Utilization %', angle: -90, position: 'insideLeft', fill: 'currentColor', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: GROWTH_COLOR, fontSize: 11 }} tickFormatter={v => `${Math.round(v)}%`}
                  label={{ value: 'Growth %', angle: 90, position: 'insideRight', fill: GROWTH_COLOR, fontSize: 11 }} />
                <YAxis yAxisId="count" hide allowDecimals={false} />
                <Tooltip content={<ComboTooltip />} />
                <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
                <Bar yAxisId="left" dataKey="util2025" name="Utilization % 2025" fill={COLOR_2025} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="util2025" position="top" formatter={v => `${fmtPct(v)}%`}
                    style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                </Bar>
                <Bar yAxisId="left" dataKey="util2026" name="Utilization % 2026" fill={COLOR_2026} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="util2026" position="top" formatter={v => `${fmtPct(v)}%`}
                    style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                </Bar>
                <Bar
                  yAxisId="count"
                  dataKey="empCount2026"
                  name="Employee Count"
                  fill={EMP_COUNT_COLOR}
                  radius={[3, 3, 0, 0]}
                  onClick={entry => openTeamEmpDrillDown(entry.team, 2026)}
                  style={{ cursor: 'pointer' }}
                >
                  <LabelList dataKey="empCount2026" position="top"
                    style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="delta" name="Growth %" stroke={GROWTH_COLOR} strokeWidth={2} dot={{ r: 3, fill: GROWTH_COLOR }} />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </MaximizableChartCard>

      {/* Table (a): Team Utilization Comparison by Month */}
      <MaximizableChartCard
        title={`Team Utilization Comparison by Month — ${monthName}`}
        exportRows={teamByMonthExport}
        exportColumns={[
          { key: 'team', label: 'Team' },
          { key: 'empCount2025', label: 'Employees 2025' },
          { key: 'hours2025', label: 'Hours 2025', format: fmtHours },
          { key: 'capacity2025', label: 'Capacity 2025', format: fmtHours },
          { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
          { key: 'empCount2026', label: 'Employees 2026' },
          { key: 'hours2026', label: 'Hours 2026', format: fmtHours },
          { key: 'capacity2026', label: 'Capacity 2026', format: fmtHours },
          { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
          { key: 'delta', label: 'Growth %', format: fmtPct },
        ]}
      >
        {() => (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'team', label: 'Team' }, { key: 'empCount2025', label: 'Employees 2025' },
                  { key: 'hours2025', label: 'Hours 2025' }, { key: 'capacity2025', label: 'Capacity 2025' },
                  { key: 'util2025', label: 'Utilization 2025' }, { key: 'empCount2026', label: 'Employees 2026' },
                  { key: 'hours2026', label: 'Hours 2026' }, { key: 'capacity2026', label: 'Capacity 2026' },
                  { key: 'util2026', label: 'Utilization 2026' }, { key: 'delta', label: 'Growth %' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={teamByMonthTableSort.sortKey === col.key} dir={teamByMonthTableSort.sortDir}
                    onClick={() => teamByMonthTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {teamByMonthTableSorted.map((row, i) => (
                <tr key={row.team} className={`border-b dark:border-white/5 border-brand-100
                  ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.team}</td>
                  <DrillCell onClick={() => openTeamEmpDrillDown(row.team, 2025)}>{row.empCount2025}</DrillCell>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2025)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2025)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2025 }}>{fmtPct(row.util2025)}%</td>
                  <DrillCell onClick={() => openTeamEmpDrillDown(row.team, 2026)}>{row.empCount2026}</DrillCell>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2026)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2026)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2026 }}>{fmtPct(row.util2026)}%</td>
                  <td className="py-2 px-3"><DeltaBadge delta={row.delta} /></td>
                </tr>
              ))}
              <tr className="border-t-2 dark:border-white/20 border-brand-300 font-semibold">
                <td className="py-2 px-3 dark:text-white text-brand-900">{grandSummary.team}</td>
                <DrillCell onClick={() => openTeamEmpDrillDown(grandSummary.team, 2025)}>{grandSummary.empCount2025}</DrillCell>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.hours2025)}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.capacity2025)}</td>
                <td className="py-2 px-3" style={{ color: COLOR_2025 }}>{fmtPct(grandSummary.util2025)}%</td>
                <DrillCell onClick={() => openTeamEmpDrillDown(grandSummary.team, 2026)}>{grandSummary.empCount2026}</DrillCell>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.hours2026)}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.capacity2026)}</td>
                <td className="py-2 px-3" style={{ color: COLOR_2026 }}>{fmtPct(grandSummary.util2026)}%</td>
                <td className="py-2 px-3"><DeltaBadge delta={grandSummary.delta} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </MaximizableChartCard>

      {/* Table (b): Employee Utilization Comparison by Month */}
      <MaximizableChartCard
        title={`Employee Utilization Comparison by Month — ${monthName}`}
        height={500}
        modalHeight={750}
        exportRows={employeeTableRows}
        exportColumns={[
          { key: 'team', label: 'Team' },
          { key: 'name', label: 'Employee' },
          { key: 'hours2025', label: 'Hours 2025', format: fmtHours },
          { key: 'capacity2025', label: 'Capacity 2025', format: fmtHours },
          { key: 'util2025', label: 'Utilization 2025 (%)', format: fmtPct },
          { key: 'hours2026', label: 'Hours 2026', format: fmtHours },
          { key: 'capacity2026', label: 'Capacity 2026', format: fmtHours },
          { key: 'util2026', label: 'Utilization 2026 (%)', format: fmtPct },
          { key: 'delta', label: 'Growth %', format: fmtPct },
        ]}
      >
        {h => (
        <>
        {/* Table-local sub-filters — independent of the page-level filters above */}
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b dark:border-white/10 border-brand-200">
          <span className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Table filters
          </span>
          <div className="flex items-center gap-2">
            <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Team</label>
            <MultiSelect options={tableTeamOptions} value={tableTeams}
              onChange={val => { setTableTeams(val); setTableEmployees(getUniqueCapacityEmployees([...cap2025Month, ...cap2026Month], val)) }}
              placeholder="All Teams" disabled={scopeLocksTeam} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Employee</label>
            <MultiSelect options={tableEmployeeOptions} value={tableEmployees} onChange={setTableEmployees} placeholder="All Employees" disabled={scopeLocksEmployee} />
          </div>
        </div>

        <div className="overflow-x-auto" style={{ maxHeight: h }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-900 bg-white">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'team', label: 'Team' }, { key: 'name', label: 'Employee' },
                  { key: 'hours2025', label: 'Hours 2025' }, { key: 'capacity2025', label: 'Capacity 2025' },
                  { key: 'util2025', label: 'Utilization 2025' }, { key: 'hours2026', label: 'Hours 2026' },
                  { key: 'capacity2026', label: 'Capacity 2026' }, { key: 'util2026', label: 'Utilization 2026' },
                  { key: 'delta', label: 'Growth %' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={employeeByMonthTableSort.sortKey === col.key} dir={employeeByMonthTableSort.sortDir}
                    onClick={() => employeeByMonthTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {employeeByMonthTableSorted.map((row, i) => (
                <tr key={row.name} className={`border-b dark:border-white/5 border-brand-100
                  ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs">{row.team}</td>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.name}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2025)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2025)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2025 }}>{fmtPct(row.util2025)}%</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2026)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2026)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2026 }}>{fmtPct(row.util2026)}%</td>
                  <td className="py-2 px-3"><DeltaBadge delta={row.delta} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
      </MaximizableChartCard>
      </>
      )}

      <DrillDownModal drillDown={drillDown} data={drillDownData} onClose={() => setDrillDown(null)} />
      <TeamEmployeesModal drillDown={teamEmpDrillDown} onClose={() => setTeamEmpDrillDown(null)} />
    </div>
  )
}

function MinMaxCard({ title, maxLabel, maxValue, minLabel, minValue, isDark }) {
  return (
    <div className="card p-5">
      <h3 className="text-xs font-medium uppercase tracking-wider mb-4 dark:text-white/50 text-brand-500">
        {title}
      </h3>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-light dark:text-white/40 text-brand-400">Highest</p>
          <div className="flex items-baseline justify-between">
            <span className="font-medium dark:text-white text-brand-900 truncate">{maxLabel}</span>
            <span className="font-bold text-lg" style={{ color: maxValue !== undefined ? utilizationColor(maxValue, isDark).bg : undefined }}>
              {maxValue !== undefined ? `${fmtPct(maxValue)}%` : '—'}
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs font-light dark:text-white/40 text-brand-400">Lowest</p>
          <div className="flex items-baseline justify-between">
            <span className="font-medium dark:text-white text-brand-900 truncate">{minLabel}</span>
            <span className="font-bold text-lg" style={{ color: minValue !== undefined ? utilizationColor(minValue, isDark).bg : undefined }}>
              {minValue !== undefined ? `${fmtPct(minValue)}%` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
