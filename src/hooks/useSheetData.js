import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchRawTimeLog,
  fetchCapacity2026,
  fetchCapacity2025,
  fetchTasks,
} from '../api/sheetsApi'

export function useRawTimeLog() {
  return useQuery({ queryKey: ['rawTimeLog'], queryFn: fetchRawTimeLog })
}

export function useCapacity2026() {
  return useQuery({ queryKey: ['capacity2026'], queryFn: fetchCapacity2026 })
}

export function useCapacity2025() {
  return useQuery({ queryKey: ['capacity2025'], queryFn: fetchCapacity2025 })
}

export function useTasks() {
  return useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })
}

export function useRefreshAll() {
  const qc = useQueryClient()
  return () =>
    qc.invalidateQueries({ queryKey: ['rawTimeLog'] })
      .then(() => qc.invalidateQueries({ queryKey: ['capacity2026'] }))
      .then(() => qc.invalidateQueries({ queryKey: ['capacity2025'] }))
      .then(() => qc.invalidateQueries({ queryKey: ['tasks'] }))
}

export function useLastUpdated() {
  const qc = useQueryClient()
  const state = qc.getQueryState(['rawTimeLog'])
  return state?.dataUpdatedAt ? new Date(state.dataUpdatedAt) : null
}
