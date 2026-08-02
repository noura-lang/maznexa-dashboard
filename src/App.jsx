import { useEffect, useState } from 'react'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import FilterBar from './components/layout/FilterBar'
import Greeting from './components/common/Greeting'
import AuthGate from './components/auth/AuthGate'
import { useAuth } from './context/AuthContext'
import { DEFAULT_DENIED_PERMISSIONS } from './api/accessSheetApi'
import WeeklyReport from './pages/WeeklyReport'
import BillableTab from './pages/BillableTab'
import HoursTab from './pages/HoursTab'
import ComparisonTab from './pages/ComparisonTab'
import TaskDetailsTab from './pages/TaskDetailsTab'
import TagsTab from './pages/TagsTab'
import AmPerformanceTab from './pages/AmPerformanceTab'
import CostAnalysisTab from './pages/CostAnalysisTab'
import AdminPanelTab from './pages/AdminPanelTab'

const PAGES = {
  weekly:       WeeklyReport,
  billable:     BillableTab,
  hours:        HoursTab,
  comparison:   ComparisonTab,
  taskDetails:  TaskDetailsTab,
  tags:         TagsTab,
  amPerformance: AmPerformanceTab,
  costAnalysis: CostAnalysisTab,
  adminPanel:   AdminPanelTab,
}

// Nav tab id -> the Permissions-sheet flag that gates it. Kept here (not in
// Header) so App can also use it to make sure `activeTab` never lands on a
// tab the current user isn't allowed to see.
export const TAB_PERMISSION_KEYS = {
  weekly:       'weeklyReport',
  billable:     'billableView',
  hours:        'hoursReport',
  comparison:   'utilization',
  taskDetails:  'taskDetails',
  tags:         'tags',
  amPerformance: 'amPerformance',
  costAnalysis: 'costAnalysis',
}

function DashboardShell() {
  const { permissions: rawPermissions } = useAuth()
  const permissions = rawPermissions || DEFAULT_DENIED_PERMISSIONS
  const [activeTab, setActiveTab] = useState(null)

  const visibleTabIds = Object.keys(TAB_PERMISSION_KEYS)
    .filter(id => permissions[TAB_PERMISSION_KEYS[id]])
    .concat(permissions.admin ? ['adminPanel'] : [])

  // Land on the first tab this user actually has access to (and follow it
  // if permissions change under them, e.g. an admin edits their access
  // live) rather than assuming 'weekly' is always visible.
  useEffect(() => {
    if (!visibleTabIds.includes(activeTab)) {
      setActiveTab(visibleTabIds[0] ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabIds.join(',')])

  const Page = activeTab ? PAGES[activeTab] : null

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Navigation lives entirely in the Sidebar now (persistent rail on
          desktop, hamburger-triggered overlay below md) — this replaces the
          old horizontal tab bar. Only the filter bar sticks to the top of
          the content column on scroll — TopBar (Refresh/Dark mode/Sign Out;
          export is per-chart/per-table now, see ExportMenu.jsx) and Weekly
          Report's greeting bar are normal, non-sticky flow content that
          scrolls away like the rest of the page. FilterBar carries its own
          `sticky top-0` (see FilterBar.jsx); Comparison's own filter row
          (not rendered here — ComparisonTab has its own inline filter bar)
          is sticky the same way. */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} visibleTabIds={visibleTabIds} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        {activeTab === 'weekly' && (
          <div className="dark:bg-brand-950/80 bg-white/70 backdrop-blur-md border-b dark:border-white/10 border-brand-200">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3">
              <Greeting showDate />
            </div>
          </div>
        )}
        {activeTab && !['comparison', 'adminPanel', 'amPerformance', 'costAnalysis'].includes(activeTab) && <FilterBar />}
        <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-12 w-full">
          {Page ? (
            <Page />
          ) : (
            <p className="text-sm text-center py-24 dark:text-white/50 text-brand-500">
              No dashboard sections are enabled for your account yet — contact your administrator.
            </p>
          )}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <DashboardShell />
    </AuthGate>
  )
}
