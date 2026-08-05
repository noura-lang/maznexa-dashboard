import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchSecureJson } from '../api/secureApi'
import {
  getAmEmployeeRoster, getAmClientsForEmployees, filterAmRows,
  calcAmTotals, calcAmMarginYtd, calcAmProgressPct, calcAmCombinedTarget,
  calcAmTargetComparisonChart, calcAmMonthlyTrend,
} from '../api/amSheetApi'
import LoadingSpinner from '../components/common/LoadingSpinner'
import KPICard from '../components/common/KPICard'
import KPIRingCard from '../components/common/KPIRingCard'
import MaximizableChartCard from '../components/common/MaximizableChartCard'
import Dropdown from '../components/common/Dropdown'
import MultiSelect from '../components/common/MultiSelect'
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
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('All')
  const [selectedClients, setSelectedClients] = useState([])

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

  // Default to every Account Manager selected (same "start with everything,
  // narrowing reads as excluding" convention as the Team/Employee filters
  // elsewhere) — only runs once the roster first loads.
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && roster.length > 0) {
      setSelectedEmployees(roster)
      setSelectedClients(getAmClientsForEmployees(data.zoho, roster))
      initialized.current = true
    }
  }, [roster, data])

  const clientOptions = useMemo(
    () => (data ? getAmClientsForEmployees(data.zoho, selectedEmployees) : []),
    [data, selectedEmployees]
  )

  const hasActiveData = useMemo(
    () => !!(data && selectedEmployees.length > 0 && (
      data.zoho.some(r => selectedEmployees.includes(r.employee)) ||
      data.targets.some(t => selectedEmployees.includes(t.employee))
    )),
    [data, selectedEmployees]
  )

  const target = useMemo(
    () => (data ? calcAmCombinedTarget(data.targets, selectedEmployees) : null),
    [data, selectedEmployees]
  )

  const filteredRows = useMemo(
    () => (data && selectedEmployees.length > 0 ? filterAmRows(data.zoho, selectedEmployees, selectedMonth, selectedClients) : []),
    [data, selectedEmployees, selectedMonth, selectedClients]
  )

  const totals = useMemo(() => calcAmTotals(filteredRows), [filteredRows])

  const marginYtd = useMemo(
    () => (data && selectedEmployees.length > 0 ? calcAmMarginYtd(data.zoho, selectedEmployees, selectedClients) : 0),
    [data, selectedEmployees, selectedClients]
  )

  const progressGP = calcAmProgressPct(totals.totalActual, target?.gpTarget)
  const progressStretch = calcAmProgressPct(totals.totalActual, target?.gpStretch)
  const progressDream = calcAmProgressPct(totals.totalActual, target?.dreamTarget)

  const comparisonChart = useMemo(
    () => calcAmTargetComparisonChart(target, totals.totalActual),
    [target, totals.totalActual]
  )

  const monthlyTrend = useMemo(
    () => (data && selectedEmployees.length > 0 ? calcAmMonthlyTrend(data.zoho, selectedEmployees, selectedClients) : []),
    [data, selectedEmployees, selectedClients]
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
      {/* This tab's own filters — Account Manager + Month + Company Name,
          independent of the shared filter bar. Account Manager/Company Name
          are multi-select (same MultiSelect component/UX as the Team filter
          elsewhere); Month stays single-select. */}
      <div className="card p-4 flex flex-wrap items-center gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Account Manager
          </label>
          <MultiSelect
            options={roster}
            value={selectedEmployees}
            onChange={val => {
              setSelectedEmployees(val)
              setSelectedClients(getAmClientsForEmployees(data.zoho, val))
            }}
            placeholder={roster.length === 0 ? 'No employees found' : 'All Account Managers'}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Month
          </label>
          <Dropdown options={['All', ...MONTHS]} value={selectedMonth} onChange={setSelectedMonth} />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
            Company Name
          </label>
          <MultiSelect options={clientOptions} value={selectedClients} onChange={setSelectedClients} placeholder="All Clients" />
        </div>

        {selectedEmployees.length > 0 && !hasActiveData && (
          <span className="text-xs dark:text-white/40 text-brand-400">
            No active data for the selected Account Manager(s) yet.
          </span>
        )}
      </div>

      {selectedEmployees.length > 0 && (
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
                  <Bar dataKey="targetValue" name="Target Value" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="targetValue" position="top" formatter={fmtSAR}
                      style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                  </Bar>
                  <Bar dataKey="actual" name="Total Actual" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="actual" position="top" formatter={fmtSAR}
                      style={{ fill: 'currentColor', fontSize: 10, fontWeight: 600 }} />
                  </Bar>
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
            title={`Monthly Actual, Upsell & GP Margin - ${selectedEmployees.join(', ')}`}
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
                  <Bar yAxisId="left" dataKey="upsell" name="Total Upsell (SAR)" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="upsell" position="top" formatter={fmtSAR} angle={-60}
                      style={{ fill: 'currentColor', fontSize: 9, fontWeight: 600 }} />
                  </Bar>
                  <Bar yAxisId="left" dataKey="actual" name="Total Actual (SAR)" fill={CHART_COLORS[5]} radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="actual" position="top" formatter={fmtSAR} angle={-60}
                      style={{ fill: 'currentColor', fontSize: 9, fontWeight: 600 }} />
                  </Bar>
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
