import { useMemo } from 'react'
import { useTasks } from './useSheetData'
import { getBizDevLeadTasks } from '../api/bizDevData'

// Wraps the existing useTasks() (same "Raw Tasks" sheet every other tab
// reads) and narrows it down to the Business Development Lead universe —
// see bizDevData.js for what qualifies as a Lead.
export function useBizDevTasks() {
  const { data: rawTasks = [], isLoading, error } = useTasks()
  const data = useMemo(() => getBizDevLeadTasks(rawTasks), [rawTasks])
  return { data, isLoading, error }
}
