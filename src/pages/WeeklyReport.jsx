import { useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { useRawTimeLog, useCapacity2026, useTasks } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import {
  filterRows, filterCapacityRows,
  calcOverallKPIs, calcUtilizationByTeam, calcUtilizationByEmployee,
  utilizationColor, calcHoursByTag, calcTagHoursByEmployee,
  filterTasksByDate, calcTaskStatusByEmployee, buildTasksPivot,
} from '../api/transformData'
import { SEQUENTIAL_STOPS } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
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

const COMPLETE_COLOR    = '#6858a2' // dark purple -> white label text
const IN_PROGRESS_COLOR = '#8c8ffe' // light blue   -> dark label text
const TASK_PAGE_SIZE = 50

const TAG_WHITELIST = ['Meeting', 'Reporting', 'Follow up', 'Brainstorming', 'Research', 'Training']

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

export default function WeeklyReport() {
  const filters = useFilters()
  const { data: rawRows = [], isLoading: loadingLog, error: errLog } = useRawTimeLog()
  const { data: capRows = [], isLoading: loadingCap, error: errCap } = useCapacity2026()
  const { data: rawTasks = [], isLoading: loadingTasks, error: errTasks } = useTasks()

  const filteredLog = useMemo(() => filterRows(rawRows, filters),        [rawRows, filters])
  const filteredCap = useMemo(() => filterCapacityRows(capRows, filters), [capRows, filters])

  const kpis        = useMemo(() => calcOverallKPIs(filteredLog, filteredCap),        [filteredLog, filteredCap])
  const byTeam      = useMemo(() => calcUtilizationByTeam(filteredLog, filteredCap),  [filteredLog, filteredCap])
  const byEmployee  = useMemo(() => calcUtilizationByEmployee(filteredLog, filteredCap), [filteredLog, filteredCap])
  const byTag       = useMemo(() => calcHoursByTag(filteredLog, TAG_WHITELIST), [filteredLog])
  const tagByEmployee = useMemo(() => calcTagHoursByEmployee(filteredLog, TAG_WHITELIST), [filteredLog])
  const top15TagByEmployee = tagByEmployee.slice(0, 15)

  const top5    = byTeam.slice(0, 5)
  const bottom5 = [...byTeam].sort((a, b) => a.utilPct - b.utilPct).slice(0, 5)

  const top5Employees    = byEmployee.slice(0, 5)
  const bottom5Employees = [...byEmployee].sort((a, b) => a.utilPct - b.utilPct).slice(0, 5)

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
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          label="Total Logged Hours"
          value={kpis.totalLogged.toLocaleString()}
          sub="Across selected period & filters"
        />
        <KPICard
          label="Total Capacity"
          value={kpis.totalCapacity.toLocaleString()}
          sub="Available (hrs)"
        />
        <KPICard
          label="Overall Utilization"
          value={`${kpis.utilization}%`}
          sub={utilizationColor(kpis.utilization).label}
          accent
        />
      </div>

      {/* Top 5 / Bottom 5 teams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Top 5 Teams by Utilization
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top5} layout="vertical" margin={{ left: 8, right: 36 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis type="category" dataKey="team" width={110}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[0, 6, 6, 0]}>
                {top5.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="right" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Bottom 5 Teams by Utilization
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bottom5} layout="vertical" margin={{ left: 8, right: 36 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis type="category" dataKey="team" width={110}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[0, 6, 6, 0]}>
                {bottom5.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="right" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Utilization by Team — full chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">
            Utilization by Team
          </h3>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {UTIL_LEGEND.map(l => (
              <span key={l.label} className="flex items-center gap-1 text-xs dark:text-white/60 text-brand-500">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={byTeam} margin={{ top: 24, bottom: 40 }}>
            <XAxis dataKey="team" tick={{ fill: 'currentColor', fontSize: 11 }} angle={-35} textAnchor="end" />
            <YAxis tickFormatter={v => `${Math.round(v)}%`} domain={[0, 110]} tick={{ fill: 'currentColor', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="utilPct" radius={[6, 6, 0, 0]}>
              {byTeam.map((entry, i) => (
                <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
              ))}
              <LabelList dataKey="utilPct" position="top" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top 5 / Bottom 5 employees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Top 5 Employees by Utilization
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top5Employees} layout="vertical" margin={{ left: 8, right: 36 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[0, 6, 6, 0]}>
                {top5Employees.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="right" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
            Bottom 5 Employees by Utilization
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bottom5Employees} layout="vertical" margin={{ left: 8, right: 36 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="utilPct" radius={[0, 6, 6, 0]}>
                {bottom5Employees.map((entry, i) => (
                  <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
                ))}
                <LabelList dataKey="utilPct" position="right" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Utilization by Employee — full chart (all employees) */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Utilization by Employee — All ({byEmployee.length})
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(280, byEmployee.length * 24) + 24}>
          <BarChart data={byEmployee} layout="vertical" margin={{ top: 8, left: 8, right: 36 }}>
            <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${Math.round(v)}%`}
              tick={{ fill: 'currentColor', fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={130}
              tick={{ fill: 'currentColor', fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="utilPct" radius={[0, 6, 6, 0]}>
              {byEmployee.map((entry, i) => (
                <Cell key={i} fill={utilizationColor(entry.utilPct).bg} />
              ))}
              <LabelList dataKey="utilPct" position="right" formatter={v => `${Math.round(v)}%`} style={axisLabelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

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
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Hours by Time Log Tag
        </h3>
        <ResponsiveContainer width="100%" height={320}>
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
      </div>

      {/* Time Log Tags — per employee */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
          Hours by Time Log Tag per Employee (Top 15)
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(320, top15TagByEmployee.length * 28) + 36}>
          <BarChart data={top15TagByEmployee} layout="vertical" margin={{ top: 32, left: 8, right: 24 }}>
            <XAxis type="number" tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={fmtHours} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fill: 'currentColor', fontSize: 11 }} />
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
                  radius={i === TAG_WHITELIST.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]}
                >
                  <LabelList dataKey={tag} position="center" formatter={labelFmt}
                    style={{ fill: TAG_TEXT_MAP[tag], fontSize: 10, fontWeight: 700 }} />
                </Bar>
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>

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
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-4 dark:text-white/80 text-brand-800">
              Tasks Complete vs In Progress by Employee (Top 20)
            </h3>
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={top20TaskStatus} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" tick={{ fill: 'currentColor', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'currentColor', fontSize: 11 }} />
                <Tooltip content={<GenericTooltip />} />
                <RechartsLegend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="complete" name="Complete" stackId="a" fill={COMPLETE_COLOR} radius={[0, 0, 0, 0]}>
                  <LabelList dataKey="complete" position="center"
                    formatter={v => (v > 0 ? v : '')} style={{ fill: '#ffffff', fontSize: 11, fontWeight: 700 }} />
                </Bar>
                <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={IN_PROGRESS_COLOR} radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="inProgress" position="center"
                    formatter={v => (v > 0 ? v : '')} style={{ fill: '#1a0e3d', fontSize: 11, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

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
    </div>
  )
}
