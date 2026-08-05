import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useRawTimeLog } from '../hooks/useSheetData'
import { fetchSecureJson } from '../api/secureApi'
import {
  buildCostRateMap, getCostMonthOptions, calcEmployeeCostRows,
  filterCostRows, getCostClientOptions, getCostEmployeeOptions, calcCostTotals,
  calcCostByClient, calcCostByEmployeeMonthly, calcCostByProjectMonthly,
  calcCostByEmployee, calcCostByProject, calcMonthlyCostTrend, formatMonthKey,
} from '../api/costSheetApi'
import LoadingSpinner from '../components/common/LoadingSpinner'
import KPICard from '../components/common/KPICard'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import ChartSortMenu from '../components/common/ChartSortMenu'
import SortableTh from '../components/common/SortableTh'
import { sortChartRows, SORT_MODES } from '../utils/chartSort'
import { useSortableRows } from '../hooks/useSortableRows'
import Dropdown from '../components/common/Dropdown'
import MultiSelect from '../components/common/MultiSelect'
import { CHART_COLORS } from '../utils/chartColors'
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend as RechartsLegend, LabelList,
} from 'recharts'

const ACCENT_LINE = '#8c8ffe' // Maznexa secondary blue — the one non-bar line color on both charts

const fmtSAR = n => `SAR ${Math.round(n ?? 0).toLocaleString()}`
const fmtHours = n => Number(n ?? 0).toFixed(2)

function GenericTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-xs" style={{ color: p.color || p.fill }}>
          {p.name}: <span className="font-bold">{p.name.includes('%') ? `${p.value}%` : fmtSAR(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

// recharts' default Legend colors each entry's TEXT with that series' own
// fill/stroke — fine for light colors, but "Actual Cost"'s dark brand
// purple (CHART_COLORS[5]) renders almost invisibly on this card's dark-mode
// background. Custom renderer: colored swatch stays per-series, label text
// uses a fixed, always-readable color in both themes.
function BrandLegend({ payload }) {
  if (!payload?.length) return null
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs mt-2 list-none">
      {payload.map(entry => (
        <li key={entry.value} className="flex items-center gap-1.5 dark:text-white/70 text-brand-700">
          <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
          {entry.value}
        </li>
      ))}
    </ul>
  )
}

// Cost growth is bad news going up (unlike utilization growth elsewhere in
// the app) — colors are deliberately flipped from ComparisonTab's DeltaBadge:
// a positive delta (cost rose) reads red, negative (cost fell) reads green.
function CostDeltaBadge({ delta }) {
  if (delta === null || delta === undefined) return null
  const rose = delta >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold
      ${rose ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
      {rose ? '▲' : '▼'} {Math.abs(Math.round(delta))}%
    </span>
  )
}

// A cost figure that respects the "no rate recorded" / "partial rate" flags
// every grouped row carries — never renders a bare SAR 0 for hours that
// simply have no cost data yet, per the sheet-inspection findings.
function CostValue({ value, hasNoRate, isPartialRate }) {
  if (hasNoRate) {
    return <span className="italic font-normal dark:text-white/30 text-brand-400">No rate recorded</span>
  }
  return (
    <span>
      {fmtSAR(value)}
      {isPartialRate && (
        <span className="ml-1 text-amber-400" title="Some hours in this group have no recorded rate — this figure is partial">⚠</span>
      )}
    </span>
  )
}

function DrillDownModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { title, rows, nameKey, nameLabel, extraKey, extraLabel } = drillDown

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
          <h3 className="text-sm font-semibold dark:text-white text-brand-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-lg leading-none px-2 dark:text-white/50 text-brand-400
                       hover:dark:text-white hover:text-brand-800"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No data found for this breakdown.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {[nameLabel, extraLabel, 'Hours', 'Actual Cost', 'Buffered Cost'].filter(Boolean).map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{r[nameKey] || 'Unknown'}</td>
                    {extraKey && <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs">{r[extraKey] || '—'}</td>}
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(r.hours)}</td>
                    <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">
                      <CostValue value={r.actualCost} hasNoRate={r.hasNoRate} isPartialRate={r.isPartialRate} />
                    </td>
                    <td className="py-2 px-3 font-semibold dark:text-brand-300 text-brand-700">
                      <CostValue value={r.bufferedCost} hasNoRate={r.hasNoRate} isPartialRate={r.isPartialRate} />
                    </td>
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

// Cost Analysis — a financially sensitive tab gated by its own Permissions
// flag (App.jsx), reading the separate Cost sheet through the secure
// /api/cost-data route (see api/cost-data.js) rather than the signed-in
// user's own Google OAuth token — that route verifies the caller's Firebase
// ID token server-side and returns only their own rate rows (every row, if
// their Permissions row has Admin=TRUE), so no employee Google account ever
// needs direct access to this sheet. Hours still come from the Main Sheet's
// Raw Time Log (already public, shared with every other tab via
// useRawTimeLog), joined against the (now server-filtered) Cost sheet rates
// client-side, exactly as before. Independent of the shared FilterContext
// date range — this tab has its own Month/Client/Employee filters instead,
// matching the AM Performance tab's pattern.
export default function CostAnalysisTab() {
  const { firebaseUser } = useAuth()
  const { data: rawTimeLog = [], isLoading: rtlLoading, error: rtlError } = useRawTimeLog()
  const [costRates, setCostRates] = useState(null) // null while loading
  const [loadError, setLoadError] = useState(null)

  const [selectedMonth, setSelectedMonth] = useState('All')
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedEmployees, setSelectedEmployees] = useState([])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const rates = await fetchSecureJson('/api/cost-data', firebaseUser)
      setCostRates(rates)
    } catch (err) {
      console.error('Failed to load Cost Analysis data:', err)
      setLoadError(err.message)
    }
  }, [firebaseUser])

  useEffect(() => { load() }, [load])

  const rateMap = useMemo(() => (costRates ? buildCostRateMap(costRates) : null), [costRates])
  const monthOptions = useMemo(() => (costRates ? getCostMonthOptions(costRates) : []), [costRates])

  const allRows = useMemo(
    () => (rateMap && rawTimeLog.length ? calcEmployeeCostRows(rawTimeLog, rateMap) : []),
    [rateMap, rawTimeLog]
  )

  const clientOptions = useMemo(() => getCostClientOptions(allRows), [allRows])
  const employeeOptions = useMemo(() => getCostEmployeeOptions(allRows), [allRows])

  // Default to everything selected (same convention as the Team/Employee
  // filters elsewhere) — only runs once the options first load.
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && clientOptions.length > 0 && employeeOptions.length > 0) {
      setSelectedClients(clientOptions)
      setSelectedEmployees(employeeOptions)
      initialized.current = true
    }
  }, [clientOptions, employeeOptions])

  const filteredRows = useMemo(
    () => filterCostRows(allRows, selectedMonth, selectedClients, selectedEmployees),
    [allRows, selectedMonth, selectedClients, selectedEmployees]
  )

  const totals = useMemo(() => calcCostTotals(filteredRows), [filteredRows])
  const byClient = useMemo(() => calcCostByClient(filteredRows), [filteredRows])
  const byEmployeeMonthly = useMemo(() => calcCostByEmployeeMonthly(filteredRows), [filteredRows])
  const byProjectMonthly = useMemo(() => calcCostByProjectMonthly(filteredRows), [filteredRows])

  // Chart sort dropdown (Cost by Client is category-based, so it gets one)
  // + clickable-header table sort. calcCostByClient already sorts by
  // actualCost desc, so that's the matching initial key/dir; the two
  // Monthly tables sort by month-then-cost (a compound key a single-column
  // sort can't represent), so their default view is preserved via a
  // synthetic `_idx` position field until the user clicks a header — same
  // pattern used on ComparisonTab's month-scoped tables.
  const [clientChartSortMode, setClientChartSortMode] = useState(SORT_MODES.DESC)
  const byClientChartSorted = useMemo(
    () => sortChartRows(byClient, clientChartSortMode, 'actualCost', 'client'),
    [byClient, clientChartSortMode]
  )
  const clientTableSort = useSortableRows(byClient, 'actualCost', 'desc')
  const clientTableSorted = clientTableSort.sorted

  const employeeMonthlyIndexed = useMemo(() => byEmployeeMonthly.map((r, i) => ({ ...r, _idx: i })), [byEmployeeMonthly])
  const employeeMonthlyTableSort = useSortableRows(employeeMonthlyIndexed, '_idx', 'asc')
  const employeeMonthlyTableSorted = employeeMonthlyTableSort.sorted

  const projectMonthlyIndexed = useMemo(() => byProjectMonthly.map((r, i) => ({ ...r, _idx: i })), [byProjectMonthly])
  const projectMonthlyTableSort = useSortableRows(projectMonthlyIndexed, '_idx', 'asc')
  const projectMonthlyTableSorted = projectMonthlyTableSort.sorted

  // Monthly trend deliberately ignores the Month filter (it IS the
  // month-by-month view) but still respects Client/Employee, same
  // convention as the AM Performance tab's monthly chart.
  const trendRows = useMemo(
    () => filterCostRows(allRows, 'All', selectedClients, selectedEmployees),
    [allRows, selectedClients, selectedEmployees]
  )
  const monthlyTrend = useMemo(() => calcMonthlyCostTrend(trendRows), [trendRows])

  const [drillDown, setDrillDown] = useState(null)

  function openClientDrillDown(client) {
    const rows = filteredRows.filter(r => r.client === client)
    setDrillDown({
      title: `${client || 'Unknown'} — Employee Breakdown`,
      nameKey: 'employee', nameLabel: 'Employee',
      rows: calcCostByEmployee(rows),
    })
  }
  function openEmployeeMonthDrillDown(employee, monthKey) {
    const rows = filteredRows.filter(r => r.employee === employee && r.monthKey === monthKey)
    setDrillDown({
      title: `${employee} — ${formatMonthKey(monthKey)} Breakdown`,
      nameKey: 'project', nameLabel: 'Project', extraKey: 'client', extraLabel: 'Client',
      rows: calcCostByProject(rows),
    })
  }
  function openProjectMonthDrillDown(project, client, monthKey) {
    const rows = filteredRows.filter(r => r.project === project && r.client === client && r.monthKey === monthKey)
    setDrillDown({
      title: `${project || 'Unknown'} (${client || '—'}) — ${formatMonthKey(monthKey)} Breakdown`,
      nameKey: 'employee', nameLabel: 'Employee',
      rows: calcCostByEmployee(rows),
    })
  }

  if ((costRates === null && !loadError) || rtlLoading) {
    return <LoadingSpinner message="Loading Cost Analysis data..." />
  }

  if (loadError || rtlError) {
    return (
      <div className="card p-8 text-center mt-6 space-y-3">
        <p className="text-red-400 font-semibold">{loadError || rtlError?.message}</p>
        <p className="text-xs dark:text-white/50 text-brand-500">
          This usually means your account isn't set up correctly in the Access Sheet yet, or your
          sign-in session expired — try signing in again, or contact an admin if the problem persists.
        </p>
        <button onClick={load} className="filter-input text-xs px-4 py-1.5">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-4">
      {/* This tab's own filters — Month/Client/Employee, independent of the
          shared filter bar (matches the AM Performance tab's pattern) */}
      <div className="card p-4 flex flex-wrap items-center gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Month
          </label>
          <Dropdown
            options={[{ value: 'All', label: 'All' }, ...monthOptions.map(m => ({ value: m, label: formatMonthKey(m) }))]}
            value={selectedMonth}
            onChange={setSelectedMonth}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Client
          </label>
          <MultiSelect options={clientOptions} value={selectedClients} onChange={setSelectedClients} placeholder="All Clients" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Employee
          </label>
          <MultiSelect options={employeeOptions} value={selectedEmployees} onChange={setSelectedEmployees} placeholder="All Employees" />
        </div>
      </div>

      {/* Totals — respect all three filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Actual Cost" value={fmtSAR(totals.actualCost)} accent />
        <KPICard label="Buffered Cost (+20%)" value={fmtSAR(totals.bufferedCost)} />
        <KPICard label="Buffer Amount" value={fmtSAR(totals.bufferAmount)} />
      </div>
      {totals.hasUnknown && (
        <p className="text-xs font-medium text-center" style={{ color: ACCENT_LINE }}>
          ⚠ {fmtHours(totals.unknownHours)} hrs across {totals.unknownEmployeeCount} employee{totals.unknownEmployeeCount === 1 ? '' : 's'} have
          no recorded cost rate for this period and are excluded from the totals above.
        </p>
      )}

      {/* Cost by Client — chart + table, click either to drill into employees */}
      <MaximizableChartCard
        title="Cost by Client"
        headerExtra={<ChartSortMenu value={clientChartSortMode} onChange={setClientChartSortMode} />}
        height={320}
        modalHeight={480}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={byClientChartSorted} margin={{ top: 28, bottom: 40 }}>
              <XAxis dataKey="client" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-30} textAnchor="end" height={60} interval={0} />
              <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={v => v.toLocaleString()} />
              <Tooltip content={<GenericTooltip />} />
              <RechartsLegend content={<BrandLegend />} />
              <Bar dataKey="actualCost" name="Actual Cost" fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]}
                onClick={d => openClientDrillDown(d.client)} cursor="pointer" />
              <Bar dataKey="bufferedCost" name="Buffered Cost" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]}
                onClick={d => openClientDrillDown(d.client)} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">Cost by Client</h3>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-900 bg-white">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'client', label: 'Client' }, { key: 'hours', label: 'Hours' },
                  { key: 'actualCost', label: 'Actual Cost' }, { key: 'bufferedCost', label: 'Buffered Cost' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={clientTableSort.sortKey === col.key} dir={clientTableSort.sortDir}
                    onClick={() => clientTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {clientTableSorted.map((row, i) => (
                <tr key={row.client} onClick={() => openClientDrillDown(row.client)}
                  className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                    hover:dark:bg-white/5 hover:bg-brand-50
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.client || 'Unknown'}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours)}</td>
                  <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">
                    <CostValue value={row.actualCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                  <td className="py-2 px-3 font-semibold dark:text-brand-300 text-brand-700">
                    <CostValue value={row.bufferedCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost by Employee — Monthly, click a row to drill into its clients/projects */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">Cost by Employee — Monthly</h3>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-900 bg-white">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'monthKey', label: 'Month' }, { key: 'employee', label: 'Employee' }, { key: 'hours', label: 'Hours' },
                  { key: 'actualCost', label: 'Actual Cost' }, { key: 'bufferedCost', label: 'Buffered Cost' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={employeeMonthlyTableSort.sortKey === col.key} dir={employeeMonthlyTableSort.sortDir}
                    onClick={() => employeeMonthlyTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {employeeMonthlyTableSorted.map((row, i) => (
                <tr key={`${row.employee}-${row.monthKey}`} onClick={() => openEmployeeMonthDrillDown(row.employee, row.monthKey)}
                  className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                    hover:dark:bg-white/5 hover:bg-brand-50
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs whitespace-nowrap">{formatMonthKey(row.monthKey)}</td>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.employee}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours)}</td>
                  <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">
                    <CostValue value={row.actualCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                  <td className="py-2 px-3 font-semibold dark:text-brand-300 text-brand-700">
                    <CostValue value={row.bufferedCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost by Project — Monthly, click a row to drill into its employees */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">Cost by Project — Monthly</h3>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-900 bg-white">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {[
                  { key: 'monthKey', label: 'Month' }, { key: 'project', label: 'Project' }, { key: 'client', label: 'Client' },
                  { key: 'hours', label: 'Hours' }, { key: 'actualCost', label: 'Actual Cost' }, { key: 'bufferedCost', label: 'Buffered Cost' },
                ].map(col => (
                  <SortableTh key={col.key} label={col.label} className="whitespace-nowrap"
                    active={projectMonthlyTableSort.sortKey === col.key} dir={projectMonthlyTableSort.sortDir}
                    onClick={() => projectMonthlyTableSort.handleSort(col.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {projectMonthlyTableSorted.map((row, i) => (
                <tr key={`${row.project}-${row.client}-${row.monthKey}`}
                  onClick={() => openProjectMonthDrillDown(row.project, row.client, row.monthKey)}
                  className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                    hover:dark:bg-white/5 hover:bg-brand-50
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                  <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs whitespace-nowrap">{formatMonthKey(row.monthKey)}</td>
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{row.project || 'Unknown'}</td>
                  <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs">{row.client || '—'}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(row.hours)}</td>
                  <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">
                    <CostValue value={row.actualCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                  <td className="py-2 px-3 font-semibold dark:text-brand-300 text-brand-700">
                    <CostValue value={row.bufferedCost} hasNoRate={row.hasNoRate} isPartialRate={row.isPartialRate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Cost Trend — Actual/Buffered bars with a period-over-period
          Growth % line; unlike Utilization growth elsewhere, rising cost is
          the "bad" direction (see CostDeltaBadge) */}
      <MaximizableChartCard
        title="Monthly Cost Trend"
        headerExtra={monthlyTrend.length > 1 && (
          <span className="flex items-center gap-1 text-xs dark:text-white/60 text-brand-600">
            Latest Growth <CostDeltaBadge delta={monthlyTrend[monthlyTrend.length - 1]?.growthPct} />
          </span>
        )}
        height={340}
        modalHeight={480}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <ComposedChart data={monthlyTrend} margin={{ top: 28 }}>
              <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={m => m.slice(0, 3)} />
              <YAxis yAxisId="left" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={v => v.toLocaleString()} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={v => `${v}%`} />
              <Tooltip content={<GenericTooltip />} />
              <RechartsLegend content={<BrandLegend />} />
              <Bar yAxisId="left" dataKey="actualCost" name="Actual Cost" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} />
              <Bar yAxisId="left" dataKey="bufferedCost" name="Buffered Cost" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]} />
              <Line yAxisId="right" dataKey="growthPct" name="Growth %" stroke={ACCENT_LINE} strokeWidth={2} dot={{ r: 3 }}>
                <LabelList dataKey="growthPct" position="top" formatter={v => (v === null || v === undefined ? '' : `${v}%`)}
                  style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      <DrillDownModal drillDown={drillDown} onClose={() => setDrillDown(null)} />
    </div>
  )
}
