import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppConfigProvider } from './context/AppConfigContext';
import { AppLayout, type ViewKey } from './components/layout/AppLayout';
import { PublicSite } from './modules/landing/PublicSite';
import { DashboardView } from './modules/dashboard/DashboardView';
import { PurchaseOrdersView } from './modules/purchases/PurchaseOrdersView';
import { SalesDeskView } from './modules/sales/SalesDeskView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { CatalogsView } from './modules/catalogs/CatalogsView';
import { LotActivityView } from './modules/lots/LotActivityView';
import { InventoryView } from './modules/inventory/InventoryView';
import { ActivityLogView } from './modules/activity/ActivityLogView';
import { TrashView } from './modules/trash/TrashView';
import { PlatformConsole } from './modules/platform/PlatformConsole';
import { accessEndsOf, billingInfoOf } from './services/billingService';
import { fmtDate } from './utils/format';
import { ReportsView } from './modules/reports/ReportsView';
import { ChecksView } from './modules/checks/ChecksView';
import { CompanyView } from './modules/company/CompanyView';
import { EmailSettingsView } from './modules/emails/EmailSettingsView';
import { UsersView } from './modules/users/UsersView';
import { RolesView } from './modules/roles/RolesView';
import { ConfigView } from './modules/config/ConfigView';
import { useBrandTheme } from './hooks/useBrandTheme';
import { useToday } from './hooks/useToday';
import './App.css';

const VIEW_ORDER: ViewKey[] = ['dashboard', 'purchases', 'sales', 'expenses', 'catalogs', 'lots', 'inventory', 'queue', 'apgrowers', 'ap', 'ar', 'expensesreport', 'activity', 'trash', 'checks', 'emails', 'company', 'users', 'roles', 'config'];

function Shell() {
  const { firebaseUser, bypass, loading, can, logout, isPlatformAdmin, needsCompanyChoice, consoleMode, company, memberships, profile } = useAuth();
  const [view, setView] = useState<ViewKey>('dashboard');
  useBrandTheme();
  /* Al cambiar el dia se vuelve a evaluar la suscripcion: el bloqueo llega sin recargar. */
  useToday();

  /** Navegar siempre muestra la vista desde arriba (evita entrar con el scroll a medias). */
  const handleNavigate = (key: ViewKey) => {
    setView(key);
    window.scrollTo({ top: 0 });
  };

  const allowedViews = VIEW_ORDER.filter((key) => can(key, 'view'));

  /* Si el rol no permite la vista actual, saltar a la primera permitida. */
  useEffect(() => {
    if (!loading && (firebaseUser || bypass) && allowedViews.length > 0 && !allowedViews.includes(view)) {
      setView(allowedViews[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, firebaseUser, allowedViews.join(','), view]);

  /* Sin sesion: landing, login o registro. Con sesion pero sin empresa confirmada,
     el mismo login pide la empresa (aunque el perfil aun cargue). */
  const atLogin = (!loading && !firebaseUser && !bypass) || needsCompanyChoice;

  if (loading && !atLogin) {
    /* Indica la empresa detectada para el email mientras resuelve la sesion. */
    const detected = consoleMode ? 'the Admin Panel' : company?.name ?? (memberships.length === 1 ? 'your company' : '');
    return (
      <div className="app-gate">
        <span className="app-gate__spinner" aria-hidden="true" />
        <p className="app-gate__text">
          {detected ? `Signing in to ${detected}…` : 'Verifying session…'}
        </p>
      </div>
    );
  }

  if (atLogin) return <PublicSite />;

  /* Admin Panel: fuera de toda empresa, con su propio layout. */
  if (consoleMode && firebaseUser) return <PlatformConsole />;

  /* Empresa registrada sola: espera la aprobacion de la plataforma. La ficha de la
     empresa es en tiempo real; al aprobarla, el app se recarga y entra. */
  const pendingApproval = !isPlatformAdmin && (company?.status === 'Pending' || profile?.status === 'Pending Approval');
  if (pendingApproval) {
    return (
      <div className="app-gate">
        <h2 className="app-gate__title">Your company is pending approval</h2>
        <p className="app-gate__text">
          <b>{company?.name ?? 'Your company'}</b> was registered. We review every new company before it
          starts working; this page opens your workspace automatically once it is approved.
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => void logout()}>Sign out</button>
      </div>
    );
  }

  /* Suscripcion vencida: la empresa queda bloqueada hasta registrar el pago.
     El administrador de la plataforma nunca se bloquea. */
  const billing = company ? billingInfoOf(company) : null;
  if (billing && !billing.active && !isPlatformAdmin) {
    const endedOn = company ? fmtDate(accessEndsOf(company)) : '';
    const reason = billing.state === 'Suspended' ? 'The account was suspended' : `Access ended on ${endedOn}`;
    return (
      <div className="app-gate">
        <h2 className="app-gate__title">Subscription inactive</h2>
        <p className="app-gate__text">
          {reason} for <b>{company?.name}</b> ({billing.label}). Renew the subscription to restore
          access. Your data is safe and will be here when the account is reactivated.
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => void logout()}>Sign out</button>
      </div>
    );
  }

  if (allowedViews.length === 0 && !isPlatformAdmin) {
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
    <AppLayout view={view} onNavigate={handleNavigate}>
      <div className="app-view">
        {view === 'dashboard' && <DashboardView onNavigate={setView} />}
        {view === 'purchases' && <PurchaseOrdersView />}
        {view === 'sales' && <SalesDeskView />}
        {view === 'expenses' && <ExpensesView />}
        {view === 'catalogs' && <CatalogsView />}
        {view === 'lots' && <LotActivityView />}
        {view === 'inventory' && <InventoryView />}
        {view === 'queue' && <ReportsView report="queue" />}
        {view === 'apgrowers' && <ReportsView report="apgrowers" />}
        {view === 'ap' && <ReportsView report="ap" />}
        {view === 'ar' && <ReportsView report="ar" />}
        {view === 'expensesreport' && <ReportsView report="expenses" />}
        {view === 'activity' && <ActivityLogView />}
        {view === 'trash' && <TrashView />}
        {view === 'checks' && <ChecksView />}
        {view === 'emails' && <EmailSettingsView />}
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
