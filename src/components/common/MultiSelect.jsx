import { useState, useRef, useEffect } from 'react'

export default function MultiSelect({ options = [], value = [], onChange, placeholder = 'All', disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const allSelected = options.length > 0 && value.length === options.length

  function toggle(option) {
    if (value.includes(option)) {
      // Keep at least one item selected — fully clearing a filter would
      // silently hide all rows, which reads as a bug rather than a filter.
      if (value.length <= 1) return
      onChange(value.filter(v => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  const label =
    allSelected || value.length === 0
      ? placeholder
      : value.length === 1
      ? value[0]
      : `${value.length} selected`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        title={disabled ? 'Locked by your data access scope' : undefined}
        className={`filter-input flex items-center gap-2 min-w-[140px] justify-between
                    ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span className="truncate max-w-[120px]">{label}</span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full w-max max-h-60 overflow-y-auto
                        rounded-xl border shadow-xl
                        dark:bg-brand-900 dark:border-white/10
                        bg-white border-brand-200">
          {(!allSelected || value.length > 0) && (
            <div className="flex items-center border-b dark:border-white/10 border-brand-100">
              {!allSelected && (
                <button
                  onClick={() => onChange(options)}
                  className="flex-1 text-left px-3 py-2 text-xs font-medium
                             dark:text-accent text-brand-600
                             dark:hover:bg-white/5 hover:bg-brand-50"
                >
                  Select All
                </button>
              )}
              {value.length > 0 && (
                <button
                  onClick={() => onChange([])}
                  className="flex-1 text-left px-3 py-2 text-xs font-medium
                             dark:text-white/60 text-brand-500
                             dark:hover:bg-white/5 hover:bg-brand-50"
                >
                  Deselect All
                </button>
              )}
            </div>
          )}
          {options.map(opt => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm
                         dark:text-white/80 text-brand-800
                         dark:hover:bg-white/5 hover:bg-brand-50"
            >
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-brand-600 w-4 h-4"
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
          {options.length === 0 && (
            <p className="px-3 py-2 text-sm dark:text-white/40 text-brand-400">No options</p>
          )}
        </div>
      )}
    </div>
  )
}
