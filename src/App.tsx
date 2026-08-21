import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { AppLayout, type ViewKey } from './components/layout/AppLayout';
import { LoginView } from './modules/auth/LoginView';
import { DashboardView } from './modules/dashboard/DashboardView';
import { PurchaseOrdersView } from './modules/purchases/PurchaseOrdersView';
import { SalesDeskView } from './modules/sales/SalesDeskView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { CatalogsView } from './modules/catalogs/CatalogsView';
import { LotActivityView } from './modules/lots/LotActivityView';
import { InventoryView } from './modules/inventory/InventoryView';
import { ReportsView } from './modules/reports/ReportsView';
import { ChecksView } from './modules/checks/ChecksView';
import { CompanyView } from './modules/company/CompanyView';
import { UsersView } from './modules/users/UsersView';
import { RolesView } from './modules/roles/RolesView';
import { ConfigView } from './modules/config/ConfigView';
import './App.css';

const VIEW_ORDER: ViewKey[] = ['dashboard', 'purchases', 'sales', 'expenses', 'catalogs', 'lots', 'inventory', 'reports', 'checks', 'company', 'users', 'roles', 'config'];

function Shell() {
  const { firebaseUser, bypass, loading, can, logout } = useAuth();
  const [view, setView] = useState<ViewKey>('dashboard');
  /** Sub-vista activa (pestana de Reports elegida desde el menu lateral). */
  const [subview, setSubview] = useState<string | null>(null);

  /** Orden a abrir en detalle al navegar desde Inventory (venta o compra). */
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);

  const handleNavigate = (key: ViewKey, sub?: string) => {
    setView(key);
    setSubview(sub ?? null);
    setFocusOrderId(null);
  };

  /** Desde Inventory: abre el documento origen en su modulo con el detalle desplegado. */
  const handleOpenDocument = (kind: 'in' | 'out', orderId: string) => {
    setSubview(null);
    setFocusOrderId(orderId);
    setView(kind === 'in' ? 'purchases' : 'sales');
  };

  const allowedViews = VIEW_ORDER.filter((key) => can(key, 'view'));

  /* Si el rol no permite la vista actual, saltar a la primera permitida. */
  useEffect(() => {
    if (!loading && (firebaseUser || bypass) && allowedViews.length > 0 && !allowedViews.includes(view)) {
      setView(allowedViews[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, firebaseUser, allowedViews.join(','), view]);

  if (loading) {
    return (
      <div className="app-gate">
        <span className="app-gate__spinner" aria-hidden="true" />
        <p className="app-gate__text">Verifying session…</p>
      </div>
    );
  }

  if (!firebaseUser && !bypass) return <LoginView />;

  if (allowedViews.length === 0) {
    return (
      <div className="app-gate">
        <h2 className="app-gate__title">No access</h2>
        <p className="app-gate__text">
          Your account does not have access to any module yet. Ask an administrator to assign you a role.
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => void logout()}>Sign out</button>
      </div>
    );
  }

  return (
    <AppLayout view={view} subview={subview} onNavigate={handleNavigate}>
      <div className="app-view">
        {view === 'dashboard' && <DashboardView onNavigate={setView} />}
        {view === 'purchases' && <PurchaseOrdersView initialOpenId={focusOrderId} />}
        {view === 'sales' && <SalesDeskView initialOpenId={focusOrderId} />}
        {view === 'expenses' && <ExpensesView />}
        {view === 'catalogs' && <CatalogsView />}
        {view === 'lots' && <LotActivityView />}
        {view === 'inventory' && <InventoryView onOpenDocument={handleOpenDocument} />}
        {view === 'reports' && <ReportsView key={subview ?? 'default'} initialReport={subview} />}
        {view === 'checks' && <ChecksView />}
        {view === 'company' && <CompanyView />}
        {view === 'users' && <UsersView />}
        {view === 'roles' && <RolesView />}
        {view === 'config' && <ConfigView />}
      </div>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppConfigProvider>
        <Shell />
      </AppConfigProvider>
    </AuthProvider>
  );
}
