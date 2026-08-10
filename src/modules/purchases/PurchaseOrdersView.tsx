import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { COLLECTIONS, type PurchaseOrder, type SystemUser } from '../../types/models';
import { byNewest, fmtDate, fmtMoney } from '../../utils/format';
import { deleteDocument, replaceChildren } from '../../services/firestore';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PURCHASES_SCHEMAS } from '../../config/entitySchemas';
import { PurchaseOrderForm } from './PurchaseOrderForm';
import { PurchaseOrderDetailPanel } from './PurchaseOrderDetailPanel';
import { printPurchaseOrderPdf } from '../../services/purchaseOrderPdfService';
import { useCompany } from '../../hooks/useCompany';
import './PurchaseOrdersView.css';

export function PurchaseOrdersView() {
  const { can } = useAuth();
  const { data, loading } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { data: customerDocs } = useCollection<{ id: string; ADDRESS_CUSTOMER?: string; CITY_CUSTOMER?: string }>(COLLECTIONS.CUSTOMER);
  const { company } = useCompany();
  /** Resuelve buyer: usuarios del sistema primero, catalogo legado para registros viejos. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
  return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '—');
  }, [systemUsers, legacyUsers]);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);

  const rows = useMemo(() => {
    const sorted = [...data].sort(byNewest);
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
  }, [data, search, growers, customers, buyerName]);

  const columns: Array<Column<PurchaseOrder>> = [
    ...(can('purchases', 'documents')
      ? [{
          key: 'pdf',
          header: '',
          width: '44px',
          align: 'center' as const,
          render: (po: PurchaseOrder) => (
            <button
              type="button"
              className="po-pdf-btn"
              title="Download purchase order"
              onClick={(e) => {
                e.stopPropagation();
                handlePdf(po);
              }}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 3v11M7 10l5 5 5-5" /><path d="M4 19h16" />
              </svg>
            </button>
          ),
        }]
      : []),
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

  /** Genera el documento imprimible de la orden (formato Berry Source). */
  const handlePdf = (po: PurchaseOrder) => {
    const vendorDoc = customerDocs.find((c) => c.id === po.ID_CUSTOMER);
    void printPurchaseOrderPdf(po, {
      company,
      vendorName: customers.nameOf(po.ID_CUSTOMER),
      vendorAddress: vendorDoc?.ADDRESS_CUSTOMER ?? '',
      vendorCity: vendorDoc?.CITY_CUSTOMER ?? '',
      shipToName: locations.nameOf(po.SHIPTO),
      carrierName: carriers.nameOf(po.ID_CARRIER),
      salesPerson: buyerName(po.ID_USERS),
      commodityName: (id) => commodities.nameOf(id),
    });
  };

  /** Borrado desde la tabla: detalle + encabezado, en segundo plano. */
  const handleDeleteRow = (po: PurchaseOrder) => {
    if (!window.confirm(`Delete purchase order ${po.LOT_NUMBER || po.REF_NUMBER || ''}?`)) return;
    const persist = async () => {
      await replaceChildren(COLLECTIONS.PURCHASE_DETAILS, 'ID_PURCHASEORDER', po.id, []);
      await deleteDocument(COLLECTIONS.PURCHASE_ORDER, po.id);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

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
        onRowClick={setViewing}
        onEdit={can('purchases', 'edit') ? (po) => { setEditing(po); setFormOpen(true); } : undefined}
        onDelete={can('purchases', 'delete') ? handleDeleteRow : undefined}
      />

      {viewing && (
        <PurchaseOrderDetailPanel
          order={viewing}
          buyerName={buyerName}
          onClose={() => setViewing(null)}
          onEdit={can('purchases', 'edit') ? () => {
            setEditing(viewing);
            setViewing(null);
            setFormOpen(true);
          } : undefined}
        />
      )}

      <PurchaseOrderForm open={formOpen} initial={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}
