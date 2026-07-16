import { useEffect, useMemo, useRef } from 'react'
import { format, subDays, startOfMonth } from 'date-fns'
import MultiSelect from '../common/MultiSelect'
import { useFilters } from '../../context/FilterContext'
import { useRawTimeLog } from '../../hooks/useSheetData'
import { getUniqueTeams, getUniqueEmployees, getUniqueClients } from '../../api/transformData'

const DATE_PRESETS = [
  { label: 'Today',        range: () => { const t = new Date(); return [t, t] } },
  { label: 'Yesterday',    range: () => { const y = subDays(new Date(), 1); return [y, y] } },
  { label: 'Last 7 Days',  range: () => { const t = new Date(); return [subDays(t, 6), t] } },
  { label: 'Last 30 Days', range: () => { const t = new Date(); return [subDays(t, 29), t] } },
  { label: 'This Month',   range: () => { const t = new Date(); return [startOfMonth(t), t] } },
]

export default function FilterBar() {
  const {
    startDate, setStartDate,
    endDate, setEndDate,
    selectedTeams, setSelectedTeams,
    selectedEmployees, setSelectedEmployees,
    selectedClients, setSelectedClients,
  } = useFilters()

  const { data: rawRows = [] } = useRawTimeLog()

  const teamOptions     = useMemo(() => getUniqueTeams(rawRows), [rawRows])
  const employeeOptions = useMemo(
    () => getUniqueEmployees(rawRows, selectedTeams),
    [rawRows, selectedTeams]
  )
  const clientOptions   = useMemo(() => getUniqueClients(rawRows), [rawRows])

  // Filters default to "everything selected" once data loads, so unchecking
  // one item reads as "exclude this" rather than starting from a blank slate.
  // Employees are derived from the FINAL team list (not the transient
  // no-team-filter pass) so the count matches exactly — otherwise an
  // employee with a blank TEAM (e.g. "Hiam .") gets counted once when teams
  // are still unset, then dropped once teams settle, permanently leaving
  // selectedEmployees one short of "all" (shows "N selected" instead of
  // "All Employees"). Guarded by a ref so this only runs on first load, not
  // on every background refetch.
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current && teamOptions.length > 0 && clientOptions.length > 0) {
      setSelectedTeams(teamOptions)
      setSelectedEmployees(getUniqueEmployees(rawRows, teamOptions))
      setSelectedClients(clientOptions)
      initialized.current = true
    }
  }, [teamOptions, clientOptions, rawRows])

  function resetAll() {
    setSelectedTeams(teamOptions)
    setSelectedEmployees(getUniqueEmployees(rawRows, teamOptions))
    setSelectedClients(clientOptions)
  }

  function applyDatePreset(range) {
    const [start, end] = range()
    setStartDate(format(start, 'yyyy-MM-dd'))
    setEndDate(format(end, 'yyyy-MM-dd'))
  }

  const hasNarrowedFilters =
    (teamOptions.length > 0 && selectedTeams.length < teamOptions.length) ||
    (employeeOptions.length > 0 && selectedEmployees.length < employeeOptions.length) ||
    (clientOptions.length > 0 && selectedClients.length < clientOptions.length)

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Date range */}
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium whitespace-nowrap">
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="filter-input"
          />
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">
            To
          </label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="filter-input"
          />
        </div>

        {/* Quick date presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {DATE_PRESETS.map(preset => (
            <button
              key={preset.label}
              onClick={() => applyDatePreset(preset.range)}
              className="text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap
                         dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white
                         bg-brand-50 text-brand-600 hover:bg-brand-100"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-6 w-px dark:bg-white/15 bg-brand-200" />

        {/* Team filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Team</label>
          <MultiSelect
            options={teamOptions}
            value={selectedTeams}
            onChange={val => {
              setSelectedTeams(val)
              setSelectedEmployees(getUniqueEmployees(rawRows, val))
            }}
            placeholder="All Teams"
          />
        </div>

        {/* Employee filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Employee</label>
          <MultiSelect
            options={employeeOptions}
            value={selectedEmployees}
            onChange={setSelectedEmployees}
            placeholder="All Employees"
          />
        </div>

        {/* Client filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs dark:text-white/50 text-brand-500 font-medium">Client</label>
          <MultiSelect
            options={clientOptions}
            value={selectedClients}
            onChange={setSelectedClients}
            placeholder="All Clients"
          />
        </div>

        {/* Reset filters */}
        {hasNarrowedFilters && (
          <button
            onClick={resetAll}
            className="text-xs px-3 py-1.5 rounded-lg transition-colors
                       dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10
                       text-brand-500 hover:text-brand-700 hover:bg-brand-100"
          >
            ↺ Reset filters
          </button>
        )}
      </div>
    </div>
  )
}
