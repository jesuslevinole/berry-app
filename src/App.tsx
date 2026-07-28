import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout, type ViewKey } from './components/layout/AppLayout';
import { LoginView } from './modules/auth/LoginView';
import { DashboardView } from './modules/dashboard/DashboardView';
import { PurchaseOrdersView } from './modules/purchases/PurchaseOrdersView';
import { SalesDeskView } from './modules/sales/SalesDeskView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { CatalogsView } from './modules/catalogs/CatalogsView';
import { UsersView } from './modules/users/UsersView';
import { RolesView } from './modules/roles/RolesView';
import './App.css';

const VIEW_ORDER: ViewKey[] = ['dashboard', 'purchases', 'sales', 'expenses', 'catalogs', 'users', 'roles'];

function Shell() {
  const { firebaseUser, loading, can, logout } = useAuth();
  const [view, setView] = useState<ViewKey>('dashboard');

  const allowedViews = VIEW_ORDER.filter((key) => can(key, 'view'));

  /* Si el rol no permite la vista actual, saltar a la primera permitida. */
  useEffect(() => {
    if (!loading && firebaseUser && allowedViews.length > 0 && !allowedViews.includes(view)) {
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

  if (!firebaseUser) return <LoginView />;

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
    <AppLayout view={view} onNavigate={setView}>
      <div className="app-view">
        {view === 'dashboard' && <DashboardView onNavigate={setView} />}
        {view === 'purchases' && <PurchaseOrdersView />}
        {view === 'sales' && <SalesDeskView />}
        {view === 'expenses' && <ExpensesView />}
        {view === 'catalogs' && <CatalogsView />}
        {view === 'users' && <UsersView />}
        {view === 'roles' && <RolesView />}
      </div>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
