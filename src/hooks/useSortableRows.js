import { useMemo, useState } from 'react'

// Reusable clickable-column-header table sort — first click on a header
// sorts descending by that column, second click reverses to ascending, an
// arrow (▼/▲) next to the label shows the current direction. Mirrors the
// pattern Task Details tab's "Task Summary by Employee" table already used,
// extracted here so every other sortable table in the app shares the exact
// same behavior instead of reimplementing it. Sorts on top of whatever rows
// are already filtered — never re-derives or loosens filtering itself.
export function useSortableRows(rows, initialKey, initialDir = 'desc') {
  const [sortKey, setSortKey] = useState(initialKey)
  const [sortDir, setSortDir] = useState(initialDir)

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av ?? 0) - (bv ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [rows, sortKey, sortDir])

  function sortArrow(key) {
    return sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''
  }

  return { sorted, sortKey, sortDir, handleSort, sortArrow }
}
