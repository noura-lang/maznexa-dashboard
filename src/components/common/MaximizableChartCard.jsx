import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ExportMenu from './ExportMenu'

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

// Plain-text title, left-aligned — matches the other (never-badged) chart
// and table titles on this tab (e.g. "Utilization by Employee", "Task Details").
function CardHeader({ title, headerExtra, exportSlot, onAction, actionIcon, actionTitle }) {
  return (
    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h3 className="text-sm font-semibold dark:text-white/80 text-brand-800">{title}</h3>
      <div className="flex items-center gap-3 flex-wrap">
        {headerExtra}
        <div className="flex items-center gap-1">
          {exportSlot}
          <button
            type="button"
            onClick={onAction}
            className="p-1.5 rounded-lg dark:hover:bg-white/10 hover:bg-brand-100
                       dark:text-white/50 text-brand-500 transition-colors"
            title={actionTitle}
            aria-label={actionTitle}
          >
            {actionIcon}
          </button>
        </div>
      </div>
    </div>
  )
}

// Recomputes and (re-)applies one element's shrink-to-fit transform. Safe to
// call repeatedly — `scrollWidth`/`clientWidth` reflect the element's real
// layout box and are unaffected by a `transform` or by `overflow-x:visible`
// applied to the element itself, so this always measures the true numbers
// and converges to the same result rather than compounding.
function applyScaleFit(el) {
  const naturalWidth = el.scrollWidth
  const availableWidth = el.clientWidth
  if (naturalWidth <= 0 || availableWidth <= 0) return
  // Never scale up — content narrower than the modal just renders as-is.
  const scale = naturalWidth > availableWidth ? availableWidth / naturalWidth : 1
  const transform = scale < 1 ? `scale(${scale})` : ''
  // `transform` shrinks the element visually but not its own layout box, so
  // without an explicit height a scaled-down chart would still reserve its
  // full unscaled height (a tall blank gap below it) — pin it to match.
  const heightPx = scale < 1 ? `${el.scrollHeight * scale}px` : ''
  if (el.style.transform !== transform) el.style.transform = transform
  if (el.style.height !== heightPx) el.style.height = heightPx
}

// A table with its own inline `maxHeight` (a deliberate vertical scroll cap,
// e.g. a very tall list) can't be freed to its natural width the way charts
// are: the CSS overflow interdependency rule means `overflow-x` can't
// actually become `visible` while `overflow-y` stays `auto` — freeing it
// would silently break that table's vertical scrolling. For these, shrink
// the text instead: smaller cells fit more columns in the same width, so
// horizontal scrolling is needed less often (or not at all) without
// touching how the vertical scroll itself behaves. Resets first so repeated
// passes (resize, live filter changes) measure the true natural width each
// time instead of compounding an earlier shrink.
function applyFontShrink(el) {
  el.style.fontSize = ''
  const headers = el.querySelectorAll('th')
  headers.forEach(th => { th.style.minWidth = '' })
  const naturalWidth = el.scrollWidth
  const availableWidth = el.clientWidth
  if (naturalWidth <= availableWidth || naturalWidth <= 0 || availableWidth <= 0) return
  // Cell padding/borders don't shrink 1:1 with font-size, so this is a
  // best-effort fit, not a guaranteed one — floored so text never becomes
  // illegible chasing an exact match for extreme column counts.
  const ratio = availableWidth / naturalWidth
  const pct = Math.max(60, Math.round(ratio * 100))
  el.style.fontSize = `${pct}%`
  // A pivot-style table's `<th>` sets a per-column `min-width` (so narrow
  // values don't collapse a column below a readable size) — table-layout
  // then pins every cell in that column to at least that width regardless
  // of font-size, which alone would leave this whole fix a no-op for wide
  // pivot tables specifically. Scale each header's own min-width down by
  // the same ratio so the column floor shrinks along with the text.
  headers.forEach(th => {
    const computedMinWidth = parseFloat(getComputedStyle(th).minWidth)
    if (computedMinWidth > 0) th.style.minWidth = `${computedMinWidth * (pct / 100)}px`
  })
}

// Every chart/table wraps its wide content in an `overflow-x-auto` /
// `overflow-auto` / `overflow-y-auto` div (a deliberate "scroll within a
// small box" containment — always one of these three literal Tailwind
// classes throughout the app) — exactly what forces a horizontal scrollbar
// inside the maximized modal. This finds every such box within `root`,
// flips it to `overflow: visible` (so its content isn't clipped/scrolled
// but simply painted at full size) and applies a computed `transform:
// scale()` DIRECTLY to that same box so the now-unclipped content shrinks
// uniformly (bars, fonts, spacing together) to fit the space it actually has.
//
// Matches on the literal classes rather than walking every descendant and
// calling `getComputedStyle` on each — a table maximized to its full,
// unpaginated row count (e.g. Task Details' ~2,000 rows) can easily have
// 15,000+ descendant nodes, and a `getComputedStyle`/style-write pair on
// each one forces a synchronous layout recalculation per element, hanging
// the tab for many seconds. The native class-selector query stays fast
// regardless of subtree size.
function fitOverflowingContent(root) {
  root.querySelectorAll('.overflow-x-auto, .overflow-auto, .overflow-y-auto').forEach(el => {
    if (el.style.maxHeight) {
      applyFontShrink(el)
      return
    }
    // Both axes must become `visible` together — browsers flip a lone
    // `overflow-x: visible` back to `auto` if `overflow-y` stays non-visible
    // (the CSS spec's overflow interdependency rule), which would silently
    // undo this.
    el.style.overflowX = 'visible'
    el.style.overflowY = 'visible'
    el.style.transformOrigin = 'top left'
    applyScaleFit(el)
  })
}

// Wraps a chart card with a "Maximize" affordance — clicking it (or the card
// title area's icon button) reopens the exact same chart larger in a modal.
// `children` is a render-prop `(height) => <ResponsiveContainer .../>` so the
// same chart definition renders both inline (compact height) and in the
// modal (taller height) without duplicating chart JSX. Tables use the same
// render-prop: most ignore `height`, a few use it as an inline
// `style={{ maxHeight: h }}` scroll cap so the modal gets more room, and a
// couple compare `height === modalHeight` to know they're rendering inside
// the modal (e.g. to show a full unpaginated list there).
//
// `exportRows`/`exportColumns` are optional — when both are given, an Export
// menu (PDF/Excel/Google Sheets, see ExportMenu.jsx) renders next to the
// Maximize icon, scoped to this element's own data. PDF captures the
// compact (non-maximized) card's DOM via `cardRef` — html2canvas's scale:2
// already produces high-res output regardless of on-screen CSS size, so the
// modal's larger pixel dimensions add nothing worth the extra plumbing of a
// second ref.
export default function MaximizableChartCard({
  title, headerExtra, height = 280, modalHeight = 480, children, className = '',
  exportRows, exportColumns,
}) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef(null)
  const modalBoxRef = useRef(null)
  const scaleWrapperRef = useRef(null)
  const exportSlot = (exportRows && exportColumns)
    ? <ExportMenu title={title} rows={exportRows} columns={exportColumns} targetRef={cardRef} />
    : null

  // Shrinks the maximized modal's content to fit its available width instead
  // of leaving it to scroll horizontally — this is the ONE place that fix
  // lives, so every chart/table gets it automatically just by using this
  // component, with no per-chart changes needed.
  useLayoutEffect(() => {
    if (!open) return
    const wrapper = scaleWrapperRef.current
    if (!wrapper) return

    const fit = () => fitOverflowingContent(wrapper)

    // recharts' own ResponsiveContainer needs a tick to settle its natural
    // (unclipped) size after mount — same two-rAF pattern used elsewhere in
    // this app to wait out a chart repaint before measuring it.
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit))
    const ro = new ResizeObserver(fit)
    ro.observe(wrapper)
    window.addEventListener('resize', fit)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [open])

  return (
    <div ref={cardRef} className={`card p-5 ${className}`} data-pdf-section data-pdf-title={title}>
      <CardHeader
        title={title}
        headerExtra={headerExtra}
        exportSlot={exportSlot}
        onAction={() => setOpen(true)}
        actionIcon={<MaximizeIcon className="w-4 h-4" />}
        actionTitle="Maximize chart"
      />

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
            ref={modalBoxRef}
            className="w-[95vw] max-w-[1800px] max-h-[92vh] overflow-auto p-6 rounded-2xl shadow-2xl
                       border dark:border-white/10 border-brand-200
                       dark:bg-brand-950 bg-white"
            onClick={e => e.stopPropagation()}
          >
            <CardHeader
              title={title}
              headerExtra={headerExtra}
              onAction={() => setOpen(false)}
              actionIcon={<CloseIcon className="w-4 h-4" />}
              actionTitle="Close"
            />

            <div ref={scaleWrapperRef}>
              {children(modalHeight)}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
