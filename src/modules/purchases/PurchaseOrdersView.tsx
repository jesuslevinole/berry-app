import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { COLLECTIONS, type PurchaseOrder, type SystemUser } from '../../types/models';
import { fmtDate, fmtMoney } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PURCHASES_SCHEMAS } from '../../config/entitySchemas';
import { PurchaseOrderForm } from './PurchaseOrderForm';
import './PurchaseOrdersView.css';

export function PurchaseOrdersView() {
  const { can } = useAuth();
  const { data, loading } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
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
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => (b.ARRIVAL_DATE ?? '').localeCompare(a.ARRIVAL_DATE ?? ''));
    const term = search.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((po) =>
      [
        po.LOT_NUMBER,
        po.REF_NUMBER,
        growers.nameOf(po.ID_GROWER),
        customers.nameOf(po.ID_CUSTOMER),
        buyerName(po.ID_USERS),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [data, search, growers, customers, users]);

  const columns: Array<Column<PurchaseOrder>> = [
    { key: 'ID_GROWER', header: 'Grower', render: (po) => growers.nameOf(po.ID_GROWER) },
    { key: 'ID_CUSTOMER', header: 'Vendor', render: (po) => customers.nameOf(po.ID_CUSTOMER) },
    { key: 'ID_USERS', header: 'Buyer', render: (po) => buyerName(po.ID_USERS) },
    { key: 'ARRIVAL_DATE', header: 'Arrival Date', render: (po) => fmtDate(po.ARRIVAL_DATE) },
    { key: 'LOT_NUMBER', header: 'Lot #', render: (po) => <span className="mono">{po.LOT_NUMBER || '—'}</span> },
    { key: 'REF_NUMBER', header: '# Ref', render: (po) => po.REF_NUMBER || '—' },
    { key: 'QUANTITY', header: 'Quantity', align: 'right', render: (po) => <span className="num">{po.QUANTITY ?? 0}</span> },
    { key: 'SUBTOTAL', header: 'Subtotal', align: 'right', render: (po) => <span className="num">{fmtMoney(po.SUBTOTAL)}</span> },
    { key: 'TOTAL', header: 'Total', align: 'right', render: (po) => <span className="num">{fmtMoney(po.TOTAL)}</span> },
    { key: 'AMOUNT_PAID', header: 'Amount paid', align: 'right', render: (po) => <span className="num">{fmtMoney(po.AMOUNT_PAID)}</span> },
    {
      key: 'BALANCE',
      header: 'Balance',
      align: 'right',
      render: (po) => (
        <span className={`num${(po.BALANCE ?? 0) > 0 ? ' text-bad' : ''}`}>{fmtMoney(po.BALANCE)}</span>
      ),
    },
  ];

  return (
    <div className="purchase-orders">
      <Toolbar
        title="Purchase Order"
        subtitle={`${rows.length} orders`}
        searchValue={search}
        onSearchChange={setSearch}
      >
        {can('purchases', 'documents') && <DataPortButtons schemas={PURCHASES_SCHEMAS} fileName="purchase-orders" />}
        {can('purchases', 'add') && (
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
        emptyMessage="No purchase orders yet"
        onRowClick={(po) => {
          setEditing(po);
          setFormOpen(true);
        }}
      />

      <PurchaseOrderForm open={formOpen} initial={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
