import { useEffect, useMemo, useRef, useState } from 'react'
import { useTasks, useCapacity2026, useRawTimeLog } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import { useAuth } from '../context/AuthContext'
import {
  calcTaskSummaryByEmployee, getEmployeeTaskList, calcTaskCountByEmployeeForTagFiltered,
  getUniqueTaskTags, getTaskCustomFields, calcHoursByTaskTag, getTaskTimeLogs, round2,
  filterTasksByDate,
} from '../api/transformData'
import { DEFAULT_DENIED_PERMISSIONS } from '../api/accessSheetApi'
import { CHART_COLORS } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import Dropdown from '../components/common/Dropdown'
import MultiSelect from '../components/common/MultiSelect'
import TeamworkLink from '../components/common/TeamworkLink'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

const STATUS_COLORS = {
  completed: '#6858a2',
  new:       '#8c8ffe',
  reopened:  '#e6b800',
}
const DEFAULT_STATUS_COLOR = '#8c6dc4'

const TASK_PAGE_SIZE = 50

function tagColor(tag) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return CHART_COLORS[hash % CHART_COLORS.length]
}

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

function TagBadge({ tag }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: tagColor(tag) }}
    >
      {tag}
    </span>
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

// ─── Task Detail modal — Teamwork-style, Details / Custom Fields tabs ──────
// Opened by clicking a task name anywhere in this tab. `task` is the raw
// Tasks-sheet row (every column, including any "CF: ..." field), so this
// never needs a second lookup.
function TaskDetailModal({ task, timeLogRows, showBillable, onClose }) {
  const [tab, setTab] = useState('details') // 'details' | 'customFields'
  const taskId = task?.['TASK ID']
  const taskLogs = useMemo(
    () => (taskId ? getTaskTimeLogs(timeLogRows, taskId) : []),
    [timeLogRows, taskId]
  )
  if (!task) return null

  const customFields = getTaskCustomFields(task)
  const tags = (task['TAGS'] || '').split(',').map(t => t.trim()).filter(Boolean)
  const estimatedHrs = parseFloat(task['ESTIMATED HRS']) || 0
  const totalLogged = round2(taskLogs.reduce((s, l) => s + l.hours, 0))

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200
                   dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <div className="flex items-center gap-1.5 min-w-0 max-w-[80%]">
            <h3 className="text-base font-semibold dark:text-white text-brand-900 truncate">
              {task['TASK NAME'] || 'Untitled Task'}
            </h3>
            <TeamworkLink taskId={task['TASK ID']} />
          </div>
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

        {/* Tabs */}
        <div className="flex gap-2 px-4 pt-3 border-b dark:border-white/10 border-brand-200">
          {[
            { id: 'details', label: 'Details' },
            { id: 'customFields', label: `Custom Fields${customFields.length ? ` (${customFields.length})` : ''}` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2
                ${tab === t.id
                  ? 'border-accent dark:text-white text-brand-900'
                  : 'border-transparent dark:text-white/50 text-brand-500 hover:dark:text-white/80 hover:text-brand-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {tab === 'details' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={task['STATUS']} />
                {task['STAGE'] && (
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold
                                   dark:bg-white/10 bg-brand-100 dark:text-white/80 text-brand-700">
                    {task['STAGE']}
                  </span>
                )}
                {task['PRIORITY'] && (
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold
                                   dark:bg-white/10 bg-brand-100 dark:text-white/80 text-brand-700">
                    Priority: {task['PRIORITY']}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <DetailRow label="Assignee(s)" value={task['ASSIGNEE(S)']} />
                <DetailRow label="Team" value={task['TEAM']} />
                <DetailRow label="Client" value={task['CLIENT']} />
                <DetailRow label="Project" value={task['PROJECT']} />
                <DetailRow label="Start Date" value={task['START DATE']} />
                <DetailRow label="Due Date" value={task['DUE DATE']} />
                <DetailRow label="Created Date" value={task['CREATED DATE']} />
                <DetailRow label="Completed Date" value={task['COMPLETED DATE']} />
              </div>

              {task['DESCRIPTION'] && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500 mb-1">
                    Description
                  </p>
                  <p className="text-sm dark:text-white/80 text-brand-800 whitespace-pre-wrap">
                    {task['DESCRIPTION']}
                  </p>
                </div>
              )}

              {tags.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500 mb-1.5">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(t => <TagBadge key={t} tag={t} />)}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500 mb-1.5">
                  Time Logs
                </p>
                <p className="text-sm dark:text-white/80 text-brand-800 mb-2">
                  Estimated: <b>{estimatedHrs.toFixed(2)}</b> hrs
                </p>

                {taskLogs.length === 0 ? (
                  <p className="text-sm dark:text-white/50 text-brand-500">No time logged yet.</p>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto overflow-x-auto rounded-lg border dark:border-white/10 border-brand-200">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b dark:border-white/10 border-brand-200">
                            {['Who', 'Date', 'Hours', ...(showBillable ? ['Billable'] : [])].map(h => (
                              <th key={h} className="text-left py-1.5 px-2.5 text-xs font-medium uppercase tracking-wider
                                                     dark:text-white/50 text-brand-500 whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {taskLogs.map((log, i) => (
                            <tr
                              key={i}
                              className={`border-b dark:border-white/5 border-brand-100
                                ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                            >
                              <td className="py-1.5 px-2.5 dark:text-white/80 text-brand-800 whitespace-nowrap">{log.who || '—'}</td>
                              <td className="py-1.5 px-2.5 dark:text-white/60 text-brand-600 whitespace-nowrap">{log.date || '—'}</td>
                              <td className="py-1.5 px-2.5 dark:text-white/80 text-brand-800 whitespace-nowrap">{log.hours.toFixed(2)}</td>
                              {showBillable && (
                                <td className="py-1.5 px-2.5 dark:text-white/60 text-brand-600 whitespace-nowrap">{log.billable || '—'}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-sm font-semibold mt-2 dark:text-white text-brand-900">
                      Total Logged: {totalLogged.toFixed(2)} hrs
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            customFields.length === 0 ? (
              <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
                No custom fields set on this task.
              </p>
            ) : (
              <div className="space-y-3">
                {customFields.map(f => (
                  <div key={f.label}>
                    <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
                      {f.label}
                    </p>
                    <p className="text-sm dark:text-white/80 text-brand-800">{f.value}</p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs dark:text-white/40 text-brand-400">{label}</p>
      <p className="dark:text-white/80 text-brand-800 truncate">{value}</p>
    </div>
  )
}

// ─── Employee task-list modal — click a task name to open TaskDetailModal ──
function EmployeeTasksModal({ employee, tasks, onClose, onOpenTask }) {
  const [page, setPage] = useState(0)
  if (!employee) return null

  const totalPages = Math.max(1, Math.ceil(tasks.length / TASK_PAGE_SIZE))
  const pageRows = tasks.slice(page * TASK_PAGE_SIZE, page * TASK_PAGE_SIZE + TASK_PAGE_SIZE)

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
            {employee} — Tasks <span className="dark:text-white/40 text-brand-400 font-normal text-sm">({tasks.length.toLocaleString()})</span>
          </h3>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs dark:text-white/50 text-brand-500">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30"
                >
                  ‹ Prev
                </button>
                <span>Page {page + 1} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30"
                >
                  Next ›
                </button>
              </div>
            )}
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
        </div>

        <div className="overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No tasks found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Task Name', 'Status', 'Created', 'Start', 'Due', 'Closed', 'Overdue Days'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t, i) => (
                  <tr
                    key={t.taskId + i}
                    className={`border-b dark:border-white/5 border-brand-100
                      ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                  >
                    <td className="py-2 px-3 max-w-[240px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          onClick={() => onOpenTask(t.row)}
                          className="font-medium dark:text-accent text-brand-600 hover:underline text-left truncate min-w-0"
                          title={t.taskName}
                        >
                          {t.taskName || '—'}
                        </button>
                        <TeamworkLink taskId={t.taskId} />
                      </div>
                    </td>
                    <td className="py-2 px-3"><StatusBadge status={t.status} /></td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.createdDate || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.startDate || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.dueDate || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{t.completedDate || '—'}</td>
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
          )}
        </div>
      </div>
    </div>
  )
}

const SUMMARY_COLUMNS = [
  { key: 'name',       label: 'Employee',    align: 'left' },
  { key: 'team',       label: 'Team',        align: 'left' },
  { key: 'total',       label: 'Total Tasks', align: 'right' },
  { key: 'complete',    label: 'Complete',    align: 'right' },
  { key: 'new',         label: 'New',         align: 'right' },
  { key: 'inProgress',  label: 'In Progress', align: 'right' },
  { key: 'overdue',     label: 'Overdue',     align: 'right' },
]

export default function TaskDetailsTab() {
  const { data: rawTasks = [], isLoading: loadingTasks, error: errTasks } = useTasks()
  const { data: capRows = [], isLoading: loadingCap, error: errCap } = useCapacity2026()
  const { data: rawTimeLog = [] } = useRawTimeLog()
  const filters = useFilters()
  const { permissions: rawPermissions } = useAuth()
  const permissions = rawPermissions || DEFAULT_DENIED_PERMISSIONS

  // Respect the main filter bar's From/To date range, scoped by CREATED
  // DATE — same field/function Weekly Report already uses for its own task
  // date filtering. Every task-derived figure on this tab (KPIs, summary
  // table, tag charts, drill-downs) is computed from this, not raw rawTasks.
  const filteredTasks = useMemo(
    () => filterTasksByDate(rawTasks, filters.startDate, filters.endDate, 'CREATED DATE'),
    [rawTasks, filters.startDate, filters.endDate]
  )

  const fullSummary = useMemo(
    () => calcTaskSummaryByEmployee(filteredTasks, capRows),
    [filteredTasks, capRows]
  )

  // Respect the main Team/Employee filter (Client isn't applicable — tasks
  // don't carry a client-level filter concept here).
  const summary = useMemo(() => fullSummary.filter(e =>
    (filters.selectedTeams.length === 0 || filters.selectedTeams.includes(e.team)) &&
    (filters.selectedEmployees.length === 0 || filters.selectedEmployees.includes(e.name))
  ), [fullSummary, filters.selectedTeams, filters.selectedEmployees])

  const totals = useMemo(() => summary.reduce((acc, e) => ({
    total: acc.total + e.total,
    complete: acc.complete + e.complete,
    overdue: acc.overdue + e.overdue,
  }), { total: 0, complete: 0, overdue: 0 }), [summary])

  // Every chart below that isn't already row-scoped by `summary` itself
  // (the tag charts read from the raw Tasks sheet, not from `summary`)
  // filters through this same set of allowed employee names, so they all
  // respect the same Team/Employee filter — and therefore the same Data
  // Scope enforcement (My Data Only / My Team Only / All Employees) — as
  // the summary table above.
  const filteredEmployeeNames = useMemo(() => new Set(summary.map(e => e.name)), [summary])

  const [sortKey, setSortKey] = useState('total')
  const [sortDir, setSortDir] = useState('desc')
  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }
  const sortedSummary = useMemo(() => {
    const arr = [...summary]
    arr.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [summary, sortKey, sortDir])

  // Employee task-list drill-down
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const employeeTasks = useMemo(
    () => (selectedEmployee ? getEmployeeTaskList(filteredTasks, selectedEmployee) : []),
    [filteredTasks, selectedEmployee]
  )

  // Task detail modal (opened from the employee modal's task list)
  const [selectedTask, setSelectedTask] = useState(null)

  // Tasks-per-employee-by-tag chart
  const availableTags = useMemo(() => getUniqueTaskTags(filteredTasks), [filteredTasks])
  const [selectedTag, setSelectedTag] = useState(null)
  const effectiveTag = selectedTag ?? availableTags[0] ?? null
  const tagByEmployee = useMemo(
    () => (effectiveTag ? calcTaskCountByEmployeeForTagFiltered(filteredTasks, effectiveTag, filteredEmployeeNames) : []),
    [filteredTasks, effectiveTag, filteredEmployeeNames]
  )

  // Total Logged Hrs by tag, whole team combined — respects the same
  // Team/Employee filter as the summary table above, via filteredEmployeeNames.
  const hoursByTag = useMemo(
    () => calcHoursByTaskTag(filteredTasks, rawTimeLog, filteredEmployeeNames),
    [filteredTasks, rawTimeLog, filteredEmployeeNames]
  )

  // "Total Hours by Tag" chart's own tag filter — multi-select (unlike the
  // "Tasks by Employee — by Tag" chart above, this one already shows every
  // tag side by side, so narrowing to a subset — including a single tag —
  // fits its structure better than forcing one-at-a-time). Defaults to
  // every tag selected, matching the chart's current unfiltered display.
  const [selectedHoursTags, setSelectedHoursTags] = useState([])
  const hoursTagsInitialized = useRef(false)
  useEffect(() => {
    if (!hoursTagsInitialized.current && availableTags.length > 0) {
      setSelectedHoursTags(availableTags)
      hoursTagsInitialized.current = true
    }
  }, [availableTags])
  const filteredHoursByTag = useMemo(
    () => hoursByTag.filter(row => selectedHoursTags.length === 0 || selectedHoursTags.includes(row.tag)),
    [hoursByTag, selectedHoursTags]
  )

  if (loadingTasks || loadingCap) return <LoadingSpinner message="Loading task data..." />
  if (errTasks || errCap) {
    return (
      <div className="card p-8 text-center mt-6">
        <p className="text-red-400 font-semibold">{(errTasks || errCap)?.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Total Tasks" value={totals.total.toLocaleString()} accent />
        <KPICard label="Complete" value={totals.complete.toLocaleString()} />
        <KPICard label="Overdue" value={totals.overdue.toLocaleString()} />
      </div>

      {/* Summary table */}
      <MaximizableChartCard
        title="Task Summary by Employee"
        exportRows={sortedSummary}
        exportColumns={SUMMARY_COLUMNS.map(c => ({ key: c.key, label: c.label }))}
      >
        {() => (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {SUMMARY_COLUMNS.map(col => (
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
              {sortedSummary.map((e, i) => (
                <tr
                  key={e.name}
                  className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                >
                  <td className="py-2 px-3">
                    <button
                      onClick={() => setSelectedEmployee(e.name)}
                      className="font-medium dark:text-accent text-brand-600 hover:underline text-left"
                    >
                      {e.name}
                    </button>
                  </td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600">{e.team || '—'}</td>
                  <td className="py-2 px-3 text-right dark:text-white text-brand-900 font-semibold">{e.total}</td>
                  <td className="py-2 px-3 text-right dark:text-white/70 text-brand-600">{e.complete}</td>
                  <td className="py-2 px-3 text-right dark:text-white/70 text-brand-600">{e.new}</td>
                  <td className="py-2 px-3 text-right dark:text-white/70 text-brand-600">{e.inProgress}</td>
                  <td className="py-2 px-3 text-right">
                    {e.overdue > 0
                      ? <span className="font-semibold" style={{ color: '#6858a2' }}>{e.overdue}</span>
                      : <span className="dark:text-white/40 text-brand-400">0</span>}
                  </td>
                </tr>
              ))}
              {sortedSummary.length === 0 && (
                <tr>
                  <td colSpan={SUMMARY_COLUMNS.length} className="py-8 text-center dark:text-white/50 text-brand-500">
                    No tasks match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </MaximizableChartCard>

      {/* Tasks per employee, by tag */}
      <MaximizableChartCard
        title="Tasks by Employee — by Tag"
        exportRows={tagByEmployee}
        exportColumns={[
          { key: 'name', label: 'Employee' },
          { key: 'count', label: 'Tasks' },
        ]}
        headerExtra={
          <Dropdown
            options={availableTags}
            value={effectiveTag || ''}
            onChange={setSelectedTag}
            placeholder={availableTags.length === 0 ? 'No tags found' : 'Select'}
            buttonClassName="text-xs py-1.5"
          />
        }
        height={380}
        modalHeight={520}
      >
        {h => (
          tagByEmployee.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No tasks tagged "{effectiveTag}".
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: Math.max(900, tagByEmployee.length * 60) }}>
                <ResponsiveContainer width="100%" height={h}>
                  <BarChart data={tagByEmployee} margin={{ top: 24, bottom: 90 }}>
                    <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                      angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload
                      return (
                        <div className="rounded-xl p-3 shadow-xl text-sm
                                        dark:bg-brand-900 dark:border-white/10 dark:text-white
                                        bg-white border border-brand-200 text-brand-900">
                          <p className="font-semibold mb-1">{label}</p>
                          <p className="text-xs">Tasks: <span className="font-bold">{p.count}</span></p>
                        </div>
                      )
                    }} />
                    <Bar dataKey="count" name="Tasks" radius={[6, 6, 0, 0]}>
                      {tagByEmployee.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                      <LabelList dataKey="count" position="top" style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )
        )}
      </MaximizableChartCard>

      {/* Total Logged Hrs by tag, whole team combined */}
      <MaximizableChartCard
        title="Total Hours by Tag"
        height={340}
        modalHeight={480}
        exportRows={filteredHoursByTag}
        exportColumns={[
          { key: 'tag', label: 'Tag' },
          { key: 'hours', label: 'Hours', format: v => Number(v ?? 0).toFixed(2) },
        ]}
        headerExtra={
          <MultiSelect
            options={availableTags}
            value={selectedHoursTags}
            onChange={setSelectedHoursTags}
            placeholder="All Tags"
          />
        }
      >
        {h => (
          filteredHoursByTag.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">
              No tagged tasks match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: Math.max(600, filteredHoursByTag.length * 70) }}>
                <ResponsiveContainer width="100%" height={h}>
                  <BarChart data={filteredHoursByTag} margin={{ top: 24, bottom: 60 }}>
                    <XAxis dataKey="tag" tick={{ fill: 'currentColor', fontSize: 11 }}
                      angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip content={<GenericTooltip />} />
                    <Bar dataKey="hours" name="Logged Hours" radius={[6, 6, 0, 0]}>
                      {filteredHoursByTag.map(row => (
                        <Cell key={row.tag} fill={tagColor(row.tag)} />
                      ))}
                      <LabelList dataKey="hours" position="top" style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )
        )}
      </MaximizableChartCard>

      <EmployeeTasksModal
        employee={selectedEmployee}
        tasks={employeeTasks}
        onClose={() => setSelectedEmployee(null)}
        onOpenTask={row => setSelectedTask(row)}
      />
      <TaskDetailModal
        task={selectedTask}
        timeLogRows={rawTimeLog}
        showBillable={permissions.financialAccess}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  )
}
