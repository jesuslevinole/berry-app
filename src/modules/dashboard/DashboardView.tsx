import { useMemo } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { COLLECTIONS, type Expense, type PaymentBill, type PaymentSales, type PurchaseOrder, type SalesOrder } from '../../types/models';
import { growersPayableTotal, payableTotal, receivableTotal } from '../../services/balances';
import { fmtDate, fmtMoney } from '../../utils/format';
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
  /* Pagos reales: los saldos se calculan en vivo, igual que en los reportes. */
  const { data: salesPayments } = useCollection<PaymentSales>(COLLECTIONS.PAYMENT_SALES);
  const { data: billPayments } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL);
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');

  const kpis = useMemo(
    () => [
      {
        key: 'purchases' as ViewKey,
        label: 'Purchase orders',
        count: purchaseOrders.length,
        amountLabel: 'Outstanding balance',
        /* = A/P Growers */
        amount: growersPayableTotal(purchaseOrders),
      },
      {
        key: 'sales' as ViewKey,
        label: 'Sales orders',
        count: salesOrders.length,
        amountLabel: 'Receivable',
        /* = Accounts Receivable */
        amount: receivableTotal(salesOrders, salesPayments),
      },
      {
        key: 'expenses' as ViewKey,
        label: 'Expenses',
        count: expenses.length,
        amountLabel: 'Payable',
        /* = Accounts Payable */
        amount: payableTotal(expenses, billPayments, suppliers.nameOf),
      },
    ],
    [purchaseOrders, salesOrders, expenses, salesPayments, billPayments, suppliers],
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
