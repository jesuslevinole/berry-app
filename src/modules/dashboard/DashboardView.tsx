import { useMemo } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { COLLECTIONS, type Expense, type PurchaseOrder, type SalesOrder } from '../../types/models';
import { fmtDate, fmtMoney, round2 } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { ViewKey } from '../../components/layout/AppLayout';
import './DashboardView.css';

interface DashboardViewProps {
  onNavigate: (view: ViewKey) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: expenses } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');

  const kpis = useMemo(
    () => [
      {
        key: 'purchases' as ViewKey,
        label: 'Purchase orders',
        count: purchaseOrders.length,
        amountLabel: 'Outstanding balance',
        amount: round2(purchaseOrders.reduce((acc, po) => acc + (po.BALANCE ?? 0), 0)),
      },
      {
        key: 'sales' as ViewKey,
        label: 'Sales orders',
        count: salesOrders.length,
        amountLabel: 'Receivable',
        amount: round2(salesOrders.reduce((acc, so) => acc + (so.BALANCE ?? 0), 0)),
      },
      {
        key: 'expenses' as ViewKey,
        label: 'Expenses',
        count: expenses.length,
        amountLabel: 'Payable',
        amount: round2(expenses.reduce((acc, exp) => acc + (exp.BALANCE ?? 0), 0)),
      },
    ],
    [purchaseOrders, salesOrders, expenses],
  );

  const recentSales = useMemo(
    () => [...salesOrders].sort((a, b) => (b.DATE ?? '').localeCompare(a.DATE ?? '')).slice(0, 6),
    [salesOrders],
  );

  const columns: Array<Column<SalesOrder>> = [
    { key: 'DATE', header: 'Date', render: (so) => fmtDate(so.DATE) },
    { key: 'SALES_ORDER_NUMBER', header: '# Sales Order', render: (so) => <span className="mono">{so.SALES_ORDER_NUMBER || '—'}</span> },
    { key: 'ID_CUSTOMER', header: 'Customer', render: (so) => customers.nameOf(so.ID_CUSTOMER) },
    { key: 'TOTAL', header: 'Total', align: 'right', render: (so) => <span className="num">{fmtMoney(so.TOTAL)}</span> },
    { key: 'STATUS', header: 'Status', render: (so) => <StatusBadge value={so.STATUS ?? 'Draft'} /> },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard__kpis">
        {kpis.map((kpi) => (
          <button key={kpi.key} type="button" className="dashboard__kpi" onClick={() => onNavigate(kpi.key)}>
            <span className="dashboard__kpi-label">{kpi.label}</span>
            <strong className="dashboard__kpi-count">{kpi.count}</strong>
            <span className="dashboard__kpi-amount">
              <span className="muted">{kpi.amountLabel}</span>
              <b className={`num${kpi.amount > 0 ? ' text-bad' : ''}`}>{fmtMoney(kpi.amount)}</b>
            </span>
          </button>
        ))}
      </div>

      <section className="dashboard__section">
        <div className="dashboard__section-head">
          <h2 className="dashboard__section-title">Recent sales</h2>
          <button type="button" className="btn btn--ghost" onClick={() => onNavigate('sales')}>
            View all →
          </button>
        </div>
        <DataTable columns={columns} rows={recentSales} emptyMessage="No sales orders yet" />
      </section>
    </div>
  );
}
