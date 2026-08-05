// Shared sort logic for the small "Sort" dropdown that sits on every
// category-based bar chart (Team/Employee/Client/Tag comparisons) — NOT
// applied to chronological charts (Month/Week/Quarter trends), where
// reordering by value would break the timeline. Tables use their own
// clickable-header sort (see useSortableRows.js) instead of this.
export const SORT_MODES = {
  DESC:  'desc',   // highest to lowest, by the chart's own primary value
  ASC:   'asc',    // lowest to highest
  ALPHA: 'alpha',  // alphabetical by label
}

export const CHART_SORT_OPTIONS = [
  { value: SORT_MODES.DESC,  label: 'Highest to Lowest' },
  { value: SORT_MODES.ASC,   label: 'Lowest to Highest' },
  { value: SORT_MODES.ALPHA, label: 'Alphabetical' },
]

// `valueKey` is the field the chart's own bars are keyed on (e.g. 'utilPct',
// 'hours', 'count'); `labelKey` is the category name field (e.g. 'name',
// 'team', 'tag'). Returns a new array — never mutates the input, since
// several call sites pass an array that's also used elsewhere unsorted.
export function sortChartRows(rows, mode, valueKey, labelKey) {
  const arr = [...rows]
  if (mode === SORT_MODES.ALPHA) {
    arr.sort((a, b) => String(a[labelKey] ?? '').localeCompare(String(b[labelKey] ?? '')))
  } else if (mode === SORT_MODES.ASC) {
    arr.sort((a, b) => (a[valueKey] ?? 0) - (b[valueKey] ?? 0))
  } else {
    arr.sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0))
  }
  return arr
}
