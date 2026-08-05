import Dropdown from './Dropdown'
import { CHART_SORT_OPTIONS } from '../../utils/chartSort'

// Small "Sort" dropdown for a category-based bar chart (Team/Employee/
// Client/Tag) — sits in the chart card's headerExtra slot, next to the
// Maximize/Export icons. Not used on chronological charts (Month/Week/
// Quarter trends), where reordering by value would break the timeline.
export default function ChartSortMenu({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs dark:text-white/40 text-brand-400">Sort:</span>
      <Dropdown options={CHART_SORT_OPTIONS} value={value} onChange={onChange} buttonClassName="text-xs py-1.5" />
    </div>
  )
}
