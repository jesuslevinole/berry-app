import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { updateDocument } from '../../services/firestore';
import { COLLECTIONS, type PurchaseOrder, type SalesOrder, type SystemUser } from '../../types/models';
import { fmtDate, fmtMoney, round2 } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { SALES_SCHEMAS } from '../../config/entitySchemas';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PaymentsPanel } from '../payments/PaymentsPanel';
import { SalesOrderForm } from './SalesOrderForm';
import './SalesDeskView.css';

export function SalesDeskView() {
  const { can } = useAuth();
  const { data, loading } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  /** Resuelve buyer: usuarios del sistema primero, catalogo legado para registros viejos. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '—');
  }, [systemUsers, legacyUsers]);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<SalesOrder | null>(null);

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
    return sorted.filter((so) =>
      [so.SALES_ORDER_NUMBER, so.REF, so.BUYER, so.STATUS, customers.nameOf(so.ID_CUSTOMER), buyerName(so.ID_USERS)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [data, search, customers, users]);

  const columns: Array<Column<SalesOrder>> = [
    { key: 'DATE', header: 'Date', render: (so) => fmtDate(so.DATE) },
    { key: 'SALES_ORDER_NUMBER', header: '# Sales Order', render: (so) => <span className="mono">{so.SALES_ORDER_NUMBER || '—'}</span> },
    { key: 'ID_CUSTOMER', header: 'Customer', render: (so) => customers.nameOf(so.ID_CUSTOMER) },
    { key: 'REF', header: 'Ref', render: (so) => so.REF || '—' },
    { key: 'TOTAL', header: 'Total', align: 'right', render: (so) => <span className="num">{fmtMoney(so.TOTAL)}</span> },
    { key: 'DUE_DATE', header: 'Due Date', render: (so) => fmtDate(so.DUE_DATE) },
    { key: 'STATUS', header: 'Status', render: (so) => <StatusBadge value={so.STATUS ?? 'Draft'} /> },
    {
      key: 'SENT',
      header: 'Sent',
      render: (so) => <span className={so.SENT ? 'text-ok' : 'muted'}>{so.SENT ? 'Yes' : 'No'}</span>,
    },
    { key: 'ID_USERS', header: 'Salesperson', render: (so) => buyerName(so.ID_USERS) },
    { key: 'BUYER', header: 'Buyer', render: (so) => so.BUYER || '—' },
    {
      key: 'payments',
      header: '',
      align: 'center',
      width: '52px',
      render: (so) => (
        <button
          type="button"
          className="btn btn--icon sales-desk__pay-btn"
          aria-label="Payments"
          title="Payments"
          onClick={(e) => {
            e.stopPropagation();
            setPaymentsFor(so);
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.4 5 1.5 5 3.6-2.2 3-5 3-5-1.1-5-3" />
          </svg>
        </button>
      ),
    },
  ];

  const handleTotalPaidChange = async (so: SalesOrder, totalPaid: number) => {
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, so.id, {
      INCOMES: totalPaid,
      BALANCE: round2((so.TOTAL ?? 0) - totalPaid),
    });
  };

  return (
    <div className="sales-desk">
      <Toolbar title="Sales Desk" subtitle={`${rows.length} orders`} searchValue={search} onSearchChange={setSearch}>
        {can('sales', 'documents') && <DataPortButtons schemas={SALES_SCHEMAS} fileName="sales-orders" />}
        {can('sales', 'add') && (
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
        )}
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage="No sales orders yet"
        onRowClick={(so) => {
          setEditing(so);
          setFormOpen(true);
        }}
      />

      <SalesOrderForm
        open={formOpen}
        initial={editing}
        purchaseOrderOptions={purchaseOrderOptions}
        onClose={() => setFormOpen(false)}
      />

      {paymentsFor && (
        <Modal
          title={`Payments — Sales order ${paymentsFor.SALES_ORDER_NUMBER}`}
          open
          onClose={() => setPaymentsFor(null)}
          wide
        >
          <PaymentsPanel
            collectionName={COLLECTIONS.PAYMENT_SALES}
            parentField="ID_SALESORDER"
            parentId={paymentsFor.id}
            expectedTotal={paymentsFor.TOTAL ?? 0}
            onTotalPaidChange={(totalPaid) => handleTotalPaidChange(paymentsFor, totalPaid)}
          />
        </Modal>
      )}
    </div>
  );
}
