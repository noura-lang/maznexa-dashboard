import { format } from 'date-fns'

// Time-of-day greeting shown at the top of every tab, above the KPI cards.
// Purely derived from the device clock at render time — no login system
// involved, "Noura" is a static string independent of the separate Firebase
// Auth work in progress.
function getGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return { text: 'Good Morning', emoji: '👋' }
  if (hour >= 12 && hour < 18) return { text: 'Good Afternoon', emoji: '☀️' }
  return { text: 'Good Evening', emoji: '🌙' }
}

// `showDate` is opt-in (Weekly Report only, for now — a trial run per Noura
// before it potentially rolls out to the other three tabs).
export default function Greeting({ showDate = false }) {
  const { text, emoji } = getGreeting()
  return (
    <div>
      <p className="text-2xl sm:text-3xl font-semibold dark:text-white text-brand-900">
        {text}, Noura! {emoji}
      </p>
      {showDate && (
        <p className="text-sm dark:text-white/50 text-brand-500 mt-0.5">
          Today, {format(new Date(), 'EEE d MMM')}
        </p>
      )}
    </div>
  )
}
