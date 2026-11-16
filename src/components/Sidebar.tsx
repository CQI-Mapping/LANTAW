// Sidebar — premium 2026 shell (design/premium/theme.css): a fixed left rail
// carrying the brand block, grouped navigation, and the user chip with its
// profile menu. The topbar (breadcrumb + academic-year pill + avatar) is
// rendered by App.tsx's main shell; this component owns only the aside.
// On small screens the rail becomes a drawer behind a scrim, driven by the
// hamburger in the topbar.

import { useState, useRef, useEffect, useCallback } from 'react'
import '../styles/Sidebar.css'
import { philippineNow } from '../utils/clock'
import type { NavItem, UserRole } from '../services/database'

interface SidebarProps {
  navItems: NavItem[]
  activePage: string
  onNavigate: (page: string) => void
  onLogout: () => void
  role: UserRole
  isOpen: boolean
  onToggle: () => void
  /** Collapsed: the whole rail slides away (ChatGPT-style). The topbar
      toggle brings it back. */
  mini?: boolean
  onToggleMini?: () => void
  /** The theme as it resolves right now (system resolved against the OS
      preference) — drives the Appearance menu item's sun/moon icon. */
  railDark?: boolean
  /** Where the navigation lives — the rail renders the top-bar variant
      when the Appearance page moved it. Read-only: the page owns the pick. */
  navLayout?: 'left' | 'top'
  profileName?: string | null
  profileEmail?: string | null
  profileAvatar?: string | null
}

/** The brand mark for program-scoped roles rides the real logo file
 *  (BSIT is the program for now — accounts carry profiles.program_id,
 *  but the UI doesn't read per-account programs yet, so the same logo
 *  stands in for every program). Admins are not bounded to a program,
 *  so their brand keeps the neutral monogram. */
const PROGRAM_LOGO = '/LOGO.png'

// ---- Icons ----

function Icon({ d, ...props }: { d: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      {d.split('|').map((seg, i) => {
        const [cmd, ...pts] = seg.split(' ')
        if (cmd === 'rect') return <rect key={i} x={pts[0]} y={pts[1]} width={pts[2]} height={pts[3]} rx={pts[4] || '0'} />
        if (cmd === 'circle') return <circle key={i} cx={pts[0]} cy={pts[1]} r={pts[2]} />
        if (cmd === 'path') return <path key={i} d={pts.join(' ')} />
        if (cmd === 'line') return <line key={i} x1={pts[0]} y1={pts[1]} x2={pts[2]} y2={pts[3]} />
        if (cmd === 'polyline') return <polyline key={i} points={pts.join(' ')} />
        return null
      })}
    </svg>
  )
}

const ICONS: Record<string, string> = {
  dashboard: 'rect 3 3 7 9 1.5|rect 14 3 7 5 1.5|rect 14 12 7 9 1.5|rect 3 16 7 5 1.5',
  users: 'path M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|circle 9 7 4|path M23 21v-2a4 4 0 0 0-3-3.87|path M16 3.13a4 4 0 0 1 0 7.75',
  curriculum: 'path M4 19.5A2.5 2.5 0 0 1 6.5 17H20|path M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  program: 'path M22 10L12 5 2 10l10 5 10-5z|path M6 12v5c3 3 9 3 12 0v-5|line 22 10 22 16',
  course: 'path M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  'faculty-assign': 'path M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|circle 8.5 7 4|line 20 8 20 14|line 23 11 17 11',
  clo: 'rect 3 3 18 18 2|path M3 9h18|path M3 15h18|path M9 3v18|path M15 3v18',
  'clo-po': 'rect 3 3 18 18 2|path M3 9h18|path M3 15h18|path M9 3v18|path M15 3v18',
  'ched-memo': 'path M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|polyline 14 2 14 8 20 8|line 16 13 8 13|line 16 17 8 17',
  'strategic-goals': 'path M3 3v18h18|rect 7 12 3 6 1|rect 12 7 3 11 1|rect 17 10 3 8 1',
  peos: 'circle 12 8 6|path M15.5 13l1.5 8-5-3-5 3 1.5-8',
  'program-outcomes': 'path M3 3v18h18|path M7 16l3-3 3 3 5-8',
  'subject-view': 'circle 18 5 3|circle 6 12 3|circle 18 19 3|line 8.6 10.5 15.4 6.5|line 8.6 13.5 15.4 17.5',
  grasps: 'circle 12 12 9|circle 12 12 5|circle 12 12 1.5',
  tos: 'rect 4 3 16 18 1.5|path M8 8h8|M8 12h8|M8 16h5',
  analytics: 'path M3 3v18h18|rect 7 12 3 6 1|rect 12 7 3 11 1|rect 17 10 3 8 1',
  'activity-logs': 'path M3 12a9 9 0 1 0 3-6.7L3 8|path M3 3v5h5|path M12 7v5l4 2',
  profile: 'circle 12 8 4|path M4 21c0-4.418 3.582-7 8-7s8 2.582 8 7',
  security: 'path M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  sun: 'circle 12 12 4.5|line 12 2 12 4.5|line 12 19.5 12 22|line 2 12 4.5 12|line 19.5 12 22 12|line 4.6 4.6 6.4 6.4|line 17.6 17.6 19.4 19.4|line 2 19.4 4.4 19.4|line 19.6 19.4 22 19.4|line 2 4.6 4.4 4.6|line 19.6 4.6 22 4.6|line 17.6 6.4 19.4 4.6',
  moon: 'path M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
}

const LOGOUT_ICON = 'path M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|polyline 16 17 21 12 16 7|line 21 12 9 12'

function initialsOf(name: string | null | undefined, fallback: string): string {
  const src = (name ?? '').trim() || fallback
  return src.split(/[\s-]+/).map((w) => w[0] ?? '').filter(Boolean).slice(0, 2).join('').toUpperCase() || 'U'
}

// Academic pages group under the "Academics" label; everything else that is
// neither the dashboard nor part of the profile menu lands in
// "Administration". The dashboard opens its own "Overview" group, matching
// the prototype's labeled sections.
const ACADEMICS_IDS = new Set([
  'program', 'ched-memo', 'strategic-goals', 'peos',
  'program-outcomes', 'curriculum', 'course', 'faculty-assign', 'clo', 'subject-view', 'grasps', 'tos',
  'view',
])

// The one-line descriptions under each academic item in the top bar's
// Academics dropdown — the old mega menu's copy, kept.
const ACADEMICS_META: Record<string, { desc: string }> = {
  program: { desc: 'Degree programs & offerings' },
  'ched-memo': { desc: 'CHED memorandums & policies' },
  'strategic-goals': { desc: 'Institutional alignment' },
  peos: { desc: 'Graduate attributes & PEOs' },
  'program-outcomes': { desc: 'Program outcomes mapping' },
  curriculum: { desc: 'Curriculum structure & maps' },
  course: { desc: 'Course catalog & details' },
  'faculty-assign': { desc: 'Assign faculty to subjects' },
  clo: { desc: 'Course learning outcomes' },
  'subject-view': { desc: 'Start Visualizing' },
  grasps: { desc: 'Performance task design' },
  tos: { desc: 'Exam blueprint & Bloom coverage' },
  view: { desc: 'Syllabus & mapping reports' },
}

// The small role line under the name in the user chip, worded like the
// prototype's chip (Admin → System Administrator, …).
const ROLE_TITLE: Record<UserRole, string> = {
  admin: 'System Administrator',
  manager: 'Program Manager',
  user: 'Faculty Member',
}

/** The profile popover, shared by the left rail's user chip and the top
 *  bar's avatar: identity head, My Profile / Security & Privacy /
 *  Appearance, and Logout. The heavy look-and-feel settings live on the
 *  Appearance page; the menu just opens it. */
function ProfileMenu(props: {
  displayName: string
  displayEmail: string
  avatarInitials: string
  profileAvatar?: string | null
  activePage: string
  onNavigate: (id: string) => void
  onLogout: () => void
  railDark: boolean
}) {
  return (
    <div className="profile-menu" role="menu">
      <div className="profile-menu__head">
        <span className="avatar avatar--lg">
          {props.profileAvatar ? <img src={props.profileAvatar} alt="" className="avatar-img" /> : props.avatarInitials}
        </span>
        <span className="profile-menu__id">
          <b>{props.displayName}</b>
          <small>{props.displayEmail}</small>
        </span>
      </div>
      <div className="profile-menu__list" role="none">
        <button type="button" role="menuitem"
          className={`profile-menu__item ${props.activePage === 'profile' ? 'active' : ''}`}
          onClick={() => props.onNavigate('profile')}>
          <Icon d={ICONS.profile} className="profile-menu__ico" />
          <span>My Profile</span>
        </button>
        <button type="button" role="menuitem"
          className={`profile-menu__item ${props.activePage === 'security' ? 'active' : ''}`}
          onClick={() => props.onNavigate('security')}>
          <Icon d={ICONS.security} className="profile-menu__ico" />
          <span>Security &amp; Privacy</span>
        </button>
        <button type="button" role="menuitem"
          className={`profile-menu__item ${props.activePage === 'appearance' ? 'active' : ''}`}
          onClick={() => props.onNavigate('appearance')}>
          <Icon d={props.railDark ? ICONS.moon : ICONS.sun} className="profile-menu__ico" />
          <span>Appearance</span>
        </button>
        <div className="profile-menu__sep" role="separator" />
        <button type="button" role="menuitem" className="profile-menu__item profile-menu__item--danger" onClick={props.onLogout}>
          <Icon d={LOGOUT_ICON} className="profile-menu__ico" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  )
}

function Sidebar({ navItems, activePage, onNavigate, onLogout, role, isOpen, onToggle, mini = false, onToggleMini, railDark = false, navLayout = 'left', profileName, profileEmail, profileAvatar }: SidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Grouped navigation: dashboard under Overview, the academic pages under
  // Academics, the rest under Administration.
  const dashboardItem = navItems.find((n) => n.id === 'dashboard')
  const inProfileMenu = (n: { id: string }) =>
    n.id === 'profile' || n.id === 'security' || n.id === 'appearance'
  const academics = navItems.filter((n) => ACADEMICS_IDS.has(n.id))
  const others = navItems.filter((n) => n.id !== 'dashboard' && !ACADEMICS_IDS.has(n.id) && !inProfileMenu(n))

  // The Academics group is a collapsible section. It starts open when the
  // signed-in page already lives there, and auto-opens whenever navigation
  // lands on an academic page — a highlighted row must never hide behind a
  // collapsed group.
  const [academicsOpen, setAcademicsOpen] = useState(() =>
    ACADEMICS_IDS.has(activePage),
  )
  useEffect(() => {
    if (ACADEMICS_IDS.has(activePage)) setAcademicsOpen(true)
  }, [activePage])

  // In the top-bar layout the Academics pill opens a dropdown; it closes on
  // any outside press or Escape, and navigating closes everything.
  const [topAcademicsOpen, setTopAcademicsOpen] = useState(false)
  const topAcademicsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!topAcademicsOpen) return
    const onDown = (e: MouseEvent) => {
      if (topAcademicsRef.current && !topAcademicsRef.current.contains(e.target as Node)) setTopAcademicsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTopAcademicsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [topAcademicsOpen])

  const displayName = (profileName ?? '').trim() || `${role.charAt(0).toUpperCase() + role.slice(1)} User`
  const displayEmail = (profileEmail ?? '').trim() || `Signed in as ${role}`
  const avatarInitials = initialsOf(profileName, role)

  // The profile menu closes on any outside press or Escape — the chip is the
  // only trigger, so the listener only lives while the menu is open.
  useEffect(() => {
    if (!profileOpen) return
    const onDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileOpen])

  // Navigating closes the menu, and on drawer-sized screens the rail itself.
  const navigate = useCallback((id: string) => {
    onNavigate(id)
    setProfileOpen(false)
    setTopAcademicsOpen(false)
    if (window.innerWidth <= 960 && isOpen) onToggle()
  }, [onNavigate, isOpen, onToggle])

  // Page changes close the menu (an open menu across a page swap reads wrong),
  // and collapsing the rail away can never leave a menu dangling unseen.
  useEffect(() => {
    setProfileOpen(false)
  }, [activePage])
  useEffect(() => {
    if (mini) setProfileOpen(false)
  }, [mini])

  const renderItem = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className={`nav-item ${activePage === item.id ? 'active' : ''}`}
      onClick={() => navigate(item.id)}
      aria-current={activePage === item.id ? 'page' : undefined}
      title={item.label}
      aria-label={item.label}
    >
      <span className="nav-ico"><Icon d={ICONS[item.id] || ICONS.dashboard} className="nav-svg" /></span>
      <span className="nav-text">{item.label}</span>
    </button>
  )

  // When the rail is collapsed away, the whole aside is off-screen — an open
  // profile menu must never survive that state change.
  useEffect(() => {
    if (mini) setProfileOpen(false)
  }, [mini])

  const profileMenuEl = profileOpen ? (
    <ProfileMenu
      displayName={displayName}
      displayEmail={displayEmail}
      avatarInitials={avatarInitials}
      profileAvatar={profileAvatar}
      activePage={activePage}
      onNavigate={navigate}
      onLogout={onLogout}
      railDark={railDark}
    />
  ) : null

  // Top-bar layout: the whole navigation sits in a sticky horizontal bar —
  // just the logo mark, pill nav, date pill and avatar menu right. No
  // wordmark: the logo carries the identity alone.
  if (navLayout === 'top') {
    const todayLabel = philippineNow(new Date()).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    return (
      <header className="topnav">
        <div className="brand">
          {role === 'admin' ? (
            <span className="brand-mark" aria-hidden="true">C</span>
          ) : (
            <img className="brand-mark-img" src={PROGRAM_LOGO} alt="LANTAW" />
          )}
        </div>
        <nav className="topnav__nav" aria-label="Main navigation">
          {dashboardItem && (
            <button key={dashboardItem.id} type="button"
              className={`topnav__item ${activePage === dashboardItem.id ? 'active' : ''}`}
              onClick={() => navigate(dashboardItem.id)}
              aria-current={activePage === dashboardItem.id ? 'page' : undefined}
              title={dashboardItem.label}>
              <Icon d={ICONS[dashboardItem.id] || ICONS.dashboard} className="topnav__ico" />
              <span>{dashboardItem.label}</span>
            </button>
          )}
          {academics.length > 0 && (role !== 'user' ? (
            <div className="topnav__dd" ref={topAcademicsRef}>
              <button type="button"
                className={`topnav__item ${topAcademicsOpen ? 'open' : ''}`}
                onClick={() => setTopAcademicsOpen((v) => !v)}
                aria-expanded={topAcademicsOpen}
                aria-haspopup="menu">
                <Icon d={ICONS.curriculum} className="topnav__ico" />
                <span>Academics</span>
                <svg className={`topnav__chevron ${topAcademicsOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {topAcademicsOpen && (
                <div className="topnav__dd-menu" role="menu">
                  {academics.map((item) => (
                    <button key={item.id} type="button" role="menuitem"
                      className={`topnav__dd-item ${activePage === item.id ? 'active' : ''}`}
                      onClick={() => navigate(item.id)}>
                      <span className="topnav__dd-ico"><Icon d={ICONS[item.id] || ICONS.dashboard} className="topnav__dd-svg" /></span>
                      <span className="topnav__dd-text">
                        <span className="topnav__dd-label">{item.label}</span>
                        <span className="topnav__dd-desc">{ACADEMICS_META[item.id]?.desc ?? ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* The faculty bar carries only four academic pages — flat pills
               read faster than a dropdown. */
            academics.map((item) => (
              <button key={item.id} type="button"
                className={`topnav__item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={activePage === item.id ? 'page' : undefined}
                title={item.label}>
                <Icon d={ICONS[item.id] || ICONS.dashboard} className="topnav__ico" />
                <span>{item.label}</span>
              </button>
            ))
          ))}
          {others.map((item) => (
            <button key={item.id} type="button"
              className={`topnav__item ${activePage === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-current={activePage === item.id ? 'page' : undefined}
              title={item.label}>
              <Icon d={ICONS[item.id] || ICONS.dashboard} className="topnav__ico" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="topnav__right">
          <span className="date-pill" title="Today">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {todayLabel}
          </span>
          <div className="user-mini user-mini--topnav" ref={profileRef}>
            <button type="button" className="topnav__avatar" onClick={() => setProfileOpen((v) => !v)}
              aria-expanded={profileOpen} aria-haspopup="menu" aria-label="Profile menu">
              <span className="avatar">
                {profileAvatar ? <img src={profileAvatar} alt="" className="avatar-img" /> : avatarInitials}
              </span>
            </button>
            {profileMenuEl}
          </div>
        </div>
      </header>
    )
  }

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="brand">
          {role === 'admin' ? (
            <span className="brand-mark" aria-hidden="true">C</span>
          ) : (
            <img className="brand-mark-img" src={PROGRAM_LOGO} alt="" />
          )}
          <div className="brand-text">
            <b>LANTAW</b>
            <small>CQI MONITORING SYSTEM</small>
          </div>
          {/* ChatGPT-style: the collapse toggle lives in the rail's own header
              row. The topbar keeps a twin for the collapsed state, where this
              rail is off-screen. */}
          <button
            type="button"
            className="brand-collapse"
            onClick={onToggleMini}
            aria-label="Minimize sidebar"
            title="Minimize sidebar"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {dashboardItem && (
            <>
              <div className="nav-label">Overview</div>
              {renderItem(dashboardItem)}
            </>
          )}
          {academics.length > 0 && (role !== 'user' ? (
            <>
              <button
                type="button"
                className="nav-group-toggle"
                onClick={() => setAcademicsOpen((v) => !v)}
                aria-expanded={academicsOpen}
                aria-controls="nav-group-academics"
              >
                <span>Academics</span>
                <svg className={`nav-chevron ${academicsOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
              {/* Always mounted: the group collapses by height, so the
                  accordion stays smooth. */}
              <div id="nav-group-academics" className={`nav-group ${academicsOpen ? 'nav-group--open' : ''}`}>
                {academics.map(renderItem)}
              </div>
            </>
          ) : (
            <>
              {/* The faculty rail carries only four academic pages — a flat
                  group reads faster than a disclosure. */}
              <div className="nav-label">Academics</div>
              {academics.map(renderItem)}
            </>
          ))}
          {others.length > 0 && (
            <>
              <div className="nav-label">Administration</div>
              {others.map(renderItem)}
            </>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-mini" ref={profileRef}>
            <button
              type="button"
              className={`user-mini__btn ${profileOpen ? 'open' : ''}`}
              onClick={() => setProfileOpen((v) => !v)}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
            >
              <span className="avatar">
                {profileAvatar ? <img src={profileAvatar} alt="" className="avatar-img" /> : avatarInitials}
              </span>
              <span className="user-mini__text">
                <b>{displayName}</b>
                <small>{ROLE_TITLE[role]}</small>
              </span>
              <span className="more-btn" aria-hidden="true">···</span>
            </button>
            {profileMenuEl}
          </div>
        </div>
      </aside>
      {isOpen && <button type="button" className="sidebar-scrim" onClick={onToggle} aria-label="Close menu" />}
    </>
  )
}

export default Sidebar
