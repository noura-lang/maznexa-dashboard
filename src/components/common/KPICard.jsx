// Simple number KPI card — big value + label above it, on a soft purple
// brand gradient. Reserved for plain totals (hours, counts); percentages use
// KPIRingCard's progress ring instead. Pass onClick to make the whole card a
// button (e.g. drilling into the team/period it summarizes) — uses a native
// <button> wrapper rather than nesting this div inside one, since a <div> is
// not valid <button> content.
export default function KPICard({ label, value, sub, accent = false, onClick }) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`card p-5 flex flex-col gap-1 rounded-2xl text-left w-full
        bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
        from-brand-200/70 via-brand-100/30 to-transparent
        ${accent ? 'ring-1 ring-accent/40' : ''}
        ${onClick ? 'transition-opacity hover:opacity-80 cursor-pointer' : ''}`}
    >
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
        {label}
      </p>
      <p className="text-3xl font-bold dark:text-white text-brand-900 leading-tight">
        {value}
      </p>
      {sub && (
        <p className="text-xs dark:text-white/40 text-brand-400 mt-0.5">{sub}</p>
      )}
    </Wrapper>
  )
}
