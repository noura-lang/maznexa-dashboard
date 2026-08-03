import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchSecureJson } from '../api/secureApi'
import {
  getAmEmployeeRoster, getAmClientsForEmployee, filterAmRows,
  calcAmTotals, calcAmMarginYtd, calcAmProgressPct,
  calcAmTargetComparisonChart, calcAmMonthlyTrend,
} from '../api/amSheetApi'
import LoadingSpinner from '../components/common/LoadingSpinner'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import { CHART_COLORS } from '../utils/chartColors'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend as RechartsLegend, LabelList,
} from 'recharts'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const ACCENT_LINE = '#8c8ffe' // Maznexa secondary blue — the one non-bar line color on both charts

const fmtSAR = n => `SAR ${Math.round(n ?? 0).toLocaleString()}`

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
// fill/stroke — fine for light colors, but "Total Actual"'s dark brand
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

// Account Managers Performance — a financially sensitive tab gated by its
// own Permissions flag (App.jsx), reading the separate AM Sheet through the
// secure /api/am-data route (see api/am-data.js) rather than the signed-in
// user's own Google OAuth token — that route verifies the caller's Firebase
// ID token server-side and returns only their own rows (every row, if their
// Permissions row has Admin=TRUE), so no employee Google account ever needs
// direct access to this sheet. Independent of the shared FilterContext date
// range — this tab has its own Month/Company Name filters instead, since
// revenue targets are annual and Zoho rows are per calendar month, not
// aligned with the app's general date-range concept.
export default function AmPerformanceTab() {
  const { firebaseUser } = useAuth()
  const [data, setData] = useState(null) // { zoho, targets, marginNames } | null
  const [loadError, setLoadError] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState('All')
  const [selectedClient, setSelectedClient] = useState('All')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const result = await fetchSecureJson('/api/am-data', firebaseUser)
      setData(result)
    } catch (err) {
      console.error('Failed to load Account Managers Performance data:', err)
      setLoadError(err.message)
    }
  }, [firebaseUser])

  useEffect(() => { load() }, [load])

  const roster = useMemo(
    () => (data ? getAmEmployeeRoster(data.zoho, data.targets, data.marginNames) : []),
    [data]
  )

  useEffect(() => {
    if (roster.length > 0 && !roster.includes(selectedEmployee)) {
      setSelectedEmployee(roster[0])
    }
  }, [roster, selectedEmployee])

  const clientOptions = useMemo(
    () => (data && selectedEmployee ? getAmClientsForEmployee(data.zoho, selectedEmployee) : []),
    [data, selectedEmployee]
  )

  // The Company Name filter's options depend on the selected employee —
  // reset to "All" whenever she changes so a stale client from a previous
  // employee never silently narrows the new one's numbers to nothing.
  useEffect(() => { setSelectedClient('All') }, [selectedEmployee])

  const hasActiveData = useMemo(
    () => !!(data && selectedEmployee && (
      data.zoho.some(r => r.employee === selectedEmployee) ||
      data.targets.some(t => t.employee === selectedEmployee)
    )),
    [data, selectedEmployee]
  )

  const target = useMemo(
    () => data?.targets.find(t => t.employee === selectedEmployee) ?? null,
    [data, selectedEmployee]
  )

  const filteredRows = useMemo(
    () => (data && selectedEmployee ? filterAmRows(data.zoho, selectedEmployee, selectedMonth, selectedClient) : []),
    [data, selectedEmployee, selectedMonth, selectedClient]
  )

  const totals = useMemo(() => calcAmTotals(filteredRows), [filteredRows])

  const marginYtd = useMemo(
    () => (data && selectedEmployee ? calcAmMarginYtd(data.zoho, selectedEmployee, selectedClient) : 0),
    [data, selectedEmployee, selectedClient]
  )

  const progressGP = calcAmProgressPct(totals.totalActual, target?.gpTarget)
  const progressStretch = calcAmProgressPct(totals.totalActual, target?.gpStretch)
  const progressDream = calcAmProgressPct(totals.totalActual, target?.dreamTarget)

  const comparisonChart = useMemo(
    () => calcAmTargetComparisonChart(target, totals.totalActual),
    [target, totals.totalActual]
  )

  const monthlyTrend = useMemo(
    () => (data && selectedEmployee ? calcAmMonthlyTrend(data.zoho, selectedEmployee, selectedClient) : []),
    [data, selectedEmployee, selectedClient]
  )

  if (data === null && !loadError) {
    return <LoadingSpinner message="Loading Account Managers Performance data..." />
  }

  if (loadError) {
    return (
      <div className="card p-8 text-center mt-6 space-y-3">
        <p className="text-red-400 font-semibold">{loadError}</p>
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
      {/* This tab's own filters — Account Manager (kept from before) + Month
          + Company Name, independent of the shared filter bar */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Account Manager
          </label>
          <select
            value={selectedEmployee || ''}
            onChange={e => setSelectedEmployee(e.target.value)}
            className="filter-input"
          >
            {roster.length === 0 && <option value="">No employees found</option>}
            {roster.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Month
          </label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="filter-input">
            <option value="All">All</option>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Company Name
          </label>
          <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} className="filter-input">
            <option value="All">All</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {selectedEmployee && !hasActiveData && (
          <span className="text-xs dark:text-white/40 text-brand-400">
            No active data for this employee yet.
          </span>
        )}
      </div>

      {selectedEmployee && (
        <>
          {/* Row 1 — fixed annual target values (Targets tab, independent of
              the Month/Company Name filters — they're per-employee only) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPICard label="Target GP Value" value={fmtSAR(target?.gpTarget)} accent />
            <KPICard label="Target Stretch Value" value={fmtSAR(target?.gpStretch)} />
            <KPICard label="Target Dream Value" value={fmtSAR(target?.dreamTarget)} />
          </div>

          {/* Row 2 — the sheet's own pre-set margin % for each target level */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPICard label="Targets Margin GP" value={`${target?.gpTargetPct ?? 0}%`} />
            <KPICard label="Targets Margin Stretch" value={`${target?.gpStretchPct ?? 0}%`} />
            <KPICard label="Targets Margin Dream" value={`${target?.dreamTargetPct ?? 0}%`} />
          </div>

          <h2 className="text-lg font-semibold dark:text-white text-brand-900 pt-2 pb-2 border-b dark:border-white/10 border-brand-200">
            Sales Target Achievement
          </h2>

          {/* Row 3 — Total Actual / Total Upsell respect the Month + Company
              Name filters; Margin (YTD) is always Jan-through-now regardless
              of the Month filter (a fixed year-to-date reference figure) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPICard label="Total Actual (SAR)" value={fmtSAR(totals.totalActual)} accent />
            <KPIRingCard label="Margin (YTD)" value={marginYtd} />
            <KPICard label="Total Upsell (SAR)" value={fmtSAR(totals.totalUpsell)} />
          </div>

          {/* Row 4 — Total Actual (same filtered figure above) ÷ each target level */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPIRingCard label="Progress to GP Target" value={progressGP} />
            <KPIRingCard label="Progress to Stretch Targets" value={progressStretch} />
            <KPIRingCard label="Progress to Dream Targets" value={progressDream} />
          </div>

          {/* Chart 1 — Target Value vs Total Actual per level, with a
              Remaining-to-Target line on top */}
          <MaximizableChartCard title="Target vs Actual Comparison" height={340} modalHeight={480}>
            {h => (
              <ResponsiveContainer width="100%" height={h}>
                <ComposedChart data={comparisonChart} margin={{ top: 28 }}>
                  <XAxis dataKey="category" tick={{ fill: 'currentColor', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'currentColor', fontSize: 11 }} tickFormatter={v => v.toLocaleString()} />
                  <Tooltip content={<GenericTooltip />} />
                  <RechartsLegend content={<BrandLegend />} />
                  <Bar dataKey="targetValue" name="Target Value" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="actual" name="Total Actual" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} />
                  <Line dataKey="remaining" name="Remaining to Target" stroke={ACCENT_LINE} strokeWidth={2} dot={{ r: 4 }}>
                    <LabelList dataKey="remaining" position="top" formatter={fmtSAR}
                      style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </MaximizableChartCard>

          {/* Chart 2 — monthly Upsell/Actual with a GP Margin % line, scoped
              to the Company Name filter (this chart IS the month breakdown,
              so the Month filter itself doesn't narrow it further) */}
          <MaximizableChartCard
            title={`Monthly Actual, Upsell & GP Margin - ${selectedEmployee}`}
            height={340}
            modalHeight={480}
          >
            {h => (
              <ResponsiveContainer width="100%" height={h}>
                <ComposedChart data={monthlyTrend} margin={{ top: 28 }}>
                  <XAxis dataKey="month" tick={{ fill: 'currentColor', fontSize: 11 }}
                    tickFormatter={m => m.slice(0, 3)} />
                  <YAxis yAxisId="left" tick={{ fill: 'currentColor', fontSize: 11 }}
                    tickFormatter={v => v.toLocaleString()} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: 'currentColor', fontSize: 11 }}
                    tickFormatter={v => `${v}%`} />
                  <Tooltip content={<GenericTooltip />} />
                  <RechartsLegend content={<BrandLegend />} />
                  <Bar yAxisId="left" dataKey="upsell" name="Total Upsell (SAR)" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]} />
                  <Bar yAxisId="left" dataKey="actual" name="Total Actual (SAR)" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]} />
                  <Line yAxisId="right" dataKey="gpMarginPct" name="GP Margin %" stroke={ACCENT_LINE} strokeWidth={2} dot={{ r: 3 }}>
                    <LabelList dataKey="gpMarginPct" position="top" formatter={v => `${v}%`}
                      style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </MaximizableChartCard>
        </>
      )}
    </div>
  )
}
