import { useState } from 'react'
import { createPortal } from 'react-dom'

function MaximizeIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function CloseIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

// Wraps a chart card with a "Maximize" affordance — clicking it (or the card
// title area's icon button) reopens the exact same chart larger in a modal.
// `children` is a render-prop `(height) => <ResponsiveContainer .../>` so the
// same chart definition renders both inline (compact height) and in the
// modal (taller height) without duplicating chart JSX.
export default function MaximizableChartCard({
  title, headerExtra, height = 280, modalHeight = 480, children, className = '',
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">{title}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {headerExtra}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="p-1.5 rounded-lg dark:hover:bg-white/10 hover:bg-brand-100
                       dark:text-white/50 text-brand-500 transition-colors"
            title="Maximize chart"
            aria-label="Maximize chart"
          >
            <MaximizeIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {children(height)}

      {open && createPortal(
        // Rendered via a portal straight onto <body> — nesting this inside the
        // card would put it under an ancestor with `backdrop-blur` (Tailwind's
        // `.card` class), and `backdrop-filter` establishes a new containing
        // block for `position: fixed` descendants per spec. That silently
        // confines "fixed inset-0" to the small card's box instead of the
        // viewport, clipping the enlarged chart — the portal sidesteps it.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-6xl max-h-[90vh] overflow-auto p-6 rounded-2xl shadow-2xl
                       border dark:border-white/10 border-brand-200
                       dark:bg-brand-950 bg-white"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-base font-semibold dark:text-white/80 text-brand-800">{title}</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {headerExtra}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg dark:hover:bg-white/10 hover:bg-brand-100
                             dark:text-white/50 text-brand-500 transition-colors"
                  title="Close"
                  aria-label="Close"
                >
                  <CloseIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {children(modalHeight)}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
