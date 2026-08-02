import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useRefreshAll, useLastUpdated } from '../../hooks/useSheetData'
import Toast from '../common/Toast'

// Refresh/Dark mode/Sign Out controls — previously the right side of
// Header.jsx's top row, now living at the top of the main content column
// instead of a full-width header, since navigation moved to the Sidebar.
// The whole-tab "Export PDF" button that used to live here is gone —
// export is now per-chart/per-table only (see ExportMenu.jsx, used inside
// MaximizableChartCard).
export default function TopBar() {
  const { isDark, toggle } = useTheme()
  const refresh            = useRefreshAll()
  const lastUpdated        = useLastUpdated()
  const { firebaseUser, employee, signOut } = useAuth()

  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState(null) // { type: 'success'|'error', messages? } | null
  const toastTimerRef = useRef(null)

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(null)
  }

  function showToast(type, messages) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ type, messages })
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh()
      showToast('success')
    } catch (err) {
      console.error('Refresh failed:', err)
      showToast('error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <div className="dark:bg-brand-950/80 bg-white/70 backdrop-blur-md border-b dark:border-white/10 border-brand-200">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-end h-14 gap-3">
            {lastUpdated && (
              <span className="hidden sm:block text-xs font-light dark:text-white/40 text-brand-400">
                Updated {format(lastUpdated, 'HH:mm')}
              </span>
            )}

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh data"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                         dark:bg-white/10 dark:hover:bg-white/20 dark:text-white
                         bg-brand-100 hover:bg-brand-200 text-brand-700"
            >
              <svg
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>

            {/* Dark/Light toggle */}
            <button
              onClick={toggle}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors
                         dark:bg-white/10 dark:hover:bg-white/20
                         bg-brand-100 hover:bg-brand-200"
            >
              {isDark ? (
                <svg className="w-4 h-4 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-brand-700" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>

            {/* Signed-in user + Sign Out */}
            <div className="flex items-center gap-2 pl-3 ml-1 border-l dark:border-white/10 border-brand-200">
              {firebaseUser?.photoURL ? (
                <img
                  src={firebaseUser.photoURL}
                  alt={employee?.name || firebaseUser.email}
                  title={employee?.name || firebaseUser.email}
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  title={employee?.name || firebaseUser?.email}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0
                             dark:bg-white/10 dark:text-white bg-brand-100 text-brand-700"
                >
                  {(employee?.name || firebaseUser?.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="hidden md:block text-xs font-medium dark:text-white/70 text-brand-700 max-w-[120px] truncate">
                {employee?.name || firebaseUser?.email}
              </span>
              <button
                onClick={signOut}
                title="Sign Out"
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors
                           dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10
                           text-brand-500 hover:text-brand-800 hover:bg-brand-100"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {toast && <Toast type={toast.type} messages={toast.messages} onClose={dismissToast} />}
    </>
  )
}
