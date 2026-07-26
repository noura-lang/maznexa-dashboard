import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { useTheme } from '../../context/ThemeContext'
import { useRefreshAll, useLastUpdated } from '../../hooks/useSheetData'
import Toast from '../common/Toast'

export default function Header({ activeTab, setActiveTab }) {
  const { isDark, toggle } = useTheme()
  const refresh            = useRefreshAll()
  const lastUpdated        = useLastUpdated()

  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState(null) // 'success' | 'error' | null
  const toastTimerRef = useRef(null)

  function dismissToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(null)
  }

  function showToast(type) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(type)
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

  const tabs = [
    { id: 'weekly',     label: 'Weekly Report' },
    { id: 'billable',   label: 'Billable vs Non-Billable' },
    { id: 'hours',      label: 'Hours by Client & Project' },
    { id: 'comparison', label: 'Utilization Comparison' },
  ]

  return (
    <>
      <header className="sticky top-0 z-40 dark:bg-brand-950/80 bg-white/70 backdrop-blur-md border-b dark:border-white/10 border-brand-200">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
          {/* Top row: logo + controls */}
          <div className="flex items-center justify-between h-14 gap-4">
            {/* Logo */}
            <img
              src="/logo.png"
              alt="Maznexa"
              className="h-7 w-auto object-contain flex-shrink-0"
              onError={e => { e.target.style.display = 'none' }}
            />

            {/* Right controls */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {lastUpdated && (
                <span className="hidden sm:block text-xs dark:text-white/40 text-brand-400">
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
            </div>
          </div>

          {/* Tab navigation */}
          <nav className="flex gap-1 pb-3 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {toast && <Toast type={toast} onClose={dismissToast} />}
    </>
  )
}
