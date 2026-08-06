import { useMemo, useState } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend as RechartsLegend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, LabelList,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useCapacity2026 } from '../hooks/useSheetData'
import { useBizDevTasks } from '../hooks/useBizDevTasks'
import { getUniqueCapacityEmployees } from '../api/transformData'
import { DATA_SCOPES, DEFAULT_DENIED_PERMISSIONS } from '../api/accessSheetApi'
import {
  filterLeadTasksByAllowedNames, calcBizDevKPIs, groupByProposalStatus, groupByProposalSource,
  groupByTiering, calcLeadsPerEmployee, calcTierByEmployee, getTasksByProposalStatus,
  getTasksByProposalSource, getTasksByTier, getTasksByEmployee, TIERS,
} from '../api/bizDevData'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import SortableTh from '../components/common/SortableTh'
import TeamworkLink from '../components/common/TeamworkLink'

// Maznexa-purple-only ramp for this tab's charts, per brand spec — distinct
// from the app's default CHART_COLORS (chartColors.js), same precedent as
// WeeklyReport.jsx's own dedicated palette for its Time Log Tag chart.
const BIZDEV_COLORS = ['#3D3580', '#534AB7', '#6B5FCC', '#7F77DD', '#9354FF', '#B893FF', '#CECBF6']
const TIER_COLORS = { 'Tier A': '#3D3580', 'Tier B': '#9354FF', 'Tier C': '#CECBF6' }

const LABEL_STYLE = { fill: '#ffffff', fontSize: 10, fontWeight: 500 }

const PROPOSAL_STATUS_BADGES = {
  'Send':                         { bg: '#2a2040', text: '#CECBF6' },
  'in Progress':                  { bg: '#1a2e2a', text: '#5DCAA5' },
  'Budget':                       { bg: '#1a2e2a', text: '#5DCAA5' },
  'Under review by Management':   { bg: '#1a2e2a', text: '#5DCAA5' },
  'Reject':                       { bg: '#3a1a1a', text: '#f09595' },
  'Lost':                         { bg: '#3a1a1a', text: '#f09595' },
  'Out of scope':                 { bg: '#3a1a1a', text: '#f09595' },
  'No Response':                  { bg: '#3a1a1a', text: '#f09595' },
  'Follow up':                    { bg: '#1e1a3a', text: '#9354FF' },
  "Didn't start work on it":      { bg: '#2a2040', text: '#888' },
}
const DEFAULT_STATUS_BADGE = { bg: '#2a2040', text: '#888' }

function ProposalStatusBadge({ status }) {
  if (!status) return <span className="dark:text-white/30 text-brand-300">—</span>
  const c = PROPOSAL_STATUS_BADGES[status] || DEFAULT_STATUS_BADGE
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {status}
    </span>
  )
}

function TierBadge({ tier }) {
  if (!tier) return <span className="dark:text-white/30 text-brand-300">—</span>
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white whitespace-nowrap"
      style={{ backgroundColor: TIER_COLORS[tier] || '#8c6dc4' }}>
      {tier}
    </span>
  )
}

function GenericTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-1 max-w-[220px] truncate">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey || p.name} className="text-xs" style={{ color: p.fill || p.color }}>
          {p.name}: <span className="font-bold">{Number(p.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

// Custom Pie label — fixed white/500/10px per brand spec, unlike the
// default recharts label used by TagsTab's TagPieChart.
function renderDonutLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (!percent) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" style={LABEL_STYLE}>
      {`${Math.round(percent * 100)}%`}
    </text>
  )
}

function LeadDonutChart({ title, data, onSliceClick }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  const pieData = data.map((d, i) => ({
    name: d.label,
    value: d.count,
    pct: total > 0 ? (d.count / total) * 100 : 0,
    color: BIZDEV_COLORS[i % BIZDEV_COLORS.length],
  }))

  return (
    <MaximizableChartCard
      title={title}
      height={300}
      modalHeight={440}
      exportRows={data}
      exportColumns={[{ key: 'label', label: title }, { key: 'count', label: 'Leads' }]}
    >
      {h => (
        total === 0 ? (
          <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No data.</p>
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
                label={renderDonutLabel}
                labelLine={false}
                onClick={entry => onSliceClick?.(entry?.name)}
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
                    <p className="text-xs">Leads: <span className="font-bold">{d.value.toLocaleString()}</span> ({Math.round(d.pct)}%)</p>
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

// Horizontal bar — one row per employee, sorted highest -> lowest (fixed,
// no sort toggle per spec). Click a bar to drill into that employee's leads.
function LeadsPerEmployeeChart({ data, onBarClick }) {
  const height = Math.max(260, data.length * 34 + 60)
  return (
    <MaximizableChartCard
      title="Total Leads per Employee"
      height={height}
      modalHeight={Math.max(480, height)}
      exportRows={data}
      exportColumns={[{ key: 'name', label: 'Employee' }, { key: 'count', label: 'Leads' }]}
    >
      {h => (
        data.length === 0 ? (
          <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No data.</p>
        ) : (
          <ResponsiveContainer width="100%" height={h}>
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 8 }}
              barSize={20} barCategoryGap={10}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={130} axisLine={false} tickLine={false}
                tick={{ fill: 'currentColor', fontSize: 11 }} />
              <Tooltip content={<GenericTooltip />} />
              <Bar dataKey="count" name="Leads" radius={[0, 6, 6, 0]} cursor="pointer"
                onClick={d => onBarClick?.(d.name)}>
                {data.map((_, i) => <Cell key={i} fill={BIZDEV_COLORS[i % BIZDEV_COLORS.length]} />)}
                <LabelList dataKey="count" position="right" style={LABEL_STYLE} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      )}
    </MaximizableChartCard>
  )
}

// Stacked vertical bar — one column per employee, 3 series (Tier A/B/C).
// Clicking any segment of a column drills into that employee's full lead
// list (the modal's Tiering column already shows the breakdown).
function TierByEmployeeChart({ data, onBarClick }) {
  const height = 380
  return (
    <MaximizableChartCard
      title="Tier Breakdown by Employee"
      height={height}
      modalHeight={520}
      exportRows={data}
      exportColumns={[
        { key: 'name', label: 'Employee' },
        { key: 'Tier A', label: 'Tier A' },
        { key: 'Tier B', label: 'Tier B' },
        { key: 'Tier C', label: 'Tier C' },
      ]}
    >
      {h => (
        data.length === 0 ? (
          <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No data.</p>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: Math.max(500, data.length * 70) }}>
              <ResponsiveContainer width="100%" height={h}>
                <BarChart data={data} margin={{ top: 32, bottom: 60 }} barSize={28}>
                  <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }}
                    angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip content={<GenericTooltip />} />
                  <RechartsLegend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 12, fontSize: '12px' }} />
                  {TIERS.map((tier, i) => (
                    <Bar
                      key={tier}
                      dataKey={tier}
                      name={tier}
                      stackId="a"
                      fill={TIER_COLORS[tier]}
                      radius={i === TIERS.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                      cursor="pointer"
                      onClick={d => onBarClick?.(d.name)}
                    >
                      <LabelList dataKey={tier} position="center" formatter={v => (v > 0 ? v : '')} style={LABEL_STYLE} />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      )}
    </MaximizableChartCard>
  )
}

// Shared drill-down modal for every chart on this tab — same visual pattern
// (backdrop/box/close) as TaskDetailsTab.jsx's TaskDetailModal/EmployeeTasksModal.
function LeadListModal({ title, tasks, onClose }) {
  if (!title) return null
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl
                   border dark:border-white/10 border-brand-200 dark:bg-brand-950 bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-white/10 border-brand-200">
          <h3 className="text-base font-semibold dark:text-white text-brand-900 truncate">
            {title} <span className="dark:text-white/40 text-brand-400 font-normal text-sm">({tasks.length.toLocaleString()})</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-lg leading-none px-2 dark:text-white/50 text-brand-400 hover:dark:text-white hover:text-brand-800">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <p className="text-sm text-center py-8 dark:text-white/50 text-brand-500">No leads found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-white/10 border-brand-200">
                  {['Task Name', 'Assignee', 'Proposal Status', 'Tiering', 'Workflow Stage'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={t.taskId + i}
                    className={`border-b dark:border-white/5 border-brand-100
                      ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 max-w-[240px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate" title={t.taskName}>{t.taskName}</span>
                        <TeamworkLink taskId={t.taskId} />
                      </div>
                    </td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-700 whitespace-nowrap">{t.assigneeLabel || '—'}</td>
                    <td className="py-2 px-3"><ProposalStatusBadge status={t.proposalStatus} /></td>
                    <td className="py-2 px-3"><TierBadge tier={t.tiering} /></td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-700 whitespace-nowrap">{t.stage || '—'}</td>
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

const TABLE_PAGE_SIZE = 50
const TABLE_COLUMNS = [
  { key: 'taskName', label: 'Task Name' },
  { key: 'assigneeLabel', label: 'Assignee' },
  { key: 'proposalSource', label: 'Proposal Source' },
  { key: 'proposalStatus', label: 'Proposal Status' },
  { key: 'tagsLabel', label: 'Tags' },
  { key: 'meetings', label: 'Meetings', align: 'right' },
  { key: 'stage', label: 'Workflow Stage' },
  { key: 'tiering', label: 'Tiering' },
]

const TEAMWORK_TASK_URL = taskId => `https://maznexa.teamwork.com/#/tasks/${taskId}`

function OverviewTable({ tasks }) {
  const [sort, setSort] = useState({ key: null, dir: 'desc' })
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort.key) return tasks
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...tasks].sort((a, b) => {
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [tasks, sort])

  function toggleSort(key) {
    setPage(0)
    setSort(prev => (
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    ))
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE_SIZE))
  const pageRows = sorted.slice(page * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE)

  return (
    <MaximizableChartCard
      title={`Overview (${sorted.length.toLocaleString()} leads)`}
      height={640}
      modalHeight={720}
      exportRows={sorted}
      exportColumns={TABLE_COLUMNS.map(c => ({ key: c.key, label: c.label }))}
      headerExtra={totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs dark:text-white/50 text-brand-500">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30">
            ‹ Prev
          </button>
          <span>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded-lg dark:bg-white/10 bg-brand-100 disabled:opacity-30">
            Next ›
          </button>
        </div>
      )}
    >
      {h => (
        <div className="overflow-auto rounded-xl border dark:border-white/10 border-brand-200" style={{ maxHeight: h }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 dark:bg-brand-950 bg-white z-10">
              <tr className="border-b dark:border-white/10 border-brand-200">
                {TABLE_COLUMNS.map(c => (
                  <SortableTh
                    key={c.key}
                    label={c.label}
                    align={c.align}
                    active={sort.key === c.key}
                    dir={sort.dir}
                    onClick={() => toggleSort(c.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t, i) => (
                <tr
                  key={t.taskId + i}
                  onClick={() => window.open(TEAMWORK_TASK_URL(t.taskId), '_blank', 'noopener,noreferrer')}
                  className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                    dark:hover:bg-white/[0.04] hover:bg-brand-50
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                >
                  <td className="py-2 px-3 max-w-[260px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-medium dark:text-white/90 text-brand-900" title={t.taskName}>
                        {t.taskName}
                      </span>
                      <TeamworkLink taskId={t.taskId} />
                    </div>
                  </td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-700 whitespace-nowrap">{t.assigneeLabel || '—'}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-700 whitespace-nowrap">{t.proposalSource || '—'}</td>
                  <td className="py-2 px-3"><ProposalStatusBadge status={t.proposalStatus} /></td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-700 max-w-[200px] truncate" title={t.tagsLabel}>
                    {t.tagsLabel || '—'}
                  </td>
                  <td className="py-2 px-3 text-right dark:text-white/70 text-brand-700">
                    {t.meetings === null ? '—' : t.meetings}
                  </td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-700 whitespace-nowrap">{t.stage || '—'}</td>
                  <td className="py-2 px-3"><TierBadge tier={t.tiering} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MaximizableChartCard>
  )
}

export default function BizDevTab() {
  const { data: leadTasks, isLoading, error } = useBizDevTasks()
  const { data: capRows = [] } = useCapacity2026()
  const { employee, permissions: rawPermissions } = useAuth()
  const permissions = rawPermissions || DEFAULT_DENIED_PERMISSIONS
  const dataScope = permissions.dataScope

  const [modal, setModal] = useState(null) // { title, tasks } | null

  // Data Scope enforcement — own inline lock (this tab has no FilterBar),
  // same approach ComparisonTab.jsx already uses: Admin/All sees everyone,
  // My Team resolves teammates via the Capacity sheet's Name/Team columns
  // (the Tasks sheet's own TEAM column is unpopulated), My Data is just self.
  const allowedNames = useMemo(() => {
    if (permissions.admin || dataScope === DATA_SCOPES.ALL) return null
    if (dataScope === DATA_SCOPES.MY_TEAM && employee?.team) {
      return new Set(getUniqueCapacityEmployees(capRows, [employee.team]))
    }
    if (dataScope === DATA_SCOPES.MY_DATA && employee?.name) {
      return new Set([employee.name])
    }
    return employee ? new Set() : null
  }, [permissions.admin, dataScope, employee, capRows])

  const scopedTasks = useMemo(
    () => filterLeadTasksByAllowedNames(leadTasks, allowedNames),
    [leadTasks, allowedNames]
  )

  const kpis = useMemo(() => calcBizDevKPIs(scopedTasks), [scopedTasks])
  const statusData = useMemo(() => groupByProposalStatus(scopedTasks), [scopedTasks])
  const sourceData = useMemo(() => groupByProposalSource(scopedTasks), [scopedTasks])
  const tierData = useMemo(() => groupByTiering(scopedTasks), [scopedTasks])
  const perEmployee = useMemo(() => calcLeadsPerEmployee(scopedTasks), [scopedTasks])
  const tierByEmployee = useMemo(() => calcTierByEmployee(scopedTasks), [scopedTasks])

  if (isLoading) return <LoadingSpinner message="Loading Business Development leads..." />
  if (error) {
    return (
      <div className="card p-8 text-center mt-6">
        <p className="text-red-400 font-semibold">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Total Leads" value={kpis.totalLeads.toLocaleString()} />
        <KPICard label="In Progress" value={kpis.inProgress.toLocaleString()} />
        <KPICard label="Send / Proposals" value={kpis.send.toLocaleString()} />
        <KPICard label="Disqualified" value={kpis.disqualified.toLocaleString()} />
      </div>

      {/* 3 donuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LeadDonutChart
          title="Proposal Status"
          data={statusData}
          onSliceClick={status => setModal({
            title: `Proposal Status — ${status}`,
            tasks: getTasksByProposalStatus(scopedTasks, status),
          })}
        />
        <LeadDonutChart
          title="Proposal Source"
          data={sourceData}
          onSliceClick={source => setModal({
            title: `Proposal Source — ${source}`,
            tasks: getTasksByProposalSource(scopedTasks, source),
          })}
        />
        <LeadDonutChart
          title="Tiering Overview"
          data={tierData}
          onSliceClick={tier => setModal({
            title: `Tiering Overview — ${tier}`,
            tasks: getTasksByTier(scopedTasks, tier),
          })}
        />
      </div>

      {/* 2 bar charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LeadsPerEmployeeChart
          data={perEmployee}
          onBarClick={name => setModal({
            title: `Leads: ${name}`,
            tasks: getTasksByEmployee(scopedTasks, name),
          })}
        />
        <TierByEmployeeChart
          data={tierByEmployee}
          onBarClick={name => setModal({
            title: `Tier Breakdown: ${name}`,
            tasks: getTasksByEmployee(scopedTasks, name),
          })}
        />
      </div>

      {/* Overview table */}
      <OverviewTable tasks={scopedTasks} />

      {modal && (
        <LeadListModal title={modal.title} tasks={modal.tasks} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
