// Shared clickable table header cell for every sortable table dashboard-wide.
// Every sortable column always shows a dim double-arrow (▲▼) hint so the
// affordance is visible before the first click, not just after; once a
// column becomes the active sort key, its label brightens, the header gets
// a highlighted background, and the arrow grows into a single bold ▲/▼
// showing the actual direction — so the active sort column reads at a
// glance, not just on hover/click.
export function SortIndicator({ active, dir }) {
  if (active) {
    return (
      <span className="dark:text-accent text-brand-600 text-sm leading-none">
        {dir === 'desc' ? '▼' : '▲'}
      </span>
    )
  }
  return (
    <span className="flex flex-col leading-[7px] dark:text-white/25 text-brand-300 text-[7px]">
      <span>▲</span>
      <span>▼</span>
    </span>
  )
}

export default function SortableTh({ label, active, dir, onClick, align = 'left', className = '' }) {
  return (
    <th
      onClick={onClick}
      className={`py-2 px-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap
                 transition-colors
                 ${align === 'right' ? 'text-right' : 'text-left'}
                 ${active
                   ? 'dark:bg-white/10 bg-brand-100 dark:text-white text-brand-900'
                   : 'dark:text-white/50 text-brand-500 dark:hover:text-white/80 hover:text-brand-700'}
                 ${className}`}
    >
      <span className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <SortIndicator active={active} dir={dir} />
      </span>
    </th>
  )
}
