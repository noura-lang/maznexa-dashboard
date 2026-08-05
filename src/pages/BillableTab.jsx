import { useMemo, useState } from 'react'
import { useRawTimeLog } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import { useAuth } from '../context/AuthContext'
import { DEFAULT_DENIED_PERMISSIONS } from '../api/accessSheetApi'
import {
  filterRows, calcBillableByEmployee, calcBillableByTeam, calcBillableByPeriod,
  monthKey, quarterKey, toCategoryPercent, getUniqueProjects, round2, roundPct,
  getRowCategory, calcHoursByEmployee,
} from '../api/transformData'
import MultiSelect from '../components/common/MultiSelect'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Greeting from '../components/common/Greeting'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import ChartSortMenu from '../components/common/ChartSortMenu'
import { sortChartRows, SORT_MODES } from '../utils/chartSort'
import { useSortableRows } from '../hooks/useSortableRows'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend as RechartsLegend, Cell, LabelList, PieChart, Pie,
} from 'recharts'

// Same brand order everywhere: Billable (purple) -> Non-Billable (blue) -> Exchange (darkest purple)
const BILLABLE_COLOR     = '#6858a2'
const NON_BILLABLE_COLOR = '#8c8ffe'
const EXCHANGE_COLOR     = '#3d2b7a'

const fmtHours = v => Number(v ?? 0).toFixed(2)
const fmtPct   = v => Math.round(Number(v ?? 0)).toString()

const VIEWS = [
  { id: 'team',     label: 'By Team' },
  { id: 'employee', label: 'By Employee (Top 15)' },
  { id: 'month',    label: 'By Month' },
  { id: 'quarter',  label: 'By Quarter' },
]

// labelKey -> the column label to export it under, per view mode.
const LABEL_COLUMN = { team: 'Team', name: 'Employee', period: 'Period' }

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

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold" style={{ color: p.payload.color }}>{p.name}</p>
      <p className="text-xs mt-0.5">{fmtHours(p.value)} hrs</p>
    </div>
  )
}

// Recharts hands onClick handlers the rendered item's props, which usually
// nest the original data entry under `.payload` — but not always depending
// on which element fired. Checking both keeps every click site working
// regardless of which Recharts component (Bar/Cell) triggered it.
function chartPoint(d) {
  return d?.payload ?? d
}

const CATEGORY_LABEL = { billable: 'Billable', nonBillable: 'Non-Billable', exchange: 'Exchange' }

// Labels are hidden below a share-of-chart threshold so adjacent stacked
// segments never overlap (e.g. a tiny Exchange sliver next to a big Billable one).
// Always vertical bars — wrapped in a horizontally-scrollable canvas so views
// with many categories (e.g. Top 15 Employees) stay legible instead of
// cramming bars together. `onSegmentClick(category, row)` is optional —
// wired to all three stacked Bar series so clicking any segment opens the
// drill-down behind that category for that bar's category value (team,
// employee, month, or quarter, depending on the active view).
function HoursStackedChart({ data, labelKey, height = 360, onSegmentClick }) {
  const maxTotal = Math.max(...data.map(d => d.total), 1)
  const labelFmt = v => (v > 0 && v / maxTotal > 0.04 ? fmtHours(v) : '')
  const cursor = onSegmentClick ? 'pointer' : undefined
  const click = category => (onSegmentClick ? d => onSegmentClick(category, chartPoint(d)) : undefined)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(600, data.length * 70) }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 32, bottom: 70 }}>
            <XAxis dataKey={labelKey} tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={70} />
            <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={fmtHours} />
            <Tooltip content={<HoursTooltip />} />
            <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
            <Bar dataKey="billable" name="Billable" stackId="a" fill={BILLABLE_COLOR} cursor={cursor} onClick={click('billable')}>
              <LabelList dataKey="billable" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="nonBillable" name="Non-Billable" stackId="a" fill={NON_BILLABLE_COLOR} cursor={cursor} onClick={click('nonBillable')}>
              <LabelList dataKey="nonBillable" position="center" formatter={labelFmt} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="exchange" name="Exchange" stackId="a" fill={EXCHANGE_COLOR} radius={[6, 6, 0, 0]} cursor={cursor} onClick={click('exchange')}>
              <LabelList dataKey="exchange" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function PercentStackedChart({ data, labelKey, height = 360, onSegmentClick }) {
  const labelFmt = v => (v > 2 ? `${fmtPct(v)}%` : '')
  const cursor = onSegmentClick ? 'pointer' : undefined
  const click = category => (onSegmentClick ? d => onSegmentClick(category, chartPoint(d)) : undefined)

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(600, data.length * 70) }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 32, bottom: 70 }}>
            <XAxis dataKey={labelKey} tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={70} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`} tick={{ fill: 'currentColor', fontSize: 11 }} />
            <Tooltip content={<PercentTooltip />} />
            <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
            <Bar dataKey="billablePct" name="Billable" stackId="a" fill={BILLABLE_COLOR} cursor={cursor} onClick={click('billable')}>
              <LabelList dataKey="billablePct" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="nonBillablePct" name="Non-Billable" stackId="a" fill={NON_BILLABLE_COLOR} cursor={cursor} onClick={click('nonBillable')}>
              <LabelList dataKey="nonBillablePct" position="center" formatter={labelFmt} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="exchangePct" name="Exchange" stackId="a" fill={EXCHANGE_COLOR} radius={[6, 6, 0, 0]} cursor={cursor} onClick={click('exchange')}>
              <LabelList dataKey="exchangePct" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Two shapes, same as Hours tab's drill-down: 'employees' (name/team/hours,
// opened from the pie chart or a Team/Month/Quarter segment click) and 'raw'
// (individual Raw Time Log rows, opened from an Employee-view segment click
// or the Billable Details table). Same modal shell/style as every other
// drill-down in the app.
function DrillDownModal({ drillDown, onClose }) {
  if (!drillDown) return null
  const { kind, title, rows } = drillDown

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
          ) : kind === 'employees' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Employee', 'Team', 'Hours'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{r.name}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{r.team}</td>
                    <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">{fmtHours(r.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Category', 'Client', 'Project', 'Date', 'Hours'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium" style={{
                      color: getRowCategory(r) === 'billable' ? BILLABLE_COLOR
                        : getRowCategory(r) === 'nonBillable' ? NON_BILLABLE_COLOR : EXCHANGE_COLOR,
                    }}>
                      {CATEGORY_LABEL[getRowCategory(r)]}
                    </td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{r.CLIENT || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{r.PROJECT || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{r.DATE || '—'}</td>
                    <td className="py-2 px-3 font-semibold dark:text-white text-brand-900">{fmtHours(r.HOURS)}</td>
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

export default function BillableTab() {
  const filters = useFilters()
  const { permissions: rawPermissions } = useAuth()
  const permissions = rawPermissions || DEFAULT_DENIED_PERMISSIONS
  const { data: rawRows = [], isLoading, error } = useRawTimeLog()

  const filtered = useMemo(() => filterRows(rawRows, filters), [rawRows, filters])

  const [selectedProjects, setSelectedProjects] = useState([])
  const projectOptions = useMemo(() => getUniqueProjects(filtered), [filtered])

  const scoped = useMemo(
    () => selectedProjects.length > 0
      ? filtered.filter(r => selectedProjects.includes(r.PROJECT))
      : filtered,
    [filtered, selectedProjects]
  )

  const byEmployee   = useMemo(() => calcBillableByEmployee(scoped), [scoped])
  const byTeam       = useMemo(() => calcBillableByTeam(scoped),     [scoped])
  const byMonth      = useMemo(() => calcBillableByPeriod(scoped, monthKey),   [scoped])
  const byQuarter    = useMemo(() => calcBillableByPeriod(scoped, quarterKey), [scoped])
  const top15Employee = useMemo(() => byEmployee.slice(0, 15), [byEmployee])

  const byTeamPct       = useMemo(() => toCategoryPercent(byTeam),        [byTeam])
  const top15EmployeePct = useMemo(() => toCategoryPercent(top15Employee), [top15Employee])
  const byMonthPct      = useMemo(() => toCategoryPercent(byMonth),       [byMonth])
  const byQuarterPct    = useMemo(() => toCategoryPercent(byQuarter),     [byQuarter])

  const totalBillable    = useMemo(() => round2(byEmployee.reduce((s, r) => s + r.billable, 0)),    [byEmployee])
  const totalNonBillable = useMemo(() => round2(byEmployee.reduce((s, r) => s + r.nonBillable, 0)), [byEmployee])
  const totalExchange    = useMemo(() => round2(byEmployee.reduce((s, r) => s + r.exchange, 0)),    [byEmployee])
  const totalHours       = round2(totalBillable + totalNonBillable + totalExchange)
  const billablePct      = totalHours > 0 ? roundPct((totalBillable / totalHours) * 100) : 0

  const byEmployeeExport = useMemo(
    () => byEmployee.map(emp => ({
      ...emp,
      billablePct: emp.total > 0 ? roundPct((emp.billable / emp.total) * 100) : 0,
    })),
    [byEmployee]
  )
  const billableTableSort = useSortableRows(byEmployeeExport, 'total', 'desc')
  const billableTableSorted = billableTableSort.sorted

  const pieData = [
    { name: 'Billable',     value: totalBillable,    color: BILLABLE_COLOR,     category: 'billable' },
    { name: 'Non-Billable', value: totalNonBillable, color: NON_BILLABLE_COLOR, category: 'nonBillable' },
    { name: 'Exchange',     value: totalExchange,    color: EXCHANGE_COLOR,     category: 'exchange' },
  ]

  const [viewMode, setViewMode] = useState('team')
  const viewData = {
    team:     { hours: byTeam,          pct: byTeamPct,         labelKey: 'team' },
    employee: { hours: top15Employee,   pct: top15EmployeePct,  labelKey: 'name' },
    month:    { hours: byMonth,         pct: byMonthPct,        labelKey: 'period' },
    quarter:  { hours: byQuarter,       pct: byQuarterPct,      labelKey: 'period' },
  }[viewMode]

  // Sort dropdown — only meaningful for the category-based views (Team,
  // Employee); By Month/By Quarter stay in chronological order, same rule
  // as every other timeline chart in the app. Both charts sort on 'total'
  // (the underlying absolute hours) so the Hours and Share-of-Time charts
  // rank categories the same way even though one shows % instead of hours.
  const chartSortable = viewMode === 'team' || viewMode === 'employee'
  const [hoursSortMode, setHoursSortMode] = useState(SORT_MODES.DESC)
  const [pctSortMode, setPctSortMode] = useState(SORT_MODES.DESC)
  const hoursSorted = useMemo(
    () => (chartSortable ? sortChartRows(viewData.hours, hoursSortMode, 'total', viewData.labelKey) : viewData.hours),
    [viewData, chartSortable, hoursSortMode]
  )
  const pctSorted = useMemo(
    () => (chartSortable ? sortChartRows(viewData.pct, pctSortMode, 'total', viewData.labelKey) : viewData.pct),
    [viewData, chartSortable, pctSortMode]
  )

  // Drill-down — click a pie slice to see who logged that category's hours;
  // click a stacked bar segment to see the employee breakdown behind that
  // category for the clicked Team/Month/Quarter (or, in the By Employee
  // view, that one employee's raw rows for the category); click an employee
  // row in the table below to see their full raw breakdown.
  const [drillDown, setDrillDown] = useState(null)
  function openCategoryDrillDown(category) {
    const rows = scoped.filter(r => getRowCategory(r) === category)
    setDrillDown({ kind: 'employees', title: `${CATEGORY_LABEL[category]} — Employee Breakdown`, rows: calcHoursByEmployee(rows) })
  }
  function openSegmentDrillDown(category, row) {
    if (viewMode === 'employee') {
      const rows = scoped.filter(r => r.WHO === row.name && getRowCategory(r) === category)
      setDrillDown({ kind: 'raw', title: `${row.name} — ${CATEGORY_LABEL[category]}`, rows })
      return
    }
    const label = viewMode === 'team' ? row.team : row.period
    const rows = scoped.filter(r => {
      if (getRowCategory(r) !== category) return false
      if (viewMode === 'team') return r.TEAM === row.team
      if (viewMode === 'month') return monthKey(r) === row.period
      return quarterKey(r) === row.period
    })
    setDrillDown({ kind: 'employees', title: `${label} — ${CATEGORY_LABEL[category]} — Employee Breakdown`, rows: calcHoursByEmployee(rows) })
  }
  function openEmployeeRowDrillDown(name) {
    const rows = scoped.filter(r => r.WHO === name)
    setDrillDown({ kind: 'raw', title: `${name} — Time Log Breakdown`, rows })
  }

  if (isLoading) return <LoadingSpinner message="Loading billable data..." />
  if (error) return (
    <div className="card p-8 text-center mt-6">
      <p className="text-red-400 font-semibold">{error.message}</p>
    </div>
  )
  if (!permissions.financialAccess) return (
    <div className="card p-8 text-center mt-6">
      <p className="text-sm dark:text-white/50 text-brand-500">
        You don't have access to billable/financial data. Contact your administrator.
      </p>
    </div>
  )

  return (
    <div className="space-y-6 pt-4">
      <Greeting />

      {/* Project filter */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
          Project
        </span>
        <MultiSelect
          options={projectOptions}
          value={selectedProjects}
          onChange={setSelectedProjects}
          placeholder="All Projects"
        />
        <span className="text-xs font-light dark:text-white/40 text-brand-400">
          Use this to isolate Exchange projects (Sanad - eyen, Bold Influence) from the rest
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KPICard label="Total Billable"     value={`${fmtHours(totalBillable)} hrs`} accent />
        <KPICard label="Total Non-Billable" value={`${fmtHours(totalNonBillable)} hrs`} />
        <KPICard label="Total Exchange"     value={`${fmtHours(totalExchange)} hrs`} />
        <KPIRingCard label="Billable Rate"  value={billablePct} sub="of total logged hours" />
      </div>

      {/* Company-wide distribution */}
      <MaximizableChartCard
        title="Company-Wide Distribution"
        height={280}
        modalHeight={440}
        exportRows={pieData}
        exportColumns={[
          { key: 'name', label: 'Category' },
          { key: 'value', label: 'Hours', format: fmtHours },
        ]}
      >
        {h => (
          <ResponsiveContainer width="100%" height={h}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={2}
                cursor="pointer"
                onClick={d => openCategoryDrillDown(chartPoint(d).category)}
                label={({ name, percent }) => `${name} ${fmtPct(percent * 100)}%`}
                labelLine={false}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<PieTooltip />} />
              <RechartsLegend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </MaximizableChartCard>

      {/* View toggle */}
      <div className="flex flex-wrap gap-2">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setViewMode(v.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${viewMode === v.id
                ? 'bg-brand-600 text-white'
                : 'dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 bg-brand-100 text-brand-700 hover:bg-brand-200'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Hours + Percentage charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MaximizableChartCard
          title={`Hours — ${VIEWS.find(v => v.id === viewMode).label}`}
          headerExtra={chartSortable ? <ChartSortMenu value={hoursSortMode} onChange={setHoursSortMode} /> : undefined}
          height={360}
          modalHeight={520}
          exportRows={hoursSorted}
          exportColumns={[
            { key: viewData.labelKey, label: LABEL_COLUMN[viewData.labelKey] },
            { key: 'billable', label: 'Billable (hrs)', format: fmtHours },
            { key: 'nonBillable', label: 'Non-Billable (hrs)', format: fmtHours },
            { key: 'exchange', label: 'Exchange (hrs)', format: fmtHours },
            { key: 'total', label: 'Total (hrs)', format: fmtHours },
          ]}
        >
          {h => <HoursStackedChart data={hoursSorted} labelKey={viewData.labelKey} height={h} onSegmentClick={openSegmentDrillDown} />}
        </MaximizableChartCard>
        <MaximizableChartCard
          title={`Share of Time (%) — ${VIEWS.find(v => v.id === viewMode).label}`}
          headerExtra={chartSortable ? <ChartSortMenu value={pctSortMode} onChange={setPctSortMode} /> : undefined}
          height={360}
          modalHeight={520}
          exportRows={pctSorted}
          exportColumns={[
            { key: viewData.labelKey, label: LABEL_COLUMN[viewData.labelKey] },
            { key: 'billablePct', label: 'Billable %', format: fmtPct },
            { key: 'nonBillablePct', label: 'Non-Billable %', format: fmtPct },
            { key: 'exchangePct', label: 'Exchange %', format: fmtPct },
          ]}
        >
          {h => <PercentStackedChart data={pctSorted} labelKey={viewData.labelKey} height={h} onSegmentClick={openSegmentDrillDown} />}
        </MaximizableChartCard>
      </div>

      {/* Employee table */}
      <MaximizableChartCard
        title="Billable Details by Employee"
        exportRows={billableTableSorted}
        exportColumns={[
          { key: 'name', label: 'Employee' },
          { key: 'team', label: 'Team' },
          { key: 'billable', label: 'Billable (hrs)', format: fmtHours },
          { key: 'nonBillable', label: 'Non-Billable (hrs)', format: fmtHours },
          { key: 'exchange', label: 'Exchange (hrs)', format: fmtHours },
          { key: 'total', label: 'Total (hrs)', format: fmtHours },
          { key: 'billablePct', label: 'Billable %', format: fmtPct },
        ]}
      >
        {() => (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {[
                    { key: 'name', label: 'Employee' },
                    { key: 'team', label: 'Team' },
                    { key: 'billable', label: 'Billable (hrs)' },
                    { key: 'nonBillable', label: 'Non-Billable (hrs)' },
                    { key: 'exchange', label: 'Exchange (hrs)' },
                    { key: 'total', label: 'Total (hrs)' },
                    { key: 'billablePct', label: 'Billable %' },
                  ].map(col => (
                    <th key={col.key} onClick={() => billableTableSort.handleSort(col.key)}
                      className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none
                                 dark:text-white/50 text-brand-500 dark:hover:text-white hover:text-brand-800">
                      {col.label}{billableTableSort.sortArrow(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {billableTableSorted.map((emp, i) => {
                  const pct = emp.billablePct
                  return (
                    <tr
                      key={emp.name}
                      onClick={() => openEmployeeRowDrillDown(emp.name)}
                      className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                        hover:dark:bg-white/5 hover:bg-brand-50
                        ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                    >
                      <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{emp.name}</td>
                      <td className="py-2 px-3 dark:text-white/70 text-brand-600">{emp.team}</td>
                      <td className="py-2 px-3 font-semibold" style={{ color: BILLABLE_COLOR }}>
                        {fmtHours(emp.billable)}
                      </td>
                      <td className="py-2 px-3 font-semibold" style={{ color: NON_BILLABLE_COLOR }}>
                        {fmtHours(emp.nonBillable)}
                      </td>
                      <td className="py-2 px-3 font-semibold" style={{ color: EXCHANGE_COLOR }}>
                        {fmtHours(emp.exchange)}
                      </td>
                      <td className="py-2 px-3 dark:text-white/70 text-brand-600">{fmtHours(emp.total)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full dark:bg-white/10 bg-brand-200 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: BILLABLE_COLOR }}
                            />
                          </div>
                          <span className="text-xs dark:text-white/70 text-brand-600">{fmtPct(pct)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </MaximizableChartCard>

      <DrillDownModal drillDown={drillDown} onClose={() => setDrillDown(null)} />
    </div>
  )
}
