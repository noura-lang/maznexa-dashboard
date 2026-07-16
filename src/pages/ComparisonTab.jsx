import { useEffect, useMemo, useRef, useState } from 'react'
import { format, subDays, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns'
import { useCapacity2025, useCapacity2026, useRawTimeLog } from '../hooks/useSheetData'
import {
  filterCapacityByMonth, filterCapacityByQuarter, filterCapacityYTD, calcYearlyComparison, calcQuarterlyComparison,
  calcMonthlyUtilizationTrend, calcTeamUtilizationSummary, calcCapacitySummary,
  calcComparisonByTeam, calcComparisonByEmployee, calcCapacityByEmployee, calcGrowthPct, utilizationColor,
  getUniqueCapacityTeams, getUniqueCapacityEmployees,
  filterTimeLogByMonth, filterTimeLogByQuarter, calcHoursByProject,
} from '../api/transformData'
import MultiSelect from '../components/common/MultiSelect'
import LoadingSpinner from '../components/common/LoadingSpinner'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend as RechartsLegend, Cell, LabelList, PieChart, Pie,
  ComposedChart, Line,
} from 'recharts'

const COLOR_2025 = '#6858a2' // primary purple
const COLOR_2026 = '#8c8ffe' // secondary blue
const GROWTH_COLOR = '#3d2b7a' // darkest purple, for the growth-% line

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

function ComboTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-2 max-w-[180px] truncate">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.fill || p.stroke || p.color }}>
          {p.name}: <span className="font-bold">
            {p.dataKey === 'growthPct' ? `${fmtPct(p.value)}%` : `${fmtHours(p.value)} hrs`}
          </span>
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
  const formatter = unit === '%' ? (v => `${fmtPct(v)}%`) : (v => fmtHours(v))
  const tooltip = unit === '%' ? <PercentTooltip /> : <HoursTooltip />
  const barCursor = onBarClick ? { cursor: 'pointer' } : {}

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 32, bottom: 8 }}>
        <XAxis dataKey={xKey} tick={{ fill: 'currentColor', fontSize: 11 }} />
        <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={unit === '%' ? (v => `${Math.round(v)}%`) : fmtHours} />
        <Tooltip content={tooltip} />
        <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 8, fontSize: '12px' }} />
        <Bar dataKey={key2025} name="2025" fill={COLOR_2025} radius={[4, 4, 0, 0]}
          onClick={onBarClick ? () => onBarClick(2025) : undefined} {...barCursor}>
          <LabelList dataKey={key2025} position="top" formatter={formatter} style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
        </Bar>
        <Bar dataKey={key2026} name="2026" fill={COLOR_2026} radius={[4, 4, 0, 0]}
          onClick={onBarClick ? () => onBarClick(2026) : undefined} {...barCursor}>
          {data.map((d, i) => (
            <Cell key={i} fill={COLOR_2026} fillOpacity={d.status === 'partial' ? 0.4 : 1} />
          ))}
          <LabelList dataKey={key2026} position="top" formatter={formatter} style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// One "Comparison" section: Hours + Utilization mini-charts side by side,
// with growth% / headcount shown as badges (never mixed onto a bar axis).
// `onBarClick(year)` is optional — only the Year section wires it up, to open
// a drill-down of exactly the employee rows that were summed into that bar.
function ComparisonSection({ title, data, xKey, growthPct, empCount2025, empCount2026, onBarClick }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">{title}</h3>
        <div className="flex items-center gap-3 text-xs dark:text-white/60 text-brand-600">
          {empCount2025 !== undefined && (
            <span>Employees: <b style={{ color: COLOR_2025 }}>{empCount2025}</b> → <b style={{ color: COLOR_2026 }}>{empCount2026}</b></span>
          )}
          {growthPct !== undefined && (
            <span className="flex items-center gap-1">Growth <DeltaBadge delta={growthPct} /></span>
          )}
        </div>
      </div>
      {onBarClick && (
        <p className="text-xs dark:text-white/40 text-brand-400 -mt-2 mb-4">
          Click a bar to see the employee-level breakdown behind it.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium mb-2 dark:text-white/50 text-brand-500">Hours</p>
          <CompareBarChart data={data} dataKeyPrefix="hours" xKey={xKey} unit="hrs" onBarClick={onBarClick} />
        </div>
        <div>
          <p className="text-xs font-medium mb-2 dark:text-white/50 text-brand-500">Utilization %</p>
          <CompareBarChart data={data} dataKeyPrefix="util" xKey={xKey} unit="%" onBarClick={onBarClick} />
        </div>
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
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
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
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
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

export default function ComparisonTab() {
  const { data: cap2025 = [], isLoading: l1, error: e1 } = useCapacity2025()
  const { data: cap2026 = [], isLoading: l2, error: e2 } = useCapacity2026()
  const { data: rawTimeLog = [] } = useRawTimeLog()

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

  const employeeTableRows = useMemo(
    () => employeeByMonth.filter(row =>
      (tableTeams.length === 0 || tableTeams.includes(row.team)) &&
      (tableEmployees.length === 0 || tableEmployees.includes(row.name))
    ),
    [employeeByMonth, tableTeams, tableEmployees]
  )

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
      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-center gap-3 relative z-50">
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Date</label>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="filter-input">
            {DATE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Month</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="filter-input">
            {MONTH_SHORT.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Quarter</label>
          <select value={selectedQuarter} onChange={e => setSelectedQuarter(e.target.value)} className="filter-input">
            {QUARTER_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Team</label>
          <MultiSelect options={teamOptions} value={selectedTeams}
            onChange={val => { setSelectedTeams(val); setSelectedEmployees(getUniqueCapacityEmployees(allCapRows, val)) }}
            placeholder="All Teams" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Employee</label>
          <MultiSelect options={employeeOptions} value={selectedEmployees} onChange={setSelectedEmployees} placeholder="All Employees" />
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
      <p className="text-xs dark:text-white/40 text-brand-400 -mt-3">
        Date narrows the current-year (2026) view within the selected Month; 2025 data is stored monthly so it always reflects the full month.
      </p>

      {/* Donuts */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-2 dark:text-white/80 text-brand-800">
          Utilization — {monthName}
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
          title="Highest vs Lowest Monthly Utilization 2025"
          maxLabel={maxMonth2025 ? MONTH_FULL[maxMonth2025.month - 1] : '—'} maxValue={maxMonth2025?.util}
          minLabel={minMonth2025 ? MONTH_FULL[minMonth2025.month - 1] : '—'} minValue={minMonth2025?.util}
        />
        <MinMaxCard
          title="Top vs Lowest Team Utilization 2025"
          maxLabel={maxTeam2025?.team || '—'} maxValue={maxTeam2025?.util}
          minLabel={minTeam2025?.team || '—'} minValue={minTeam2025?.util}
        />
        <MinMaxCard
          title="Highest vs Lowest Monthly Utilization 2026"
          maxLabel={maxMonth2026 ? MONTH_FULL[maxMonth2026.month - 1] : '—'} maxValue={maxMonth2026?.util}
          minLabel={minMonth2026 ? MONTH_FULL[minMonth2026.month - 1] : '—'} minValue={minMonth2026?.util}
        />
        <MinMaxCard
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
        onBarClick={year => openDrillDown('detail', year, 'year', null, yearRangeLabel)}
      />

      <ComparisonSection
        title={`Quarterly Comparison for 2025 vs 2026${selectedQuarter !== 'all' ? ` — ${selectedQuarter}` : ''}`}
        data={quarterlyFiltered.map(q => ({ ...q, label: q.status === 'partial' ? `${q.quarter} (In Progress)` : q.quarter }))}
        xKey="label"
      />

      {/* Quarterly table — same columns as the Team table, grouped by Quarter */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Quarterly Comparison for 2025 vs 2026
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Quarter', 'Employees 2025', 'Hours 2025', 'Capacity 2025', 'Utilization 2025',
                  'Employees 2026', 'Hours 2026', 'Capacity 2026', 'Utilization 2026', 'Growth %'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                         dark:text-white/50 text-brand-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarterlyFiltered.map((row, i) => (
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
      </div>

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
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Monthly Comparison Table for 2025 vs 2026 — Jan - {monthName}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Month', 'Employees 2025', 'Hours 2025', 'Capacity 2025', 'Utilization 2025',
                    'Employees 2026', 'Hours 2026', 'Capacity 2026', 'Utilization 2026', 'Growth %'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyCompared.map((row, i) => (
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
        </div>
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
      {/* Team combo chart — deliberate dual-axis exception (bars = hours, line = growth %) */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-1 dark:text-white/80 text-brand-800">
          Team Utilization Comparison by Month — {monthName}
        </h3>
        <p className="text-xs dark:text-white/40 text-brand-400 mb-4">
          Bars (left axis) = hours logged. Line (right axis) = utilization growth %.
        </p>
        <ResponsiveContainer width="100%" height={Math.max(320, teamByMonth.length * 8) + 60}>
          <ComposedChart data={teamByMonth} margin={{ top: 32, bottom: 60 }}>
            <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" height={70} interval={0} />
            <YAxis yAxisId="left" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={fmtHours}
              label={{ value: 'Hours', angle: -90, position: 'insideLeft', fill: 'currentColor', fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: GROWTH_COLOR, fontSize: 11 }} tickFormatter={v => `${Math.round(v)}%`}
              label={{ value: 'Growth %', angle: 90, position: 'insideRight', fill: GROWTH_COLOR, fontSize: 11 }} />
            <Tooltip content={<ComboTooltip />} />
            <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
            <Bar yAxisId="left" dataKey="hours2025" name="Hours 2025" fill={COLOR_2025} radius={[3, 3, 0, 0]} />
            <Bar yAxisId="left" dataKey="hours2026" name="Hours 2026" fill={COLOR_2026} radius={[3, 3, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="delta" name="Growth %" stroke={GROWTH_COLOR} strokeWidth={2} dot={{ r: 3, fill: GROWTH_COLOR }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Table (a): Team Utilization Comparison by Month */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Team Utilization Comparison by Month — {monthName}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Team', 'Employees 2025', 'Hours 2025', 'Capacity 2025', 'Utilization 2025',
                  'Employees 2026', 'Hours 2026', 'Capacity 2026', 'Utilization 2026', 'Growth %'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                         dark:text-white/50 text-brand-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamByMonth.map((row, i) => (
                <tr key={row.team} className={`border-b dark:border-white/5 border-brand-100
                  ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.team}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{row.empCount2025}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2025)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2025)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2025 }}>{fmtPct(row.util2025)}%</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{row.empCount2026}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours2026)}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.capacity2026)}</td>
                  <td className="py-2 px-3 font-semibold" style={{ color: COLOR_2026 }}>{fmtPct(row.util2026)}%</td>
                  <td className="py-2 px-3"><DeltaBadge delta={row.delta} /></td>
                </tr>
              ))}
              <tr className="border-t-2 dark:border-white/20 border-brand-300 font-semibold">
                <td className="py-2 px-3 dark:text-white text-brand-900">{grandSummary.team}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{grandSummary.empCount2025}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.hours2025)}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.capacity2025)}</td>
                <td className="py-2 px-3" style={{ color: COLOR_2025 }}>{fmtPct(grandSummary.util2025)}%</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{grandSummary.empCount2026}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.hours2026)}</td>
                <td className="py-2 px-3 dark:text-white/80 text-brand-700">{fmtHours(grandSummary.capacity2026)}</td>
                <td className="py-2 px-3" style={{ color: COLOR_2026 }}>{fmtPct(grandSummary.util2026)}%</td>
                <td className="py-2 px-3"><DeltaBadge delta={grandSummary.delta} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Table (b): Employee Utilization Comparison by Month */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Employee Utilization Comparison by Month — {monthName}
        </h3>

        {/* Table-local sub-filters — independent of the page-level filters above */}
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b dark:border-white/10 border-brand-200">
          <span className="text-xs font-semibold uppercase tracking-wider dark:text-white/50 text-brand-500">
            Table filters
          </span>
          <div className="flex items-center gap-2">
            <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Team</label>
            <MultiSelect options={tableTeamOptions} value={tableTeams}
              onChange={val => { setTableTeams(val); setTableEmployees(getUniqueCapacityEmployees([...cap2025Month, ...cap2026Month], val)) }}
              placeholder="All Teams" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Employee</label>
            <MultiSelect options={tableEmployeeOptions} value={tableEmployees} onChange={setTableEmployees} placeholder="All Employees" />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-900 bg-white">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Team', 'Employee', 'Hours 2025', 'Capacity 2025', 'Utilization 2025',
                  'Hours 2026', 'Capacity 2026', 'Utilization 2026', 'Growth %'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                         dark:text-white/50 text-brand-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employeeTableRows.map((row, i) => (
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
      </div>
      </>
      )}

      <DrillDownModal drillDown={drillDown} data={drillDownData} onClose={() => setDrillDown(null)} />
    </div>
  )
}

function MinMaxCard({ title, maxLabel, maxValue, minLabel, minValue }) {
  return (
    <div className="card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-4 dark:text-white/50 text-brand-500">
        {title}
      </h3>
      <div className="space-y-3">
        <div>
          <p className="text-xs dark:text-white/40 text-brand-400">Highest</p>
          <div className="flex items-baseline justify-between">
            <span className="font-medium dark:text-white text-brand-900 truncate">{maxLabel}</span>
            <span className="font-bold text-lg" style={{ color: maxValue !== undefined ? utilizationColor(maxValue).bg : undefined }}>
              {maxValue !== undefined ? `${fmtPct(maxValue)}%` : '—'}
            </span>
          </div>
        </div>
        <div>
          <p className="text-xs dark:text-white/40 text-brand-400">Lowest</p>
          <div className="flex items-baseline justify-between">
            <span className="font-medium dark:text-white text-brand-900 truncate">{minLabel}</span>
            <span className="font-bold text-lg" style={{ color: minValue !== undefined ? utilizationColor(minValue).bg : undefined }}>
              {minValue !== undefined ? `${fmtPct(minValue)}%` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
