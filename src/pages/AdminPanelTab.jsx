import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchEmployees, fetchPermissions, updateAccessRow, appendPermissionsRow,
  parsePermissionsRow, permissionsToRow, PERMISSION_COLUMNS, ACCESS_TABS,
  DATA_SCOPES, DEFAULT_DENIED_PERMISSIONS,
} from '../api/accessSheetApi'
import LoadingSpinner from '../components/common/LoadingSpinner'

const BOOL_FIELDS = [
  { key: 'weeklyReport',    label: 'Weekly Report' },
  { key: 'billableView',    label: 'Billable View' },
  { key: 'hoursReport',     label: 'Hours Report' },
  { key: 'utilization',     label: 'Utilization' },
  { key: 'taskDetails',     label: 'Task Details' },
  { key: 'tags',            label: 'Tags' },
  { key: 'amPerformance',   label: 'AM Performance' },
  { key: 'costAnalysis',    label: 'Cost Analysis' },
  { key: 'financialAccess', label: 'Financial Access' },
  { key: 'export',          label: 'Export' },
  { key: 'admin',           label: 'Admin' },
]

const DATA_SCOPE_OPTIONS = [DATA_SCOPES.MY_DATA, DATA_SCOPES.MY_TEAM, DATA_SCOPES.ALL]

// Admin Panel — visible only to users whose Permissions row has Admin=TRUE
// (enforced by App.jsx's tab gating, not re-checked here). Reads/writes the
// Permissions tab of the Access Sheet using the signed-in admin's own
// Google OAuth access token (see accessSheetApi.js / AuthContext) — there's
// no backend or service account involved, so writes only succeed if this
// admin's Google account actually has Editor sharing on the Access Sheet in
// Google Drive.
export default function AdminPanelTab() {
  const { accessToken } = useAuth()
  const [rows, setRows] = useState(null) // null while loading
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [employees, permissionRows] = await Promise.all([
        fetchEmployees(accessToken),
        fetchPermissions(accessToken),
      ])
      const permByEmail = new Map(
        permissionRows.map(p => [(p.Email || '').toLowerCase(), p])
      )
      setRows(employees.map(emp => {
        const email = emp.Email || ''
        const existing = permByEmail.get(email.toLowerCase())
        return {
          email,
          name: emp.Name || '',
          team: emp.Team || '',
          role: emp.Role || '',
          permRowNumber: existing?._row ?? null,
          permissions: existing ? parsePermissionsRow(existing) : DEFAULT_DENIED_PERMISSIONS,
          dirty: false,
          saving: false,
          saveError: null,
        }
      }))
    } catch (err) {
      console.error('Failed to load Access Sheet data:', err)
      setLoadError(err.message)
    }
  }, [accessToken])

  useEffect(() => { load() }, [load])

  function updateRow(email, patch) {
    setRows(prev => prev.map(r => (r.email === email ? { ...r, ...patch, dirty: true, saveError: null } : r)))
  }

  function toggleField(email, field) {
    setRows(prev => prev.map(r => (
      r.email === email
        ? { ...r, permissions: { ...r.permissions, [field]: !r.permissions[field] }, dirty: true, saveError: null }
        : r
    )))
  }

  async function saveRow(row) {
    setRows(prev => prev.map(r => (r.email === row.email ? { ...r, saving: true, saveError: null } : r)))
    try {
      if (row.permRowNumber) {
        await updateAccessRow(
          accessToken, ACCESS_TABS.PERMISSIONS, row.permRowNumber,
          PERMISSION_COLUMNS, permissionsToRow(row.email, row.permissions)
        )
      } else {
        await appendPermissionsRow(accessToken, row.email, row.permissions)
      }
      // Re-sync row numbers (needed after an append) and clear the dirty flag.
      await load()
    } catch (err) {
      console.error('Failed to save permissions:', err)
      setRows(prev => prev.map(r => (
        r.email === row.email ? { ...r, saving: false, saveError: err.message } : r
      )))
    }
  }

  const dirtyCount = useMemo(() => rows?.filter(r => r.dirty).length ?? 0, [rows])

  if (rows === null && !loadError) return <LoadingSpinner message="Loading employees & permissions..." />

  if (loadError) return (
    <div className="card p-8 text-center mt-6 space-y-3">
      <p className="text-red-400 font-semibold">{loadError}</p>
      <p className="text-xs dark:text-white/50 text-brand-500">
        This usually means your Google account doesn't have (at least) Viewer access to the
        Access Sheet in Google Drive, or your session's Sheets access token expired — try
        signing in again.
      </p>
      <button onClick={load} className="filter-input text-xs px-4 py-1.5">Retry</button>
    </div>
  )

  return (
    <div className="space-y-6 pt-4">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">
            Admin Panel — Employee Permissions
          </h3>
          {dirtyCount > 0 && (
            <span className="text-xs font-medium dark:text-white/50 text-brand-500">
              {dirtyCount} row{dirtyCount > 1 ? 's' : ''} with unsaved changes
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-white/10 border-brand-200">
                {['Name', 'Team', 'Email', ...BOOL_FIELDS.map(f => f.label), 'Data Scope', ''].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider
                                         dark:text-white/50 text-brand-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.email}
                  className={`border-b dark:border-white/5 border-brand-100
                    ${i % 2 === 0 ? 'dark:bg-white/[0.02] bg-brand-50/50' : ''}`}
                >
                  <td className="py-2 px-3 font-medium dark:text-white text-brand-900 whitespace-nowrap">{row.name || '—'}</td>
                  <td className="py-2 px-3 dark:text-white/70 text-brand-600 whitespace-nowrap">{row.team || '—'}</td>
                  <td className="py-2 px-3 dark:text-white/60 text-brand-600 whitespace-nowrap">{row.email}</td>
                  {BOOL_FIELDS.map(f => (
                    <td key={f.key} className="py-2 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={row.permissions[f.key]}
                        onChange={() => toggleField(row.email, f.key)}
                        className="accent-brand-600 w-4 h-4 cursor-pointer"
                      />
                    </td>
                  ))}
                  <td className="py-2 px-3">
                    <select
                      value={row.permissions.dataScope}
                      onChange={e => updateRow(row.email, { permissions: { ...row.permissions, dataScope: e.target.value } })}
                      className="filter-input text-xs py-1"
                    >
                      {DATA_SCOPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <button
                      onClick={() => saveRow(row)}
                      disabled={!row.dirty || row.saving}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                                 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white
                                 bg-brand-100 hover:bg-brand-200 text-brand-700"
                    >
                      {row.saving ? 'Saving…' : row.dirty ? 'Save' : 'Saved'}
                    </button>
                    {row.saveError && (
                      <p className="text-xs text-red-400 mt-1 max-w-[180px]">{row.saveError}</p>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={BOOL_FIELDS.length + 5} className="py-8 text-center dark:text-white/50 text-brand-500">
                    No employees found in the Employees tab.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
