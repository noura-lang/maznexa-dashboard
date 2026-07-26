import { useMemo, useState } from 'react'
import { useRawTimeLog } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import {
  filterRows, calcBillableByEmployee, calcBillableByTeam, calcBillableByPeriod,
  monthKey, quarterKey, toCategoryPercent, getUniqueProjects, round2, roundPct,
} from '../api/transformData'
import MultiSelect from '../components/common/MultiSelect'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import LoadingSpinner from '../components/common/LoadingSpinner'
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

// Labels are hidden below a share-of-chart threshold so adjacent stacked
// segments never overlap (e.g. a tiny Exchange sliver next to a big Billable one).
// Always vertical bars — wrapped in a horizontally-scrollable canvas so views
// with many categories (e.g. Top 15 Employees) stay legible instead of
// cramming bars together.
function HoursStackedChart({ data, labelKey }) {
  const maxTotal = Math.max(...data.map(d => d.total), 1)
  const labelFmt = v => (v > 0 && v / maxTotal > 0.04 ? fmtHours(v) : '')

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(600, data.length * 70) }}>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 32, bottom: 70 }}>
            <XAxis dataKey={labelKey} tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={70} />
            <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={fmtHours} />
            <Tooltip content={<HoursTooltip />} />
            <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
            <Bar dataKey="billable" name="Billable" stackId="a" fill={BILLABLE_COLOR}>
              <LabelList dataKey="billable" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="nonBillable" name="Non-Billable" stackId="a" fill={NON_BILLABLE_COLOR}>
              <LabelList dataKey="nonBillable" position="center" formatter={labelFmt} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="exchange" name="Exchange" stackId="a" fill={EXCHANGE_COLOR} radius={[6, 6, 0, 0]}>
              <LabelList dataKey="exchange" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function PercentStackedChart({ data, labelKey }) {
  const labelFmt = v => (v > 2 ? `${fmtPct(v)}%` : '')

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(600, data.length * 70) }}>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 32, bottom: 70 }}>
            <XAxis dataKey={labelKey} tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={70} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`} tick={{ fill: 'currentColor', fontSize: 11 }} />
            <Tooltip content={<PercentTooltip />} />
            <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
            <Bar dataKey="billablePct" name="Billable" stackId="a" fill={BILLABLE_COLOR}>
              <LabelList dataKey="billablePct" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="nonBillablePct" name="Non-Billable" stackId="a" fill={NON_BILLABLE_COLOR}>
              <LabelList dataKey="nonBillablePct" position="center" formatter={labelFmt} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
            </Bar>
            <Bar dataKey="exchangePct" name="Exchange" stackId="a" fill={EXCHANGE_COLOR} radius={[6, 6, 0, 0]}>
              <LabelList dataKey="exchangePct" position="center" formatter={labelFmt} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function BillableTab() {
  const filters = useFilters()
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

  const pieData = [
    { name: 'Billable',     value: totalBillable,    color: BILLABLE_COLOR },
    { name: 'Non-Billable', value: totalNonBillable, color: NON_BILLABLE_COLOR },
    { name: 'Exchange',     value: totalExchange,    color: EXCHANGE_COLOR },
  ]

  const [viewMode, setViewMode] = useState('team')
  const viewData = {
    team:     { hours: byTeam,          pct: byTeamPct,         labelKey: 'team' },
    employee: { hours: top15Employee,   pct: top15EmployeePct,  labelKey: 'name' },
    month:    { hours: byMonth,         pct: byMonthPct,        labelKey: 'period' },
    quarter:  { hours: byQuarter,       pct: byQuarterPct,      labelKey: 'period' },
  }[viewMode]

  if (isLoading) return <LoadingSpinner message="Loading billable data..." />
  if (error) return (
    <div className="card p-8 text-center mt-6">
      <p className="text-red-400 font-semibold">{error.message}</p>
    </div>
  )

  return (
    <div className="space-y-6 pt-4">
      {/* Project filter */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider dark:text-white/50 text-brand-500">
          Project
        </span>
        <MultiSelect
          options={projectOptions}
          value={selectedProjects}
          onChange={setSelectedProjects}
          placeholder="All Projects"
        />
        <span className="text-xs dark:text-white/40 text-brand-400">
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
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Company-Wide Distribution
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={2}
              label={({ name, percent }) => `${name} ${fmtPct(percent * 100)}%`}
              labelLine={false}
            >
              {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={<PieTooltip />} />
            <RechartsLegend wrapperStyle={{ fontSize: '12px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

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
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Hours — {VIEWS.find(v => v.id === viewMode).label}
          </h3>
          <HoursStackedChart data={viewData.hours} labelKey={viewData.labelKey} />
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Share of Time (%) — {VIEWS.find(v => v.id === viewMode).label}
          </h3>
          <PercentStackedChart data={viewData.pct} labelKey={viewData.labelKey} />
        </div>
      </div>

      {/* Employee table */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Billable Details by Employee
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Employee', 'Team', 'Billable (hrs)', 'Non-Billable (hrs)', 'Exchange (hrs)', 'Total (hrs)', 'Billable %'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wider
                                         dark:text-white/50 text-brand-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byEmployee.map((emp, i) => {
                const pct = emp.total > 0 ? roundPct((emp.billable / emp.total) * 100) : 0
                return (
                  <tr
                    key={emp.name}
                    className={`border-b dark:border-white/5 border-brand-100
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
      </div>
    </div>
  )
}
