import { useMemo, useState } from 'react'
import { useRawTimeLog } from '../hooks/useSheetData'
import { useFilters } from '../context/FilterContext'
import {
  filterRows, calcHoursByClient, calcHoursByProject, calcHoursByEmployee, calcPivotTable, round2, roundPct,
} from '../api/transformData'
import { sequentialColor } from '../utils/chartColors'
import KPICard from '../components/common/KPICard'
import LoadingSpinner from '../components/common/LoadingSpinner'
import Greeting from '../components/common/Greeting'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import Dropdown from '../components/common/Dropdown'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

const labelStyle = { fill: 'currentColor', fontSize: 11, fontWeight: 600 }
const fmtHours = v => Number(v ?? 0).toFixed(2)

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl p-3 shadow-xl text-sm
                    dark:bg-brand-900 dark:border-white/10 dark:text-white
                    bg-white border border-brand-200 text-brand-900">
      <p className="font-semibold mb-1 max-w-[200px] truncate">{label}</p>
      <p>Hours: <span className="font-bold">{Number(payload[0]?.value).toLocaleString()}</span></p>
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

// Shared drill-down modal — two shapes: 'employees' (name/team/hours, opened
// from a Client or Project click) and 'raw' (individual Raw Time Log rows,
// opened from a Pivot Table cell). Same modal shell/style as every other
// drill-down in the app (Tags tab's task modal, Weekly Report's period
// modal, etc.).
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
                  {['Employee', 'Team', 'Client', 'Project', 'Date', 'Hours'].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                           dark:text-white/50 text-brand-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                    <td className="py-2 px-3 font-medium dark:text-white text-brand-900">{r.WHO || '—'}</td>
                    <td className="py-2 px-3 dark:text-white/70 text-brand-600">{r.TEAM || '—'}</td>
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

export default function HoursTab() {
  const filters = useFilters()
  const { data: rawRows = [], isLoading, error } = useRawTimeLog()

  const [pivotRow, setPivotRow] = useState('WHO')     // WHO or TEAM
  const [pivotCol, setPivotCol] = useState('CLIENT')  // CLIENT or PROJECT
  const [viewMode, setViewMode] = useState('client')  // 'client' | 'project' | 'pivot'

  const filtered      = useMemo(() => filterRows(rawRows, filters), [rawRows, filters])
  const byClient      = useMemo(() => calcHoursByClient(filtered),  [filtered])
  const byProject     = useMemo(() => calcHoursByProject(filtered), [filtered])
  const pivotData     = useMemo(() => calcPivotTable(filtered, pivotRow, pivotCol), [filtered, pivotRow, pivotCol])

  const totalHours    = useMemo(() => round2(filtered.reduce((s, r) => s + (parseFloat(r.HOURS) || 0), 0)), [filtered])
  const uniqueClients  = useMemo(() => new Set(filtered.map(r => r.CLIENT).filter(Boolean)).size, [filtered])
  const uniqueProjects = useMemo(() => new Set(filtered.map(r => r.PROJECT).filter(Boolean)).size, [filtered])

  const byClientExport = useMemo(
    () => byClient.map(c => ({
      ...c,
      pct: totalHours > 0 ? roundPct((c.hours / totalHours) * 100) : 0,
    })),
    [byClient, totalHours]
  )

  // Drill-down — click a Client/Project bar or table row to see which
  // employees logged those hours; click a Pivot Table cell to see the raw
  // rows behind that exact row×column intersection.
  const [drillDown, setDrillDown] = useState(null)
  function openClientDrillDown(client) {
    const rows = filtered.filter(r => r.CLIENT === client)
    setDrillDown({ kind: 'employees', title: `${client || 'Unknown'} — Employee Breakdown`, rows: calcHoursByEmployee(rows) })
  }
  function openProjectDrillDown(project) {
    const rows = filtered.filter(r => r.PROJECT === project)
    setDrillDown({ kind: 'employees', title: `${project || 'Unknown'} — Employee Breakdown`, rows: calcHoursByEmployee(rows) })
  }
  function openPivotCellDrillDown(rowLabel, colLabel) {
    const rows = filtered.filter(r =>
      (r[pivotRow] || 'Unknown') === rowLabel && (r[pivotCol] || 'Unknown') === colLabel
    )
    setDrillDown({ kind: 'raw', title: `${rowLabel} × ${colLabel}`, rows })
  }

  if (isLoading) return <LoadingSpinner message="Loading hours data..." />
  if (error) return (
    <div className="card p-8 text-center mt-6">
      <p className="text-red-400 font-semibold">{error.message}</p>
    </div>
  )

  return (
    <div className="space-y-6 pt-4">
      <Greeting />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard label="Total Hours" value={totalHours.toLocaleString()} accent />
        <KPICard label="Active Clients"  value={uniqueClients}  sub="in selected period" />
        <KPICard label="Active Projects" value={uniqueProjects} sub="in selected period" />
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        {[
          { id: 'client',  label: 'By Client' },
          { id: 'project', label: 'By Project' },
          { id: 'pivot',   label: 'Pivot Table' },
        ].map(v => (
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

      {/* By Client */}
      {viewMode === 'client' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MaximizableChartCard
            title="Hours by Client (Top 20)"
            height={360}
            modalHeight={520}
            exportRows={byClient.slice(0, 20)}
            exportColumns={[
              { key: 'client', label: 'Client' },
              { key: 'hours', label: 'Hours', format: v => v.toLocaleString() },
            ]}
          >
            {h => (
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(700, Math.min(byClient.length, 20) * 60) }}>
                  <ResponsiveContainer width="100%" height={h}>
                    <BarChart data={byClient.slice(0, 20)} margin={{ top: 24, bottom: 90 }}>
                      <XAxis dataKey="client" tick={{ fill: 'currentColor', fontSize: 11 }}
                        angle={-35} textAnchor="end" interval={0} />
                      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="hours" radius={[6, 6, 0, 0]} cursor="pointer"
                        onClick={d => openClientDrillDown(chartPoint(d).client)}>
                        {byClient.slice(0, 20).map((_, i) => (
                          <Cell key={i} fill={sequentialColor(i, Math.min(byClient.length, 20))} />
                        ))}
                        <LabelList dataKey="hours" position="top" formatter={v => v.toLocaleString()} style={labelStyle} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </MaximizableChartCard>

          <MaximizableChartCard
            title="Client Hours Table"
            height={320}
            modalHeight={600}
            exportRows={byClientExport}
            exportColumns={[
              { key: 'client', label: 'Client' },
              { key: 'hours', label: 'Hours', format: v => v.toLocaleString() },
              { key: 'pct', label: '% of Total', format: v => `${v}%` },
            ]}
          >
            {h => (
              <div className="overflow-y-auto" style={{ maxHeight: h }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 dark:bg-brand-900 bg-white">
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">#</th>
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">Client</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">Hours</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byClient.map((c, i) => (
                      <tr key={c.client} onClick={() => openClientDrillDown(c.client)}
                        className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                          hover:dark:bg-white/5 hover:bg-brand-50
                          ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                        <td className="py-2 px-3 dark:text-white/40 text-brand-400 text-xs">{i + 1}</td>
                        <td className="py-2 px-3 dark:text-white text-brand-900">{c.client || '—'}</td>
                        <td className="py-2 px-3 text-right font-semibold dark:text-white text-brand-900">{c.hours.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right dark:text-white/50 text-brand-500 text-xs">
                          {totalHours > 0 ? roundPct((c.hours / totalHours) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MaximizableChartCard>
        </div>
      )}

      {/* By Project */}
      {viewMode === 'project' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MaximizableChartCard
            title="Hours by Project (Top 20)"
            height={360}
            modalHeight={520}
            exportRows={byProject.slice(0, 20)}
            exportColumns={[
              { key: 'project', label: 'Project' },
              { key: 'client', label: 'Client' },
              { key: 'hours', label: 'Hours', format: v => v.toLocaleString() },
            ]}
          >
            {h => (
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(700, Math.min(byProject.length, 20) * 60) }}>
                  <ResponsiveContainer width="100%" height={h}>
                    <BarChart data={byProject.slice(0, 20)} margin={{ top: 24, bottom: 90 }}>
                      <XAxis dataKey="project" tick={{ fill: 'currentColor', fontSize: 11 }}
                        angle={-35} textAnchor="end" interval={0} />
                      <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="hours" radius={[6, 6, 0, 0]} cursor="pointer"
                        onClick={d => openProjectDrillDown(chartPoint(d).project)}>
                        {byProject.slice(0, 20).map((_, i) => (
                          <Cell key={i} fill={sequentialColor(i, Math.min(byProject.length, 20))} />
                        ))}
                        <LabelList dataKey="hours" position="top" formatter={v => v.toLocaleString()} style={labelStyle} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </MaximizableChartCard>

          <MaximizableChartCard
            title="Project Hours Table"
            height={320}
            modalHeight={600}
            exportRows={byProject}
            exportColumns={[
              { key: 'project', label: 'Project' },
              { key: 'client', label: 'Client' },
              { key: 'hours', label: 'Hours', format: v => v.toLocaleString() },
            ]}
          >
            {h => (
              <div className="overflow-y-auto" style={{ maxHeight: h }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 dark:bg-brand-900 bg-white">
                    <tr className="border-b dark:border-white/10 border-brand-200">
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">#</th>
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">Project</th>
                      <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">Client</th>
                      <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProject.map((p, i) => (
                      <tr key={p.project + i} onClick={() => openProjectDrillDown(p.project)}
                        className={`border-b dark:border-white/5 border-brand-100 cursor-pointer
                          hover:dark:bg-white/5 hover:bg-brand-50
                          ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}>
                        <td className="py-2 px-3 dark:text-white/40 text-brand-400 text-xs">{i + 1}</td>
                        <td className="py-2 px-3 dark:text-white text-brand-900">{p.project || '—'}</td>
                        <td className="py-2 px-3 dark:text-white/60 text-brand-600 text-xs">{p.client}</td>
                        <td className="py-2 px-3 text-right font-semibold dark:text-white text-brand-900">{p.hours.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MaximizableChartCard>
        </div>
      )}

      {/* Pivot Table */}
      {viewMode === 'pivot' && (
        <MaximizableChartCard
          title="Pivot Table"
          height={500}
          modalHeight={750}
          headerExtra={
            <div className="flex items-center gap-2 text-sm">
              <label className="dark:text-white/50 text-brand-500">Rows:</label>
              <Dropdown
                options={[{ value: 'WHO', label: 'Employee' }, { value: 'TEAM', label: 'Team' }]}
                value={pivotRow}
                onChange={setPivotRow}
              />
              <label className="dark:text-white/50 text-brand-500">Columns:</label>
              <Dropdown
                options={[
                  { value: 'CLIENT', label: 'Client' },
                  { value: 'PROJECT', label: 'Project' },
                  { value: 'TEAM', label: 'Team' },
                ]}
                value={pivotCol}
                onChange={setPivotCol}
              />
            </div>
          }
          exportRows={pivotData.data}
          exportColumns={[
            { key: 'label', label: pivotRow === 'WHO' ? 'Employee' : 'Team' },
            { key: 'total', label: 'Total', format: v => v.toLocaleString() },
            ...pivotData.cols.map(col => ({
              key: col,
              label: col || '—',
              format: v => (v ? v.toLocaleString() : '—'),
            })),
          ]}
        >
          {h => (
            <div className="overflow-auto" style={{ maxHeight: h }}>
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0">
                  <tr className="dark:bg-brand-900/90 bg-white">
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                   dark:text-white/50 text-brand-500 border-b dark:border-white/10 border-brand-200
                                   sticky left-0 dark:bg-brand-900/90 bg-white z-10 min-w-[130px]">
                      {pivotRow === 'WHO' ? 'Employee' : 'Team'}
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-medium uppercase tracking-wider
                                   dark:text-white/70 text-brand-700 border-b dark:border-white/10 border-brand-200 min-w-[80px]">
                      Total
                    </th>
                    {pivotData.cols.map(col => (
                      <th key={col}
                        className="text-right py-2 px-3 text-xs font-semibold dark:text-white/50 text-brand-500
                                   border-b dark:border-white/10 border-brand-200 min-w-[90px] max-w-[140px] truncate">
                        {col || '—'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.data.map((row, i) => (
                    <tr key={row.label + i}
                      className={`border-b dark:border-white/5 border-brand-100
                        ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/30' : ''}`}>
                      <td className="py-2 px-3 font-medium dark:text-white text-brand-900
                                     sticky left-0 dark:bg-brand-900/80 bg-white/80 backdrop-blur-sm">
                        {row.label}
                      </td>
                      <td className="py-2 px-3 text-right font-bold dark:text-accent text-brand-600">
                        {row.total.toLocaleString()}
                      </td>
                      {pivotData.cols.map(col => (
                        <td
                          key={col}
                          onClick={row[col] ? () => openPivotCellDrillDown(row.label, col) : undefined}
                          className={`py-2 px-3 text-right dark:text-white/70 text-brand-700
                            ${row[col] ? 'cursor-pointer hover:dark:bg-white/5 hover:bg-brand-50' : ''}`}
                        >
                          {row[col] ? row[col].toLocaleString() : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MaximizableChartCard>
      )}

      <DrillDownModal drillDown={drillDown} onClose={() => setDrillDown(null)} />
    </div>
  )
}
