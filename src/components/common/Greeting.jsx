import { format } from 'date-fns'
import { useAuth } from '../../context/AuthContext'

// Time-of-day greeting shown at the top of every tab, above the KPI cards.
// The time-of-day part is purely derived from the device clock at render
// time; the name comes from `useAuth()`'s `employee` (the same Employees-
// tab lookup by signed-in email every other part of the app already uses
// for identity — see AuthContext.jsx), so it always reflects whoever is
// actually signed in, not whichever name it was first written for.
function getGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return { text: 'Good Morning', emoji: '👋' }
  if (hour >= 12 && hour < 18) return { text: 'Good Afternoon', emoji: '☀️' }
  return { text: 'Good Evening', emoji: '🌙' }
}

// `showDate` is opt-in (Weekly Report only, for now — a trial run per Noura
// before it potentially rolls out to the other three tabs).
export default function Greeting({ showDate = false }) {
  const { employee } = useAuth()
  const { text, emoji } = getGreeting()
  return (
    <div>
      <p className="text-2xl sm:text-3xl font-semibold dark:text-white text-brand-900">
        {text}{employee?.name ? `, ${employee.name}` : ''}! {emoji}
      </p>
      {showDate && (
        <p className="text-sm dark:text-white/50 text-brand-500 mt-0.5">
          Today, {format(new Date(), 'EEE d MMM')}
        </p>
      )}
    </div>
  )
}
