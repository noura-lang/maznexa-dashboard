import { useState } from 'react'

// Fixed dark-purple brand rail — deliberately NOT theme-aware (no dark:/
// light: variants): the sidebar keeps this identity color regardless of
// the app's Dark/Light mode toggle, per the design spec.
const SIDEBAR_BG = '#1a1330'
const ACTIVE_BG = '#9354ff'

const NAV_ITEMS = [
  { id: 'weekly',        icon: '📊', label: 'Weekly Report' },
  { id: 'billable',      icon: '💰', label: 'Billable vs Non-Billable' },
  { id: 'hours',         icon: '⏱️', label: 'Hours by Client & Project' },
  { id: 'comparison',    icon: '📈', label: 'Utilization Comparison' },
  { id: 'taskDetails',   icon: '✅', label: 'Task Details' },
  { id: 'tags',          icon: '🏷️', label: 'Tags' },
  { id: 'amPerformance', icon: '👥', label: 'Account Managers Performance' },
  { id: 'costAnalysis',  icon: '🧾', label: 'Cost Analysis' },
]
const ADMIN_ITEM = { id: 'adminPanel', icon: '⚙️', label: 'Admin Panel' }

function NavButton({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-colors text-left ${active ? 'text-white shadow-lg shadow-black/30' : 'hover:bg-white/5'}`}
      style={{ backgroundColor: active ? ACTIVE_BG : 'transparent', color: active ? '#ffffff' : '#b3a3d9' }}
    >
      <span className="text-base flex-shrink-0 leading-none">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </button>
  )
}

function Logo() {
  return (
    <img
      src="/logo.png"
      alt="Maznexa"
      className="h-7 w-auto object-contain flex-shrink-0"
      onError={e => { e.target.style.display = 'none' }}
    />
  )
}

// Main vertical navigation — a persistent left rail on desktop (>=768px),
// collapsing to a hamburger-triggered overlay drawer below that, per the
// nav-layout redesign spec. Rendered once in App.jsx; the mobile trigger
// bar, the mobile overlay drawer, and the desktop rail are three siblings
// returned from one component (not nested) so each can independently show/
// hide per breakpoint via hidden/md: classes without wrapper divs
// interfering with the outer flex layout.
export default function Sidebar({ activeTab, setActiveTab, visibleTabIds }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const items = NAV_ITEMS.filter(item => visibleTabIds?.includes(item.id))
  const showAdmin = visibleTabIds?.includes(ADMIN_ITEM.id)

  function selectTab(id) {
    setActiveTab(id)
    setMobileOpen(false)
  }

  function NavList() {
    return (
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {items.map(item => (
          <NavButton key={item.id} item={item} active={activeTab === item.id} onClick={() => selectTab(item.id)} />
        ))}
        {showAdmin && (
          <>
            <div className="my-3 border-t border-white/10" />
            <NavButton item={ADMIN_ITEM} active={activeTab === ADMIN_ITEM.id} onClick={() => selectTab(ADMIN_ITEM.id)} />
          </>
        )}
      </nav>
    )
  }

  return (
    <>
      {/* Mobile trigger bar — the only piece of the sidebar visible below
          md; opens the overlay drawer below. */}
      <div
        className="md:hidden flex items-center gap-3 h-14 px-4 sticky top-0 z-40 border-b border-white/10"
        style={{ backgroundColor: SIDEBAR_BG }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Logo />
      </div>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[240px] max-w-[80vw] h-full flex flex-col" style={{ backgroundColor: SIDEBAR_BG }}>
            <div className="flex items-center justify-between h-14 px-4 flex-shrink-0">
              <Logo />
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NavList />
          </aside>
        </div>
      )}

      {/* Desktop persistent rail — always visible at md and up, sticky so
          it stays put while the content column scrolls. */}
      <aside
        className="hidden md:flex md:flex-col md:w-[230px] md:flex-shrink-0 md:h-screen md:sticky md:top-0 md:self-start"
        style={{ backgroundColor: SIDEBAR_BG }}
      >
        <div className="flex items-center h-14 px-5 flex-shrink-0">
          <Logo />
        </div>
        <NavList />
      </aside>
    </>
  )
}
