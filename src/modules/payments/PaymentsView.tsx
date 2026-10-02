import { useMemo, useState } from 'react';
import { limit } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PAYMENT_BILL_SCHEMA, PAYMENT_PURCHASE_SCHEMA, PAYMENT_SALES_SCHEMA } from '../../config/entitySchemas';
import { deleteDocument } from '../../services/firestore';
import { syncExpenseTotals, syncPurchaseOrderTotals, syncSalesOrderTotals } from '../../services/orderTotalsService';
import { PaymentEditModal, type EditablePayment } from '../../components/ui/RecordEditModals';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { PaymentsAuditPanel } from './PaymentsAuditPanel';
import { READ_LIMIT } from '../../config/limits';
import { fmtMoney, round2 } from '../../utils/format';
import {
  COLLECTIONS,
  type Expense,
  type PaymentBill,
  type PaymentPurchase,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
  type SystemUser,
} from '../../types/models';
import './PaymentsView.css';

type Tab = 'in' | 'out' | 'po';

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
  /** Documento padre del pago (orden, lote o gasto), para recalcular su saldo. */
  parentId: string;
  /** Pago original, para el modal de edicion. */
  source: EditablePayment;
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
  /** 'in' = cobros de ventas; 'out' = pagos de gastos. */
  kind?: Tab;
  /** Embebido como pestana dentro de otra vista: sin toolbar propio. */
  embedded?: boolean;
  /** Modulo del que hereda los permisos cuando va embebido. */
  moduleId?: string;
}

export function PaymentsView({ kind = 'in', embedded = false, moduleId }: Props) {
  const { can } = useAuth();
  const tab = kind;
  const [search, setSearch] = useState('');
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);
  const [editingPayment, setEditingPayment] = useState<Row | null>(null);

  const { data: salesPayments, loading: loadingIn } = useCollection<PaymentSales>(COLLECTIONS.PAYMENT_SALES, [limit(READ_LIMIT)]);
  const { data: billPayments, loading: loadingOut } = useCollection<PaymentBill>(COLLECTIONS.PAYMENT_BILL, [limit(READ_LIMIT)]);
  const { data: purchasePayments, loading: loadingPo } = useCollection<PaymentPurchase>(
    COLLECTIONS.PAYMENT_PURCHASE,
    [limit(READ_LIMIT)],
  );
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
        parentId: p.ID_SALESORDER,
        source: p,
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
        parentId: p.ID_EXPENSES,
        source: p,
      };
    });

    /* Pagos a growers por lote. */
    const lotPayments: Row[] = purchasePayments.map((p) => {
      const po = purchaseOrders.find((o) => o.id === p.ID_PURCHASEORDER);
      return {
        id: p.id,
        kind: 'po' as Tab,
        date: p.DATE ?? '',
        party: po?.LOT_NUMBER ?? '\u2014',
        document: po?.REF_NUMBER || po?.LOT_NUMBER || '\u2014',
        method: methods.labelOf(p.ID_PAYMENTMETHOD),
        checkNumber: p.CHECK_NUMBER ?? '',
        refNumber: p.REF_NUMBER ?? '',
        amount: p.AMOUNT ?? 0,
        parentId: p.ID_PURCHASEORDER,
        source: p,
      };
    });

    const term = search.trim().toLowerCase();
    return (tab === 'in' ? incoming : tab === 'po' ? lotPayments : outgoing)
      .filter((r) => !term || [r.party, r.document, r.method, r.checkNumber, r.refNumber].join(' ').toLowerCase().includes(term))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [tab, salesPayments, billPayments, purchasePayments, salesOrders, expenses, purchaseOrders, customers, suppliers, methods, search]);

  const total = round2(rows.reduce((acc, r) => acc + r.amount, 0));

  /* Configuracion por tipo: titulo, esquema de importacion y modulo de permisos. */
  const meta =
    tab === 'po'
      ? {
          title: 'Purchase Payments',
          subtitle: 'Money paid to growers for each lot',
          schemas: [PAYMENT_PURCHASE_SCHEMA],
          fileName: 'purchase-payments',
          moduleId: moduleId ?? 'purchases',
        }
      : tab === 'in'
      ? {
          title: 'Payments',
          subtitle: 'Money received from customers',
          schemas: [PAYMENT_SALES_SCHEMA],
          fileName: 'sales-payments',
          moduleId: moduleId ?? 'sales',
        }
      : {
          title: 'Expense Payments',
          subtitle: 'Money paid to suppliers against expenses',
          schemas: [PAYMENT_BILL_SCHEMA],
          fileName: 'expense-payments',
          moduleId: moduleId ?? 'expenses',
        };

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'party', header: tab === 'in' ? 'Customer' : tab === 'po' ? 'Lot #' : 'Supplier', render: (r) => r.party },
    { key: 'document', header: tab === 'in' ? '# Sales order' : tab === 'po' ? '# Ref' : 'Invoice / Lot', render: (r) => r.document },
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

  const collectionFor = (kind: Tab): string =>
    kind === 'in' ? COLLECTIONS.PAYMENT_SALES : kind === 'po' ? COLLECTIONS.PAYMENT_PURCHASE : COLLECTIONS.PAYMENT_BILL;

  /** Recalcula el saldo del documento padre (orden, lote o gasto) tras un cambio. */
  const syncParent = (row: Row) => {
    if (!row.parentId) return;
    /* Los pagos acaban de cambiar: la suma de pagos manda aunque quede en 0. */
    if (row.kind === 'in') void syncSalesOrderTotals([row.parentId], true, { paymentsChanged: true });
    else if (row.kind === 'po') void syncPurchaseOrderTotals([row.parentId], true, { paymentsChanged: true });
    else void syncExpenseTotals([row.parentId], true, { paymentsChanged: true });
  };

  /** Borra un pago y recalcula el saldo de su documento (sin preguntar). */
  const eliminarPago = async (row: Row) => {
    await deleteDocument(collectionFor(row.kind), row.id);
    syncParent(row);
  };

  const removeRow = async (row: Row) => {
    if (!window.confirm('Delete this payment?')) return;
    await eliminarPago(row);
  };

  /** Borrado masivo desde las casillas de la tabla. */
  const eliminarSeleccionados = async (filas: Row[]) => {
    for (const row of filas) await eliminarPago(row);
  };

  const [auditOpen, setAuditOpen] = useState(false);
  const checkButton = (
    <button
      type="button"
      className="btn btn--secondary"
      onClick={() => setAuditOpen(true)}
      title="Compare every document with its payment records and fix what does not match"
    >
      Check payments
    </button>
  );

  return (
    <div className="payments">
      {!embedded && (
        <Toolbar
          title={meta.title}
          subtitle={meta.subtitle}
          searchValue={search}
          onSearchChange={setSearch}
        >
          {checkButton}
          {can(meta.moduleId, 'documents') && <DataPortButtons schemas={meta.schemas} fileName={meta.fileName} />}
        </Toolbar>
      )}
      {auditOpen && (
        <PaymentsAuditPanel
          initialArea={tab === 'in' ? 'sales' : tab === 'po' ? 'lots' : 'expenses'}
          onClose={() => setAuditOpen(false)}
        />
      )}

      <div className="payments__bar">
        <div className="payments__chips">
          <span className="payments__chip">{rows.length} payments</span>
          <span className={`payments__chip payments__chip--${tab === 'in' ? 'in' : 'out'}`}>
            Total <b className="num">{fmtMoney(total)}</b>
          </span>
        </div>
        {embedded && (
          <div className="payments__embedded-bar">
            <input
              className="input payments__search"
              value={search}
              placeholder="Search…"
              onChange={(e) => setSearch(e.target.value)}
            />
            {checkButton}
            {can(meta.moduleId, 'documents') && <DataPortButtons schemas={meta.schemas} fileName={meta.fileName} />}
          </div>
        )}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={tab === 'in' ? loadingIn : tab === 'po' ? loadingPo : loadingOut}
        emptyMessage="No payments registered yet."
        onRowClick={tab === 'in' ? openRow : undefined}
        onEdit={can(meta.moduleId, 'edit') ? setEditingPayment : undefined}
        onDelete={can(meta.moduleId, 'delete') ? (row) => void removeRow(row) : undefined}
        onBulkDelete={can(meta.moduleId, 'delete') ? eliminarSeleccionados : undefined}
        bulkLabel="payments"
      />

      <p className="payments__hint">
        {tab === 'in'
          ? 'Open a payment to edit it inside its sales order, where line items and payments live together.'
          : tab === 'po'
            ? 'Open a lot to add, edit or delete its payments; Amount paid updates on the spot.'
            : 'Expense payments are edited inside their expense.'}
      </p>

      {editingPayment && (
        <PaymentEditModal
          collection={collectionFor(editingPayment.kind)}
          payment={editingPayment.source}
          onClose={() => setEditingPayment(null)}
          onSaved={() => syncParent(editingPayment)}
        />
      )}

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
