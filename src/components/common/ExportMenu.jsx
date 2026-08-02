import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { exportElementAsPdf, exportRowsAsExcel, exportRowsToGoogleSheet } from '../../utils/exportElement'

function DownloadIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

function SpinnerIcon({ className }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

// Per-element export menu — sits next to the Maximize icon on any chart or
// table card (see MaximizableChartCard.jsx). `targetRef` points at the DOM
// node to screenshot for PDF; `rows`/`columns` are this element's own data
// for Excel/Google Sheets (full precision, independent of whatever the
// on-screen chart/table label happens to show). No permission check here —
// this only ever renders inside a tab the user's `visibleTabIds` already
// allowed (App.jsx), so tab-level gating already covers it.
export default function ExportMenu({ title, rows, columns, targetRef }) {
  const { accessToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheetsStatus, setSheetsStatus] = useState(null) // { type: 'ok'|'error', message } | null
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false)
        setSheetsStatus(null)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function handlePdf() {
    if (busy) return
    setBusy(true)
    // Close the dropdown first — exportElementAsPdf screenshots targetRef,
    // and this menu sits inside it, so it must be gone from the DOM (and
    // repainted) before capture starts, not just hidden after the fact.
    setOpen(false)
    try {
      await exportElementAsPdf(targetRef.current, title)
    } catch (err) {
      console.error('PDF export failed:', err)
      setOpen(true)
      setSheetsStatus({ type: 'error', message: 'PDF export failed — try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleExcel() {
    if (busy) return
    setBusy(true)
    try {
      await exportRowsAsExcel(rows, columns, title)
      setOpen(false)
    } catch (err) {
      console.error('Excel export failed:', err)
      setSheetsStatus({ type: 'error', message: 'Excel export failed — try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleSheets() {
    if (busy) return
    setBusy(true)
    setSheetsStatus({ type: 'pending', message: 'Creating…' })
    try {
      const url = await exportRowsToGoogleSheet(accessToken, rows, columns, title)
      setSheetsStatus({ type: 'ok', message: 'Done — opening…' })
      window.open(url, '_blank', 'noopener')
      setTimeout(() => { setOpen(false); setSheetsStatus(null) }, 800)
    } catch (err) {
      console.error('Google Sheets export failed:', err)
      setSheetsStatus({
        type: 'error',
        message: 'Failed — your session may need signing in again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="p-1.5 rounded-lg dark:hover:bg-white/10 hover:bg-brand-100
                   dark:text-white/50 text-brand-500 transition-colors disabled:opacity-60"
        title="Export"
        aria-label="Export"
      >
        {busy ? <SpinnerIcon className="w-4 h-4" /> : <DownloadIcon className="w-4 h-4" />}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-20 w-56 rounded-xl shadow-xl border overflow-hidden
                     dark:bg-brand-900 dark:border-white/10 bg-white border-brand-200"
        >
          <button
            type="button"
            onClick={handlePdf}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60
                       dark:text-white/80 dark:hover:bg-white/10 text-brand-800 hover:bg-brand-100"
          >
            Export as PDF
          </button>
          <button
            type="button"
            onClick={handleExcel}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60
                       dark:text-white/80 dark:hover:bg-white/10 text-brand-800 hover:bg-brand-100
                       border-t dark:border-white/5 border-brand-100"
          >
            Export as Excel
          </button>
          <button
            type="button"
            onClick={handleGoogleSheets}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60
                       dark:text-white/80 dark:hover:bg-white/10 text-brand-800 hover:bg-brand-100
                       border-t dark:border-white/5 border-brand-100"
          >
            Export to Google Sheets
          </button>
          {sheetsStatus && (
            <p className={`px-3 py-1.5 text-[11px] border-t dark:border-white/5 border-brand-100
              ${sheetsStatus.type === 'error' ? 'text-red-400' : 'dark:text-white/50 text-brand-500'}`}>
              {sheetsStatus.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
