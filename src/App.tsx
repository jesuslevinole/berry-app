import { useState } from 'react';
import { AppLayout, type ViewKey } from './components/layout/AppLayout';
import { DashboardView } from './modules/dashboard/DashboardView';
import { PurchaseOrdersView } from './modules/purchases/PurchaseOrdersView';
import { SalesDeskView } from './modules/sales/SalesDeskView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { CatalogsView } from './modules/catalogs/CatalogsView';
import './App.css';

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard');

  return (
    <AppLayout view={view} onNavigate={setView}>
      <div className="app-view">
        {view === 'dashboard' && <DashboardView onNavigate={setView} />}
        {view === 'purchases' && <PurchaseOrdersView />}
        {view === 'sales' && <SalesDeskView />}
        {view === 'expenses' && <ExpensesView />}
        {view === 'catalogs' && <CatalogsView />}
      </div>
    </AppLayout>
  );
}
