import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { PurchaseOrderDetailPanel } from '../purchases/PurchaseOrderDetailPanel';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { fmtMoney, round2 } from '../../utils/format';
import {
  COLLECTIONS,
  type PurchaseDetail,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
  type SystemUser,
} from '../../types/models';
import './LineDetailsView.css';

const fmtDate = (iso?: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = (iso ?? '').split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : (iso ?? '\u2014');
};

interface Row {
  id: string;
  document: string;
  date: string;
  party: string;
  commodity: string;
  description: string;
  quantity: number;
  price: number;
  total: number;
  parentId: string;
}

/**
 * Detalle de compras: todas las lineas de Purchase Orders en una sola tabla,
 * con filtro por producto. Al hacer clic se abre el lote que las contiene.
 */
export function PurchaseDetailsView() {
  const { can } = useAuth();
  const { data: lines, loading } = useCollection<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS);
  const { data: orders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');

  const [search, setSearch] = useState('');
  const [commodityFilter, setCommodityFilter] = useState('');
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);

  const buyerName = useMemo(() => {
    const map = new Map(systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '\u2014');
  }, [systemUsers, legacyUsers]);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(orders.map((po) => [po.id, po]));
    const term = search.trim().toLowerCase();
    return lines
      .map((line) => {
        const po = byId.get(line.ID_PURCHASEORDER);
        return {
          id: line.id,
          document: po?.LOT_NUMBER || po?.REF_NUMBER || '\u2014',
          date: po?.ARRIVAL_DATE ?? '',
          party: growers.nameOf(po?.ID_GROWER ?? ''),
          commodity: commodities.labelOf(line.ID_COMMODITIES),
          description: line.DESCRIPTION ?? '',
          quantity: round2(line.QUANTITY ?? 0),
          price: line.PRICE ?? 0,
          total: line.TOTAL ?? 0,
          parentId: line.ID_PURCHASEORDER,
        };
      })
      .filter((r) => !commodityFilter || commodities.labelOf(commodityFilter) === r.commodity)
      .filter((r) => !term || [r.document, r.party, r.commodity, r.description].join(' ').toLowerCase().includes(term))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.document.localeCompare(a.document));
  }, [lines, orders, growers, commodities, commodityFilter, search]);

  const totals = useMemo(
    () => ({
      quantity: round2(rows.reduce((acc, r) => acc + r.quantity, 0)),
      amount: round2(rows.reduce((acc, r) => acc + r.total, 0)),
    }),
    [rows],
  );

  const columns: Column<Row>[] = [
    { key: 'document', header: 'Lot #', render: (r) => r.document },
    { key: 'date', header: 'Arrival', render: (r) => fmtDate(r.date) },
    { key: 'party', header: 'Grower', render: (r) => r.party },
    { key: 'commodity', header: 'Commodity', render: (r) => r.commodity },
    { key: 'description', header: 'Description', render: (r) => r.description || '\u2014' },
    { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => r.quantity },
    { key: 'price', header: 'Price', align: 'right', render: (r) => fmtMoney(r.price) },
    { key: 'total', header: 'Total', align: 'right', render: (r) => fmtMoney(r.total) },
  ];

  return (
    <div className="line-details">
      <Toolbar
        title="Purchase Details"
        subtitle="Every line item bought, across all lots"
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="line-details__bar">
        <div className="line-details__chips">
          <span className="line-details__chip">{rows.length} lines</span>
          <span className="line-details__chip">Quantity <b className="num">{totals.quantity}</b></span>
          <span className="line-details__chip">Total <b className="num">{fmtMoney(totals.amount)}</b></span>
        </div>
        <div className="line-details__filter">
          <span className="line-details__filter-label">Commodity</span>
          <SearchableSelect
            value={commodityFilter}
            onChange={setCommodityFilter}
            options={commodities.options}
            placeholder="All commodities\u2026"
          />
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        emptyMessage="No purchase lines yet."
        onRowClick={(row) => {
          const po = orders.find((o) => o.id === row.parentId);
          if (po) setViewing(po);
        }}
      />

      {viewing && can('purchases', 'view') && (
        <PurchaseOrderDetailPanel order={viewing} buyerName={buyerName} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/**
 * Detalle de ventas: todas las lineas vendidas, con su lote de origen.
 */
export function SalesDetailsView() {
  const { can } = useAuth();
  const { data: lines, loading } = useCollection<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const { data: orders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');

  const [search, setSearch] = useState('');
  const [commodityFilter, setCommodityFilter] = useState('');
  const [viewing, setViewing] = useState<SalesOrder | null>(null);

  const buyerName = useMemo(() => {
    const map = new Map(systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]));
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '\u2014');
  }, [systemUsers, legacyUsers]);

  const rows = useMemo(() => {
    const byId = new Map(orders.map((so) => [so.id, so]));
    const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    const term = search.trim().toLowerCase();
    return lines
      .map((line) => {
        const so = byId.get(line.ID_SALESORDER);
        return {
          id: line.id,
          document: so?.SALES_ORDER_NUMBER || '\u2014',
          date: so?.DATE ?? '',
          party: customers.nameOf(so?.ID_CUSTOMER ?? ''),
          lot: lotOf.get(line.ID_PURCHASEORDER) || '\u2014',
          status: so?.STATUS ?? '\u2014',
          commodity: commodities.labelOf(line.ID_COMMODITIES),
          description: line.DESCRIPTION ?? '',
          quantity: round2(line.QUANTITY ?? 0),
          price: line.PRICE ?? 0,
          total: line.TOTAL ?? 0,
          parentId: line.ID_SALESORDER,
        };
      })
      .filter((r) => !commodityFilter || commodities.labelOf(commodityFilter) === r.commodity)
      .filter((r) => !term || [r.document, r.party, r.commodity, r.lot, r.description].join(' ').toLowerCase().includes(term))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.document.localeCompare(a.document));
  }, [lines, orders, purchaseOrders, customers, commodities, commodityFilter, search]);

  const totals = useMemo(
    () => ({
      quantity: round2(rows.reduce((acc, r) => acc + r.quantity, 0)),
      amount: round2(rows.reduce((acc, r) => acc + r.total, 0)),
    }),
    [rows],
  );

  type SalesRow = (typeof rows)[number];
  const columns: Column<SalesRow>[] = [
    { key: 'document', header: '# Sales order', render: (r) => r.document },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'party', header: 'Customer', render: (r) => r.party },
    { key: 'lot', header: 'Lot #', render: (r) => r.lot },
    { key: 'commodity', header: 'Commodity', render: (r) => r.commodity },
    { key: 'status', header: 'Status', render: (r) => r.status },
    { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => r.quantity },
    { key: 'price', header: 'Price', align: 'right', render: (r) => fmtMoney(r.price) },
    { key: 'total', header: 'Total', align: 'right', render: (r) => fmtMoney(r.total) },
  ];

  return (
    <div className="line-details">
      <Toolbar
        title="Sales Details"
        subtitle="Every line item sold, with the lot it came from"
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="line-details__bar">
        <div className="line-details__chips">
          <span className="line-details__chip">{rows.length} lines</span>
          <span className="line-details__chip">Quantity <b className="num">{totals.quantity}</b></span>
          <span className="line-details__chip">Total <b className="num">{fmtMoney(totals.amount)}</b></span>
        </div>
        <div className="line-details__filter">
          <span className="line-details__filter-label">Commodity</span>
          <SearchableSelect
            value={commodityFilter}
            onChange={setCommodityFilter}
            options={commodities.options}
            placeholder="All commodities\u2026"
          />
        </div>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        emptyMessage="No sales lines yet."
        onRowClick={(row) => {
          const so = orders.find((o) => o.id === row.parentId);
          if (so) setViewing(so);
        }}
      />

      {viewing && can('sales', 'view') && (
        <SalesOrderDetailPanel
          order={viewing}
          purchaseOrders={purchaseOrders}
          buyerName={buyerName}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
