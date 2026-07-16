export default function KPICard({ label, value, sub, accent = false }) {
  return (
    <div className={`card p-5 flex flex-col gap-1 ${accent ? 'ring-1 ring-accent/40' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500">
        {label}
      </p>
      <p className="text-3xl font-bold dark:text-white text-brand-900 leading-tight">
        {value}
      </p>
      {sub && (
        <p className="text-xs dark:text-white/40 text-brand-400 mt-0.5">{sub}</p>
      )}
    </div>
  )
}
