import { useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

// Single-select counterpart to MultiSelect.jsx, sharing its exact
// custom-styled panel — native <select> popups can't be reliably themed
// (Chrome/Windows renders the open options list with its own background
// regardless of CSS on <option>, and only applies real contrast to the item
// under the cursor), which is why every native-select filter looked
// inconsistent with the rest of the app and had unreadable text in dark
// mode until hovered. Every single-select filter in the app should use this
// instead of a bare <select>.
//
// The open panel is rendered via a portal straight onto <body>, exactly
// like MaximizableChartCard's modal — nesting it inside the trigger's
// ancestors would put it under a `.card`, whose `backdrop-blur-sm` creates
// a new stacking context that traps the panel's z-index locally, so a
// later `.card` further down the page (e.g. a KPI card) paints over it
// despite the panel's own z-50. Portaling to <body> sidesteps that, with
// `position: fixed` + the trigger's own measured rect used to anchor it
// (a portaled node can't rely on `position: absolute` relative to its
// original DOM parent anymore).
//
// `options` accepts either plain strings (label === value) or
// `{ value, label }` objects, matching whichever shape is more natural at
// each call site.
export default function Dropdown({
  options = [], value, onChange, placeholder = 'Select', disabled = false,
  className = '', buttonClassName = '',
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) return
    function updateRect() {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }
    updateRect()
    window.addEventListener('scroll', updateRect, true)
    window.addEventListener('resize', updateRect)
    return () => {
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('resize', updateRect)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const normalized = options.map(o => (o !== null && typeof o === 'object' ? o : { value: o, label: String(o) }))
  const selected = normalized.find(o => o.value === value)

  function select(opt) {
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <div ref={triggerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className={`filter-input flex items-center gap-2 justify-between
                    ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${buttonClassName}`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width }}
          className="z-[70] w-max max-h-60 overflow-y-auto
                     rounded-xl border shadow-xl
                     dark:bg-brand-900 dark:border-white/10
                     bg-white border-brand-200"
        >
          {normalized.map(opt => (
            <button
              type="button"
              key={opt.value}
              onClick={() => select(opt)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm truncate
                         dark:hover:bg-white/5 hover:bg-brand-50
                         ${opt.value === value
                           ? 'dark:text-accent text-brand-600 font-semibold'
                           : 'dark:text-white/80 text-brand-800'}`}
            >
              {opt.label}
            </button>
          ))}
          {normalized.length === 0 && (
            <p className="px-3 py-2 text-sm dark:text-white/40 text-brand-400">No options</p>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
