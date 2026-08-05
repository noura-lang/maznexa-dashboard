import { useMemo, useState } from 'react'
import { useTasks, useCapacity2026, useRawTimeLog } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import {
  calcTaskSummaryByEmployee, calcTagGroupCounts, calcTaskCountsForTags,
  calcTaskCountByEmployeeForTagFiltered, calcHoursByEmployeeForTag,
  getTasksForTag, getTasksForEmployeeAndTag, filterTasksByDate,
} from '../api/transformData'
import { CHART_COLORS } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import ChartSortMenu from '../components/common/ChartSortMenu'
import { sortChartRows, SORT_MODES } from '../utils/chartSort'
import TeamworkLink from '../components/common/TeamworkLink'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
  PieChart, Pie, Legend as RechartsLegend,
} from 'recharts'

// Groups with 5 sub-widgets get a wider grid than the 3-sub-widget groups —
// literal class strings (not a computed template) so Tailwind's JIT scanner
// picks them up.
const SUB_GRID_CLASS = {
  3: 'grid-cols-2 sm:grid-cols-3',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
}

const DESIGN_PIE_TAGS = [
  { label: 'Post',            tag: 'Post' },
  { label: 'Reels',           tag: 'Reels' },
  { label: 'Offline Design',  tag: 'Offline Design' },
  { label: 'Campaign Design', tag: 'Campaign Design' },
  { label: 'Banner',          tag: 'Banner' },
]

const EDIT_PIE_TAGS = [
  { label: 'Edit',      tag: 'Edit' },
  { label: 'Edit Post', tag: 'Edit Post' },
  { label: 'Edit Reel', tag: 'Edit Reel' },
]

// The 4 Design-group tags with their own per-employee breakdown charts
// (count + hours). Banner isn't part of this set — only these 4 were asked for.
const EMPLOYEE_TAG_CHARTS = [
  { tag: 'Post',             countTitle: 'Number of Post by Employee',             hoursTitle: 'Total Hours — Post by Employee' },
  { tag: 'Reels',            countTitle: 'Number of Reel by Employee',             hoursTitle: 'Total Hours — Reel by Employee' },
  { tag: 'Campaign Design',  countTitle: 'Number of Campaign Design by Employee',  hoursTitle: 'Total Hours — Campaign Design by Employee' },
  { tag: 'Offline Design',   countTitle: 'Number of Offline Design by Employee',   hoursTitle: 'Total Hours — Offline Design by Employee' },
]

const TAG_MODAL_COLUMNS = [
  { key: 'taskName',    label: 'Task Name' },
  { key: 'assignee',    label: 'Assignee' },
  { key: 'status',      label: 'Status' },
  { key: 'createdDate', label: 'Created' },
  { key: 'dueDate',     label: 'Due' },
  { key: 'overdueDays', label: 'Overdue Days', align: 'right' },
]

const EMPLOYEE_TAG_MODAL_BASE_COLUMNS = [
  { key: 'taskName',    label: 'Task Name' },
  { key: 'status',      label: 'Status' },
  { key: 'createdDate', label: 'Created' },
  { key: 'dueDate',     label: 'Due' },
]
const LOGGED_HRS_COLUMN = { key: 'loggedHrs', label: 'Logged Hrs', align: 'right' }

const STATUS_COLORS = {
  completed: '#6858a2',
  new:       '#8c8ffe',
  reopened:  '#e6b800',
}
const DEFAULT_STATUS_COLOR = '#8c6dc4'

function StatusBadge({ status }) {
  const key = (status || '').trim().toLowerCase()
  const color = STATUS_COLORS[key] || DEFAULT_STATUS_COLOR
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white capitalize"
      style={{ backgroundColor: color }}
    >
      {status || '—'}
    </span>
  )
}

function sortRows(rows, key, dir) {
  const arr = [...rows]
  arr.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    let cmp
    if (typeof av === 'number' || typeof bv === 'number') {
      cmp = (av ?? -Infinity) - (bv ?? -Infinity)
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return arr
}

function renderCell(col, task) {
  switch (col.key) {
    case 'taskName':
      return (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate" title={task.taskName}>{task.taskName || '—'}</span>
          <TeamworkLink taskId={task.taskId} />
        </div>
      )
    case 'status':
      return <StatusBadge status={task.status} />
    case 'overdueDays':
      return task.overdueDays === null ? (
        <span className="dark:text-white/30 text-brand-300">—</span>
      ) : task.overdueDays > 0 ? (
        <span className="font-semibold" style={{ color: '#6858a2' }}>{task.overdueDays}d</span>
      ) : (
        <span className="dark:text-white/50 text-brand-500">0d</span>
      )
    case 'loggedHrs':
      return Number(task.loggedHrs ?? 0).toFixed(2)
    default:
      return task[col.key] || '—'
  }
}

// Sortable task-list drill-down modal — same visual style (overlay, card,
// header with title/count/close X, zebra-striped table) as the Task Details
// tab's EmployeeTasksModal, reused here as one generic component driven by
// a `columns` descriptor rather than duplicating a modal per chart type.
function TaskListModal({ title, tasks, columns, onClose }) {
  const [sortKey, setSortKey] = useState(columns[0]?.key)
  const [sortDir, setSortDir] = useState('asc')

  if (!tasks) return null

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = sortRows(tasks, sortKey, sortDir)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200
                   dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-base font-semibold dark:text-white text-brand-900">
            {title} <span className="dark:text-white/40 text-brand-400 font-normal text-sm">({tasks.length.toLocaleString()})</span>
          </h3>
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
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No tasks found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`py-2 px-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none
                                 dark:text-white/50 text-brand-500 whitespace-nowrap
                                 dark:hover:text-white hover:text-brand-800
                                 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.label} {sortKey === col.key ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => (
                  <tr
                    key={t.taskId + i}
                    className={`border-b dark:border-white/5 border-brand-100
                      ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                  >
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className={`py-2 px-3 whitespace-nowrap
                          ${col.align === 'right' ? 'text-right' : ''}
                          ${col.key === 'taskName' ? 'max-w-[240px] font-medium dark:text-white text-brand-900' : 'dark:text-white/70 text-brand-600'}`}
                      >
                        {renderCell(col, t)}
                      </td>
                    ))}
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

// Pie chart with an explicit count + percentage in the legend (recharts'
// default Pie legend only shows the name/swatch) — percent is computed here
// rather than trusted from recharts' internal sector data, so the legend
// formatter has a reliable number to read regardless of recharts version.
// Clicking a slice drills down via `onSliceClick(tag, label)`.
function TagPieChart({ title, data, onSliceClick }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  const pieData = data.map((d, i) => ({
    name: d.label,
    value: d.count,
    pct: total > 0 ? (d.count / total) * 100 : 0,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))

  return (
    <MaximizableChartCard
      title={title}
      height={300}
      modalHeight={440}
      exportRows={data}
      exportColumns={[
        { key: 'label', label: 'Tag' },
        { key: 'count', label: 'Tasks' },
      ]}
    >
      {h => (
        total === 0 ? (
          <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No tagged tasks found.</p>
        ) : (
          <ResponsiveContainer width="100%" height={h}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={h * 0.16}
                outerRadius={h * 0.32}
                paddingAngle={2}
                label={({ pct }) => `${Math.round(pct)}%`}
                labelLine={false}
                // recharts' Pie onClick only reliably exposes the data's `name`
                // (its custom fields don't survive onto the click entry) — safe
                // here since every DESIGN_PIE_TAGS/EDIT_PIE_TAGS entry has
                // label === tag.
                onClick={entry => onSliceClick?.(entry?.name, entry?.name)}
                style={{ cursor: 'pointer' }}
              >
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload
                return (
                  <div className="rounded-xl p-3 shadow-xl text-sm
                                  dark:bg-brand-900 dark:border-white/10 dark:text-white
                                  bg-white border border-brand-200 text-brand-900">
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs">Tasks: <span className="font-bold">{d.value.toLocaleString()}</span> ({Math.round(d.pct)}%)</p>
                  </div>
                )
              }} />
              <RechartsLegend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                wrapperStyle={{ fontSize: '12px' }}
                formatter={(_value, entry) => {
                  const d = entry?.payload
                  if (!d) return _value
                  return `${d.name}: ${d.value.toLocaleString()} (${Math.round(d.pct)}%)`
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )
      )}
    </MaximizableChartCard>
  )
}

// Vertical bar chart for one tag's per-employee breakdown (count or hours),
// sorted descending, angled employee names, horizontal scroll for long
// employee lists — same structural pattern as the Task Details tab's
// "Tasks by Employee — by Tag" chart. Clicking a bar drills down via
// `onBarClick(employeeName)`.
function EmployeeTagBarChart({ title, data, dataKey, seriesName, isHours, onBarClick }) {
  const [sortMode, setSortMode] = useState(SORT_MODES.DESC)
  const sorted = useMemo(() => sortChartRows(data, sortMode, dataKey, 'name'), [data, sortMode, dataKey])

  return (
    <MaximizableChartCard
      title={title}
      headerExtra={<ChartSortMenu value={sortMode} onChange={setSortMode} />}
      height={340}
      modalHeight={480}
      exportRows={sorted}
      exportColumns={[
        { key: 'name', label: 'Employee' },
        { key: dataKey, label: seriesName, format: isHours ? v => Number(v ?? 0).toFixed(2) : undefined },
      ]}
    >
      {h => (
        sorted.length === 0 ? (
          <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No tasks tagged for this.</p>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(600, sorted.length * 70) }}>
              <ResponsiveContainer width="100%" height={h}>
                <BarChart data={sorted} margin={{ top: 24, bottom: 70 }}>
                  <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                    angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} allowDecimals={isHours} />
                  <Tooltip content={<GenericTooltip />} />
                  <Bar
                    dataKey={dataKey}
                    name={seriesName}
                    radius={[6, 6, 0, 0]}
                    onClick={entry => onBarClick?.(entry?.name)}
                    style={{ cursor: 'pointer' }}
                  >
                    {sorted.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey={dataKey}
                      position="top"
                      formatter={v => (isHours ? Number(v).toFixed(2) : v)}
                      style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      )}
    </MaximizableChartCard>
  )
}

export default function TagsTab() {
  const { data: rawTasks = [], isLoading: loadingTasks, error: errTasks } = useTasks()
  const { data: capRows = [], isLoading: loadingCap, error: errCap } = useCapacity2026()
  const { data: rawTimeLog = [] } = useRawTimeLog()
  const filters = useFilters()

  // Respect the main filter bar's From/To date range, scoped by CREATED
  // DATE — same field/function Weekly Report already uses for its own task
  // date filtering. Every tag-derived figure on this tab is computed from
  // this, not raw rawTasks.
  const filteredTasks = useMemo(
    () => filterTasksByDate(rawTasks, filters.startDate, filters.endDate, 'CREATED DATE'),
    [rawTasks, filters.startDate, filters.endDate]
  )

  // Same Team/Employee scoping as the Task Details tab: resolve each
  // assignee's team via Capacity (the Tasks sheet's own TEAM column is
  // unreliable), filter by the active filter bar selection, then only
  // count tasks with at least one assignee left standing.
  const fullSummary = useMemo(
    () => calcTaskSummaryByEmployee(filteredTasks, capRows),
    [filteredTasks, capRows]
  )
  const filteredEmployeeNames = useMemo(() => {
    const scoped = fullSummary.filter(e =>
      (filters.selectedTeams.length === 0 || filters.selectedTeams.includes(e.team)) &&
      (filters.selectedEmployees.length === 0 || filters.selectedEmployees.includes(e.name))
    )
    return new Set(scoped.map(e => e.name))
  }, [fullSummary, filters.selectedTeams, filters.selectedEmployees])

  const groups = useMemo(
    () => calcTagGroupCounts(filteredTasks, filteredEmployeeNames),
    [filteredTasks, filteredEmployeeNames]
  )

  const designPieData = useMemo(
    () => calcTaskCountsForTags(filteredTasks, DESIGN_PIE_TAGS, filteredEmployeeNames),
    [filteredTasks, filteredEmployeeNames]
  )
  const editPieData = useMemo(
    () => calcTaskCountsForTags(filteredTasks, EDIT_PIE_TAGS, filteredEmployeeNames),
    [filteredTasks, filteredEmployeeNames]
  )

  const employeeTagCounts = useMemo(
    () => EMPLOYEE_TAG_CHARTS.map(c => ({
      ...c,
      counts: calcTaskCountByEmployeeForTagFiltered(filteredTasks, c.tag, filteredEmployeeNames),
      hours: calcHoursByEmployeeForTag(filteredTasks, rawTimeLog, c.tag, filteredEmployeeNames),
    })),
    [filteredTasks, rawTimeLog, filteredEmployeeNames]
  )

  // Drill-down modal state — pieModal for the two pie charts, barModal for
  // the 8 per-employee bar charts. Only one is ever open at a time.
  const [pieModal, setPieModal] = useState(null)  // { tag, label } | null
  const [barModal, setBarModal] = useState(null)  // { employeeName, tag, isHours } | null

  const pieModalTasks = useMemo(
    () => (pieModal ? getTasksForTag(filteredTasks, pieModal.tag, filteredEmployeeNames) : null),
    [filteredTasks, filteredEmployeeNames, pieModal]
  )
  const barModalTasks = useMemo(
    () => (barModal ? getTasksForEmployeeAndTag(filteredTasks, rawTimeLog, barModal.employeeName, barModal.tag) : null),
    [filteredTasks, rawTimeLog, barModal]
  )
  const barModalColumns = barModal?.isHours
    ? [...EMPLOYEE_TAG_MODAL_BASE_COLUMNS, LOGGED_HRS_COLUMN]
    : EMPLOYEE_TAG_MODAL_BASE_COLUMNS

  if (loadingTasks || loadingCap) return <LoadingSpinner message="Loading tag data..." />
  if (errTasks || errCap) {
    return (
      <div className="card p-8 text-center mt-6">
        <p className="text-red-400 font-semibold">{(errTasks || errCap)?.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 pt-4">
      {groups.map(group => (
        <div key={group.key} className="space-y-4">
          {/* Main group widget — wider and more prominent than the sub-widgets below */}
          <div className="card p-6 flex flex-col items-center gap-1 text-center
                          bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                          from-brand-200/70 via-brand-100/30 to-transparent">
            <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
              {group.mainLabel}
            </p>
            <p className="text-5xl font-bold dark:text-white text-brand-900 leading-tight">
              {group.total.toLocaleString()}
            </p>
          </div>

          {/* Sub-widgets — one per tag in this group, equal width */}
          <div className={`grid gap-4 ${SUB_GRID_CLASS[group.subs.length] || 'grid-cols-2 sm:grid-cols-3'}`}>
            {group.subs.map(sub => (
              <KPICard key={sub.label} label={sub.label} value={sub.count.toLocaleString()} center />
            ))}
          </div>
        </div>
      ))}

      {/* Design / Edit distribution pie charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TagPieChart
          title="Total Number of Design"
          data={designPieData}
          onSliceClick={(tag, label) => setPieModal({ tag, label })}
        />
        <TagPieChart
          title="Total Number of Edit"
          data={editPieData}
          onSliceClick={(tag, label) => setPieModal({ tag, label })}
        />
      </div>

      {/* Design-tag breakdowns by employee — task counts */}
      <div className="space-y-4">
        {employeeTagCounts.map(c => (
          <EmployeeTagBarChart
            key={`count-${c.tag}`}
            title={c.countTitle}
            data={c.counts}
            dataKey="count"
            seriesName="Tasks"
            isHours={false}
            onBarClick={employeeName => setBarModal({ employeeName, tag: c.tag, isHours: false })}
          />
        ))}
      </div>

      {/* Same breakdowns, in logged hours instead of task counts */}
      <div className="space-y-4">
        {employeeTagCounts.map(c => (
          <EmployeeTagBarChart
            key={`hours-${c.tag}`}
            title={c.hoursTitle}
            data={c.hours}
            dataKey="hours"
            seriesName="Hours"
            isHours
            onBarClick={employeeName => setBarModal({ employeeName, tag: c.tag, isHours: true })}
          />
        ))}
      </div>

      {pieModal && (
        <TaskListModal
          title={`Tasks tagged: ${pieModal.tag}`}
          tasks={pieModalTasks}
          columns={TAG_MODAL_COLUMNS}
          onClose={() => setPieModal(null)}
        />
      )}
      {barModal && (
        <TaskListModal
          title={`${barModal.employeeName} — ${barModal.tag} tasks`}
          tasks={barModalTasks}
          columns={barModalColumns}
          onClose={() => setBarModal(null)}
        />
      )}
    </div>
  )
}
