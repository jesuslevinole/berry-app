import { useState, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import './AppLayout.css';

export type ViewKey = 'dashboard' | 'purchases' | 'sales' | 'expenses' | 'catalogs' | 'users' | 'roles';

export const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  purchases: 'Purchase Order',
  sales: 'Sales Desk',
  expenses: 'Additional expenses',
  catalogs: 'Catalogs',
  users: 'System Users',
  roles: 'Roles & Permissions',
};

const NAV_ITEMS: Array<{ key: ViewKey; label: string; icon: ReactNode }> = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'purchases',
    label: 'Purchase Orders',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4M12 11v10" />
      </svg>
    ),
  },
  {
    key: 'sales',
    label: 'Sales Desk',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 12l-8 8-9-9V4h7l10 8z" /><circle cx="7.5" cy="7.5" r="1.4" />
      </svg>
    ),
  },
  {
    key: 'expenses',
    label: 'Expenses',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6" />
      </svg>
    ),
  },
  {
    key: 'catalogs',
    label: 'Catalogs',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
      </svg>
    ),
  },
  {
    key: 'users',
    label: 'System Users',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5" />
        <circle cx="17" cy="9" r="2.4" /><path d="M15.5 14.6c2.4.2 4.4 1.6 5 5" />
      </svg>
    ),
  },
  {
    key: 'roles',
    label: 'Roles',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

interface AppLayoutProps {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  children: ReactNode;
}

export function AppLayout({ view, onNavigate, children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { can, profile, firebaseUser, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => can(item.key, 'view'));

  const displayName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.email
    : firebaseUser?.email ?? '';
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'U';

  const handleNavigate = (key: ViewKey) => {
    onNavigate(key);
    setMobileOpen(false);
  };

  return (
    <div className={`layout${collapsed ? ' layout--collapsed' : ''}`}>
      <aside className={`sidebar${mobileOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">B</span>
          <span className="sidebar__brand-text">
            <strong>Berry Source</strong>
            <small>Operations</small>
          </span>
        </div>

        <nav className="sidebar__nav" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`sidebar__link${view === item.key ? ' sidebar__link--active' : ''}`}
              onClick={() => handleNavigate(item.key)}
              title={item.label}
            >
              <span className="sidebar__icon">{item.icon}</span>
              <span className="sidebar__label">{item.label}</span>
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar__collapse"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          <span className="sidebar__label">Collapse</span>
        </button>
      </aside>

      {mobileOpen && <div className="layout__overlay" onClick={() => setMobileOpen(false)} />}

      <div className="layout__main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--icon topbar__hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="topbar__title">{VIEW_TITLES[view]}</h1>
          <div className="topbar__user">
            <span className="topbar__avatar">{initials}</span>
            <span className="topbar__user-name">{displayName}</span>
            <button
              type="button"
              className="btn btn--icon topbar__logout"
              onClick={() => void logout()}
              title="Sign out"
              aria-label="Sign out"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
