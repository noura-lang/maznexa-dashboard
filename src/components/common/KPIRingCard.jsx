import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { utilizationColor } from '../../api/transformData'

// Percentage KPI card — a progressive donut ring that fills to the value,
// with the number centered inside. Used for every top-level utilization %
// widget across the dashboard (Overall/YTD Utilization, Billable Rate, etc.)
// instead of a plain text KPICard, per the round-widget redesign.
export default function KPIRingCard({ label, value, sub, size = 132 }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  const color = utilizationColor(pct).bg
  const data = [{ v: pct }, { v: Math.max(0, 100 - pct) }]

  return (
    <div
      className="card p-5 flex flex-col items-center justify-center gap-1 rounded-2xl
                 bg-gradient-to-br dark:from-brand-600/30 dark:via-brand-700/10 dark:to-transparent
                 from-brand-200/70 via-brand-100/30 to-transparent"
    >
      <p className="text-xs font-medium uppercase tracking-wider dark:text-white/50 text-brand-500 text-center">
        {label}
      </p>
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="v"
              innerRadius="72%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={color} />
              <Cell fill="rgba(140,143,254,0.15)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{Math.round(pct)}%</span>
        </div>
      </div>
      {sub && (
        <p className="text-xs font-light dark:text-white/40 text-brand-400 mt-0.5 text-center">{sub}</p>
      )}
    </div>
  )
}
