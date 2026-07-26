import { useMemo, useState } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { updateDocument } from '../../services/firestore';
import { COLLECTIONS, type Expense, type PurchaseOrder } from '../../types/models';
import { fmtDate, fmtMoney, round2 } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { EXPENSES_SCHEMAS } from '../../config/entitySchemas';
import { Modal } from '../../components/ui/Modal';
import { PaymentsPanel } from '../payments/PaymentsPanel';
import { ExpenseForm } from './ExpenseForm';
import './ExpensesView.css';

export function ExpensesView() {
  const { data, loading } = useCollection<Expense>(COLLECTIONS.EXPENSES);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Expense | null>(null);

  const lotOf = useMemo(() => {
    const map = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER || po.REF_NUMBER || po.id]));
    return (id?: string): string => (id ? (map.get(id) ?? '—') : '—');
  }, [purchaseOrders]);

  const purchaseOrderOptions = useMemo<CatalogOption[]>(
    () =>
      [...purchaseOrders]
        .sort((a, b) => (b.LOT_NUMBER ?? '').localeCompare(a.LOT_NUMBER ?? ''))
        .map((po) => ({ id: po.id, name: po.LOT_NUMBER || po.REF_NUMBER || po.id })),
    [purchaseOrders],
  );

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => (b.DATE ?? '').localeCompare(a.DATE ?? ''));
    const term = search.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((exp) =>
      [exp.INVOICE_NUMBER, lotOf(exp.ID_PURCHASEORDER), suppliers.nameOf(exp.ID_SUPPLIERS), categories.nameOf(exp.ID_CATEGORYBILL)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [data, search, lotOf, suppliers, categories]);

  const columns: Array<Column<Expense>> = [
    { key: 'ID_PURCHASEORDER', header: '# Lot', render: (exp) => <span className="mono">{lotOf(exp.ID_PURCHASEORDER)}</span> },
    { key: 'INVOICE_NUMBER', header: 'Invoice #', render: (exp) => exp.INVOICE_NUMBER || '—' },
    { key: 'DATE', header: 'Date', render: (exp) => fmtDate(exp.DATE) },
    { key: 'ID_SUPPLIERS', header: 'Supplier', render: (exp) => suppliers.nameOf(exp.ID_SUPPLIERS) },
    { key: 'ID_CATEGORYBILL', header: 'Category', render: (exp) => categories.nameOf(exp.ID_CATEGORYBILL) },
    { key: 'AMOUNT', header: 'Amount', align: 'right', render: (exp) => <span className="num">{fmtMoney(exp.AMOUNT)}</span> },
    { key: 'PAY_AMOUNT', header: 'Pay amount', align: 'right', render: (exp) => <span className="num">{fmtMoney(exp.PAY_AMOUNT)}</span> },
    {
      key: 'BALANCE',
      header: 'Balance',
      align: 'right',
      render: (exp) => (
        <span className={`num${(exp.BALANCE ?? 0) > 0 ? ' text-bad' : ''}`}>{fmtMoney(exp.BALANCE)}</span>
      ),
    },
    {
      key: 'payments',
      header: '',
      align: 'center',
      width: '52px',
      render: (exp) => (
        <button
          type="button"
          className="btn btn--icon expenses__pay-btn"
          aria-label="Payments"
          title="Payments"
          onClick={(e) => {
            e.stopPropagation();
            setPaymentsFor(exp);
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.4 5 1.5 5 3.6-2.2 3-5 3-5-1.1-5-3" />
          </svg>
        </button>
      ),
    },
  ];

  const handleTotalPaidChange = async (exp: Expense, totalPaid: number) => {
    await updateDocument<Expense>(COLLECTIONS.EXPENSES, exp.id, {
      PAY_AMOUNT: totalPaid,
      BALANCE: round2((exp.AMOUNT ?? 0) - totalPaid),
    });
  };

  return (
    <div className="expenses">
      <Toolbar
        title="Additional expenses"
        subtitle={`${rows.length} expenses`}
        searchValue={search}
        onSearchChange={setSearch}
      >
        <DataPortButtons schemas={EXPENSES_SCHEMAS} fileName="expenses" />
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + Add
        </button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage="No expenses yet"
        onRowClick={(exp) => {
          setEditing(exp);
          setFormOpen(true);
        }}
      />

      <ExpenseForm
        open={formOpen}
        initial={editing}
        purchaseOrderOptions={purchaseOrderOptions}
        onClose={() => setFormOpen(false)}
      />

      {paymentsFor && (
        <Modal
          title={`Payments — Invoice ${paymentsFor.INVOICE_NUMBER || lotOf(paymentsFor.ID_PURCHASEORDER)}`}
          open
          onClose={() => setPaymentsFor(null)}
          wide
        >
          <PaymentsPanel
            collectionName={COLLECTIONS.PAYMENT_BILL}
            parentField="ID_EXPENSES"
            parentId={paymentsFor.id}
            expectedTotal={paymentsFor.AMOUNT ?? 0}
            onTotalPaidChange={(totalPaid) => handleTotalPaidChange(paymentsFor, totalPaid)}
          />
        </Modal>
      )}
    </div>
  );
}
