import { useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PAYMENT_BILL_SCHEMA, PAYMENT_SALES_SCHEMA } from '../../config/entitySchemas';
import { deleteDocument } from '../../services/firestore';
import { syncSalesOrderTotals } from '../../services/orderTotalsService';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { READ_LIMIT } from '../../config/limits';
import { fmtMoney, round2 } from '../../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PaymentBill,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
  type SystemUser,
} from '../../types/models';
import './PaymentsView.css';

type Tab = 'in' | 'out';

interface Row {
  id: string;
  kind: Tab;
  date: string;
  party: string;
  document: string;
  method: string;
  checkNumber: string;
  refNumber: string;
  amount: number;
  /** Orden de venta asociada, para abrir su detalle. */
  salesOrderId?: string;
}

const fmtDate = (iso?: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = (iso ?? '').split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : (iso ?? '\u2014');
};

/**
 * Modulo Payments: todos los cobros (de ventas) y pagos (de gastos) de la
 * empresa en una sola vista. Los mismos registros se editan desde el detalle
 * de cada orden; aqui se listan, buscan y eliminan.
 */
interface Props {
  /** 'in' = cobros de ventas; 'out' = pagos de gastos. Cada uno es su propio modulo. */
  kind?: Tab;
}

export function PaymentsView({ kind = 'in' }: Props) {
  const { can } = useAuth();
  const tab = kind;
  const [search, setSearch] = useState('');
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);

  const { data: salesPayments, loading: loadingIn } = useCollection<PaymentSales>(COLLECTIONS.PAYMENT_SALES, [
    orderBy('DATE', 'desc'),
    limit(READ_LIMIT),
  ]);
  const { data: billPayments, loading: loadingOut } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL, [
    orderBy('DATE', 'desc'),
    limit(READ_LIMIT),
  ]);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: expenses } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const methods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');

  const buyerName = useMemo(() => {
    const map = new Map(systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '\u2014');
  }, [systemUsers, legacyUsers]);

  const rows = useMemo<Row[]>(() => {
    const ordersById = new Map(salesOrders.map((so) => [so.id, so]));
    const expensesById = new Map(expenses.map((e) => [e.id, e]));
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));

    const incoming: Row[] = salesPayments.map((p) => {
      const order = ordersById.get(p.ID_SALESORDER);
      return {
        id: p.id,
        kind: 'in',
        date: p.DATE ?? '',
        party: customers.nameOf(order?.ID_CUSTOMER ?? ''),
        document: order?.SALES_ORDER_NUMBER || '\u2014',
        method: methods.labelOf(p.ID_PAYMENTMETHOD),
        checkNumber: p.CHECK_NUMBER ?? '',
        refNumber: p.REF_NUMBER ?? '',
        amount: p.AMOUNT ?? 0,
        salesOrderId: p.ID_SALESORDER,
      };
    });

    const outgoing: Row[] = billPayments.map((p) => {
      const expense = expensesById.get(p.ID_EXPENSES);
      return {
        id: p.id,
        kind: 'out',
        date: p.DATE ?? '',
        party: suppliers.nameOf(expense?.ID_SUPPLIERS ?? ''),
        document: expense?.INVOICE_NUMBER || lotOf.get(expense?.ID_PURCHASEORDER ?? '') || '\u2014',
        method: methods.labelOf(p.ID_PAYMENTMETHOD),
        checkNumber: p.CHECK_NUMBER ?? '',
        refNumber: p.REF_NUMBER ?? '',
        amount: p.AMOUNT ?? 0,
      };
    });

    const term = search.trim().toLowerCase();
    return (tab === 'in' ? incoming : outgoing)
      .filter((r) => !term || [r.party, r.document, r.method, r.checkNumber, r.refNumber].join(' ').toLowerCase().includes(term))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [tab, salesPayments, billPayments, salesOrders, expenses, purchaseOrders, customers, suppliers, methods, search]);

  const total = round2(rows.reduce((acc, r) => acc + r.amount, 0));

  /* Configuracion por tipo: titulo, esquema de importacion y modulo de permisos. */
  const meta =
    tab === 'in'
      ? {
          title: 'Payments',
          subtitle: 'Money received from customers',
          schemas: [PAYMENT_SALES_SCHEMA],
          fileName: 'sales-payments',
          moduleId: 'payments',
        }
      : {
          title: 'Expense Payments',
          subtitle: 'Money paid to suppliers against expenses',
          schemas: [PAYMENT_BILL_SCHEMA],
          fileName: 'expense-payments',
          moduleId: 'billpayments',
        };

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'party', header: tab === 'in' ? 'Customer' : 'Supplier', render: (r) => r.party },
    { key: 'document', header: tab === 'in' ? '# Sales order' : 'Invoice / Lot', render: (r) => r.document },
    { key: 'method', header: 'Method', render: (r) => r.method },
    { key: 'check', header: 'Check #', render: (r) => r.checkNumber || '\u2014' },
    { key: 'ref', header: 'Ref #', render: (r) => r.refNumber || '\u2014' },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount) },
  ];

  /** Abrir el detalle de la orden permite editar el pago con el editor inline. */
  const openRow = (row: Row) => {
    if (row.kind !== 'in' || !row.salesOrderId) return;
    const order = salesOrders.find((so) => so.id === row.salesOrderId);
    if (order) setViewingSale(order);
  };

  const removeRow = async (row: Row) => {
    if (!window.confirm('Delete this payment?')) return;
    await deleteDocument(row.kind === 'in' ? COLLECTIONS.PAYMENT_SALES : COLLECTIONS.PAYMENT_BILL, row.id);
    if (row.kind === 'in' && row.salesOrderId) void syncSalesOrderTotals([row.salesOrderId]);
  };

  return (
    <div className="payments">
      <Toolbar
        title={meta.title}
        subtitle={meta.subtitle}
        searchValue={search}
        onSearchChange={setSearch}
      >
        {can(meta.moduleId, 'documents') && <DataPortButtons schemas={meta.schemas} fileName={meta.fileName} />}
      </Toolbar>

      <div className="payments__bar">
        <div className="payments__chips">
          <span className="payments__chip">{rows.length} payments</span>
          <span className={`payments__chip payments__chip--${tab === 'in' ? 'in' : 'out'}`}>
            Total <b className="num">{fmtMoney(total)}</b>
          </span>
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={tab === 'in' ? loadingIn : loadingOut}
        emptyMessage="No payments registered yet."
        onRowClick={tab === 'in' ? openRow : undefined}
        onDelete={can(meta.moduleId, 'delete') ? (row) => void removeRow(row) : undefined}
      />

      <p className="payments__hint">
        Open a sales payment to edit it inside its order, where line items and payments live together.
      </p>

      {viewingSale && (
        <SalesOrderDetailPanel
          order={viewingSale}
          purchaseOrders={purchaseOrders}
          buyerName={buyerName}
          onClose={() => setViewingSale(null)}
        />
      )}
    </div>
  );
}
