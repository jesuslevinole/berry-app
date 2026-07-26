import { useState, type ReactNode } from 'react';
import './AppLayout.css';

export type ViewKey = 'dashboard' | 'purchases' | 'sales' | 'expenses' | 'catalogs';

export const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: 'Dashboard',
  purchases: 'Purchase Order',
  sales: 'Sales Desk',
  expenses: 'Additional expenses',
  catalogs: 'Catalogs',
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
];

interface AppLayoutProps {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  children: ReactNode;
}

export function AppLayout({ view, onNavigate, children }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
          {NAV_ITEMS.map((item) => (
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
            <span className="topbar__avatar">CM</span>
            <span className="topbar__user-name">C. Maldonado</span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
