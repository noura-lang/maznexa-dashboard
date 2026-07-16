import { createContext, useContext, useState } from 'react'
import { subDays, format } from 'date-fns'

const FilterContext = createContext()

const today = new Date()

export function FilterProvider({ children }) {
  const [startDate, setStartDate]               = useState(format(subDays(today, 7), 'yyyy-MM-dd'))
  const [endDate, setEndDate]                   = useState(format(today, 'yyyy-MM-dd'))
  const [selectedTeams, setSelectedTeams]       = useState([])
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [selectedClients, setSelectedClients]   = useState([])

  return (
    <FilterContext.Provider
      value={{
        startDate, setStartDate,
        endDate,   setEndDate,
        selectedTeams,     setSelectedTeams,
        selectedEmployees, setSelectedEmployees,
        selectedClients,   setSelectedClients,
      }}
    >
      {children}
    </FilterContext.Provider>
  )
}

export const useFilters = () => useContext(FilterContext)
