// Pill-shaped, brand-purple chart title — wrap a chart card's <h3> content
// with this instead of plain text. Purely presentational; the caller still
// owns the surrounding <h3> (alignment/margin) since that varies slightly
// per card.
export default function ChartTitleBadge({ children }) {
  return (
    <span
      className="inline-block px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold text-white whitespace-nowrap"
      style={{ backgroundColor: '#9354ff' }}
    >
      {children}
    </span>
  )
}
