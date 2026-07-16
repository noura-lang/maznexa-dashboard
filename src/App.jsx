import { useState } from 'react'
import Header from './components/layout/Header'
import FilterBar from './components/layout/FilterBar'
import WeeklyReport from './pages/WeeklyReport'
import BillableTab from './pages/BillableTab'
import HoursTab from './pages/HoursTab'
import ComparisonTab from './pages/ComparisonTab'

const PAGES = {
  weekly:     WeeklyReport,
  billable:   BillableTab,
  hours:      HoursTab,
  comparison: ComparisonTab,
}

export default function App() {
  const [activeTab, setActiveTab] = useState('weekly')
  const Page = PAGES[activeTab]

  return (
    <div className="min-h-screen">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      {activeTab !== 'comparison' && <FilterBar />}
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-12">
        <Page />
      </main>
    </div>
  )
}
