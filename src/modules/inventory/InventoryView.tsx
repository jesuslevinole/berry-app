import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { PurchaseOrderDetailPanel } from '../purchases/PurchaseOrderDetailPanel';
import { round2, todayISO } from '../../utils/format';
import {
  COLLECTIONS,
  type PurchaseDetail,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
  type SystemUser,
} from '../../types/models';
import './InventoryView.css';

type InventoryTab = 'stock' | 'movements';
type MovementType = 'all' | 'in' | 'out';

/**
 * Regla de inventario (corregida):
 * - Entradas (IN): lineas de Purchase Order.
 * - Salidas reales (OUT): lineas de ordenes de venta CARGADAS (Loaded palomeado) — descuentan STOCK.
 * - Committed: lineas de ordenes NO cargadas y no canceladas — reservadas, siguen en almacen.
 * - STOCK = entradas - salidas cargadas.  AVAILABLE = STOCK - COMMITTED.
 */
interface MovementRow {
  id: string;
  type: 'in' | 'out';
  /** Id del documento origen (Purchase Order o Sales Order) para abrir su detalle. */
  sourceId: string;
  date: string;
  documentNumber: string;
  commodityId: string;
  description: string;
  party: string;
  quantity: number;
}

const fmtDate = (iso: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

const fmtQty = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Exporta el reporte de movimientos a Excel con el formato de marca. */
async function exportMovements(rows: MovementRow[], commodityName: (id: string) => string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Movements');
  const headers = ['Date', 'Type', 'Document', 'Commodity', 'Description', 'From / To', 'Quantity'];

  const titleRow = sheet.getRow(1);
  titleRow.getCell(1).value = 'Inventory Movements';
  titleRow.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1F7A4D' } };
  sheet.mergeCells(1, 1, 1, headers.length);

  const dateRow = sheet.getRow(2);
  dateRow.getCell(1).value = `Generated: ${new Date().toLocaleString('en-US')}`;
  dateRow.getCell(1).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(2, 1, 2, headers.length);

  const headerRow = sheet.getRow(4);
  headers.forEach((header, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = header;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7A4D' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  rows.forEach((row, r) => {
    const excelRow = sheet.getRow(5 + r);
    const values: (string | number)[] = [
      fmtDate(row.date),
      row.type === 'in' ? 'IN' : 'OUT',
      row.documentNumber,
      commodityName(row.commodityId),
      row.description,
      row.party,
      row.type === 'in' ? row.quantity : -row.quantity,
    ];
    values.forEach((value, c) => {
      excelRow.getCell(c + 1).value = value;
    });
  });

  headers.forEach((_, i) => {
    sheet.getColumn(i + 1).width = i === 3 || i === 5 ? 26 : 14;
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventory-movements-${todayISO()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export function InventoryView() {
  const { can } = useAuth();
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: purchaseDetails } = useCollection<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: salesDetails } = useCollection<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const [tab, setTab] = useState<InventoryTab>('stock');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MovementType>('all');
  const [commodityFilter, setCommodityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /* Detalle abierto dentro de la vista de inventario (sin salir de ella). */
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseOrder | null>(null);

  /** Resuelve salesperson: usuarios del sistema primero, catalogo legado despues. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
    return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '\u2014');
  }, [systemUsers, legacyUsers]);

  /** Abre el detalle del documento origen dentro de esta misma vista. */
  const openDocument = (row: MovementRow) => {
    if (row.type === 'in') {
      const po = purchaseOrders.find((p) => p.id === row.sourceId);
      if (po) setViewingPurchase(po);
    } else {
      const so = salesOrders.find((o) => o.id === row.sourceId);
      if (so) setViewingSale(so);
    }
  };

  /* Clasificacion de ordenes de venta por su estado real de inventario. */
  const salesById = useMemo(() => new Map(salesOrders.map((so) => [so.id, so])), [salesOrders]);
  const isCancelled = (id: string): boolean => salesById.get(id)?.STATUS === 'Cancelled';
  const isLoaded = (id: string): boolean => !!salesById.get(id)?.LOADED;

  /** Entradas: cada linea de Purchase Order es un ingreso al inventario. */
  const inRows = useMemo<MovementRow[]>(() => {
    const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
    return purchaseDetails
      .filter((line) => line.ID_COMMODITIES)
      .map((line) => {
        const po = poById.get(line.ID_PURCHASEORDER);
        return {
          id: `in-${line.id}`,
          type: 'in' as const,
          sourceId: line.ID_PURCHASEORDER,
          date: po?.ARRIVAL_DATE ?? '',
          documentNumber: po?.LOT_NUMBER || po?.REF_NUMBER || '(no lot #)',
          commodityId: line.ID_COMMODITIES,
          description: line.DESCRIPTION ?? '',
          party: growers.nameOf(po?.ID_GROWER ?? ''),
          quantity: round2(line.QUANTITY ?? 0),
        };
      });
  }, [purchaseDetails, purchaseOrders, growers]);

  /** Salidas reales: lineas de ordenes CARGADAS (Loaded). Ya no estan en el almacen. */
  const shippedRows = useMemo<MovementRow[]>(
    () =>
      salesDetails
        .filter((line) => line.ID_COMMODITIES && !isCancelled(line.ID_SALESORDER) && isLoaded(line.ID_SALESORDER))
        .map((line) => {
          const so = salesById.get(line.ID_SALESORDER);
          return {
            id: `out-${line.id}`,
            type: 'out' as const,
            sourceId: line.ID_SALESORDER,
            date: so?.DATE ?? '',
            documentNumber: so?.SALES_ORDER_NUMBER || '(no order #)',
            commodityId: line.ID_COMMODITIES,
            description: line.DESCRIPTION ?? '',
            party: customers.nameOf(so?.ID_CUSTOMER ?? ''),
            quantity: round2(line.QUANTITY ?? 0),
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesDetails, salesById, customers],
  );

  /** Reservado: lineas de ordenes NO cargadas (pendientes) y no canceladas. */
  const committedByCommodity = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of salesDetails) {
      if (!line.ID_COMMODITIES || isCancelled(line.ID_SALESORDER) || isLoaded(line.ID_SALESORDER)) continue;
      totals.set(line.ID_COMMODITIES, round2((totals.get(line.ID_COMMODITIES) ?? 0) + (line.QUANTITY ?? 0)));
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesDetails, salesById]);

  /* ---- Resumen de stock por producto ---- */
  const stockRows = useMemo(() => {
    const totals = new Map<string, { stock: number; committed: number }>();
    for (const row of inRows) {
      const entry = totals.get(row.commodityId) ?? { stock: 0, committed: 0 };
      entry.stock = round2(entry.stock + row.quantity);
      totals.set(row.commodityId, entry);
    }
    /* Las ordenes cargadas ya salieron: descuentan el stock fisico. */
    for (const row of shippedRows) {
      const entry = totals.get(row.commodityId) ?? { stock: 0, committed: 0 };
      entry.stock = round2(entry.stock - row.quantity);
      totals.set(row.commodityId, entry);
    }
    for (const [commodityId, committed] of committedByCommodity) {
      const entry = totals.get(commodityId) ?? { stock: 0, committed: 0 };
      entry.committed = committed;
      totals.set(commodityId, entry);
    }
    const term = search.trim().toLowerCase();
    return [...totals.entries()]
      .map(([commodityId, entry]) => ({
        commodityId,
        name: commodities.nameOf(commodityId),
        stock: entry.stock,
        committed: entry.committed,
        available: round2(entry.stock - entry.committed),
      }))
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inRows, shippedRows, committedByCommodity, commodities, search]);

  const stockTotals = useMemo(
    () => ({
      stock: round2(stockRows.reduce((acc, r) => acc + r.stock, 0)),
      committed: round2(stockRows.reduce((acc, r) => acc + r.committed, 0)),
      available: round2(stockRows.reduce((acc, r) => acc + r.available, 0)),
    }),
    [stockRows],
  );

  /* ---- Reporte de movimientos: entradas + salidas cargadas ---- */
  const movementRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...inRows, ...shippedRows]
      .filter((row) => typeFilter === 'all' || row.type === typeFilter)
      .filter((row) => !commodityFilter || row.commodityId === commodityFilter)
      .filter((row) => !dateFrom || (row.date && row.date >= dateFrom))
      .filter((row) => !dateTo || (row.date && row.date <= dateTo))
      .filter(
        (row) =>
          !term ||
          [row.documentNumber, commodities.nameOf(row.commodityId), row.description, row.party]
            .join(' ')
            .toLowerCase()
            .includes(term),
      )
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.documentNumber.localeCompare(b.documentNumber));
  }, [inRows, shippedRows, typeFilter, commodityFilter, dateFrom, dateTo, search, commodities]);

  const movementTotals = useMemo(() => {
    const totalIn = round2(movementRows.filter((r) => r.type === 'in').reduce((acc, r) => acc + r.quantity, 0));
    const totalOut = round2(movementRows.filter((r) => r.type === 'out').reduce((acc, r) => acc + r.quantity, 0));
    return { totalIn, totalOut, net: round2(totalIn - totalOut) };
  }, [movementRows]);

  const commodityOptions = useMemo(
    () => [...commodities.options].sort((a, b) => a.name.localeCompare(b.name)),
    [commodities.options],
  );

  return (
    <div className="inventory">
      <Toolbar
        title="Inventory"
        subtitle="Entries from Purchase Orders, exits from loaded Sales Orders"
        searchValue={search}
        onSearchChange={setSearch}
      >
        {tab === 'movements' && can('inventory', 'documents') && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void exportMovements(movementRows, commodities.nameOf)}
          >
            Export Excel
          </button>
        )}
      </Toolbar>

      <div className="inventory__tabs">
        <button
          type="button"
          className={`inventory__tab${tab === 'stock' ? ' inventory__tab--active' : ''}`}
          onClick={() => setTab('stock')}
        >
          Stock
        </button>
        <button
          type="button"
          className={`inventory__tab${tab === 'movements' ? ' inventory__tab--active' : ''}`}
          onClick={() => setTab('movements')}
        >
          Movements (In / Out)
        </button>
      </div>

      {tab === 'stock' && (
        <>
          <div className="inventory__chips">
            <span className="inventory__chip">{stockRows.length} products</span>
            <span className="inventory__chip">Stock <b className="num">{fmtQty(stockTotals.stock)}</b></span>
            <span className="inventory__chip">Committed <b className="num">{fmtQty(stockTotals.committed)}</b></span>
            <span className={`inventory__chip${stockTotals.available < 0 ? ' inventory__chip--bad' : ' inventory__chip--ok'}`}>
              Available <b className="num">{fmtQty(stockTotals.available)}</b>
            </span>
          </div>

          <div className="inventory__card">
            {stockRows.length === 0 ? (
              <div className="inventory__empty">No inventory movements yet. Register purchase orders to build stock.</div>
            ) : (
              <table className="inventory__pivot">
                <thead>
                  <tr>
                    <th className="inventory__pivot-corner">Inventory</th>
                    {stockRows.map((row) => (
                      <th key={row.commodityId} className="inventory__pivot-head">{row.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="inventory__pivot-label">STOCK</td>
                    {stockRows.map((row) => (
                      <td key={row.commodityId} className="inventory__pivot-cell">{fmtQty(row.stock)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="inventory__pivot-label">COMMITTED</td>
                    {stockRows.map((row) => (
                      <td key={row.commodityId} className="inventory__pivot-cell inventory__pivot-cell--muted">
                        {row.committed !== 0 ? fmtQty(row.committed) : ''}
                      </td>
                    ))}
                  </tr>
                  <tr className="inventory__pivot-row--available">
                    <td className="inventory__pivot-label inventory__pivot-label--available">AVAILABLE</td>
                    {stockRows.map((row) => (
                      <td
                        key={row.commodityId}
                        className={`inventory__pivot-cell inventory__pivot-cell--available${row.available < 0 ? ' inventory__pivot-cell--bad' : row.available === 0 ? ' inventory__pivot-cell--zero' : ''}`}
                      >
                        {fmtQty(row.available)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="inventory__filters">
            <div className="inventory__filter">
              <span className="inventory__filter-label">Type</span>
              <select
                className="input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as MovementType)}
              >
                <option value="all">All movements</option>
                <option value="in">In (purchases)</option>
                <option value="out">Out (loaded sales)</option>
              </select>
            </div>
            <div className="inventory__filter inventory__filter--wide">
              <span className="inventory__filter-label">Commodity</span>
              <SearchableSelect
                value={commodityFilter}
                onChange={setCommodityFilter}
                options={commodityOptions}
                placeholder="All commodities\u2026"
              />
            </div>
            <div className="inventory__filter">
              <span className="inventory__filter-label">From</span>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="inventory__filter">
              <span className="inventory__filter-label">To</span>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className="inventory__chips">
            <span className="inventory__chip">{movementRows.length} movements</span>
            <span className="inventory__chip inventory__chip--ok">In <b className="num">{fmtQty(movementTotals.totalIn)}</b></span>
            <span className="inventory__chip inventory__chip--bad">Out <b className="num">{fmtQty(movementTotals.totalOut)}</b></span>
            <span className="inventory__chip">Net <b className="num">{fmtQty(movementTotals.net)}</b></span>
          </div>

          <div className="inventory__card">
            <table className="inventory__table">
              <thead>
                <tr>
                  <th className="inventory__th">Date</th>
                  <th className="inventory__th">Type</th>
                  <th className="inventory__th">Document</th>
                  <th className="inventory__th">Commodity</th>
                  <th className="inventory__th">Description</th>
                  <th className="inventory__th">From / To</th>
                  <th className="inventory__th inventory__th--num">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {movementRows.length === 0 && (
                  <tr><td className="inventory__empty" colSpan={7}>No movements match the current filters. Loaded sales orders appear here as exits.</td></tr>
                )}
                {movementRows.map((row) => (
                  <tr key={row.id}>
                    <td className="inventory__td inventory__td--muted">{fmtDate(row.date)}</td>
                    <td className="inventory__td">
                      <span className={`inventory__badge inventory__badge--${row.type}`}>
                        {row.type === 'in' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="inventory__td inventory__td--mono">
                      <button
                        type="button"
                        className="inventory__doclink"
                        onClick={() => openDocument(row)}
                        title={row.type === 'in' ? 'Open purchase order detail' : 'Open sales order detail'}
                      >
                        {row.documentNumber}
                      </button>
                    </td>
                    <td className="inventory__td inventory__td--strong">{commodities.nameOf(row.commodityId)}</td>
                    <td className="inventory__td inventory__td--muted">{row.description || '\u2014'}</td>
                    <td className="inventory__td">{row.party || '\u2014'}</td>
                    <td className={`inventory__td inventory__td--num inventory__qty--${row.type}`}>
                      {row.type === 'in' ? '+' : '\u2212'}{fmtQty(row.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewingSale && (
        <SalesOrderDetailPanel
          order={viewingSale}
          purchaseOrders={purchaseOrders}
          buyerName={buyerName}
          onClose={() => setViewingSale(null)}
        />
      )}

      {viewingPurchase && (
        <PurchaseOrderDetailPanel
          order={viewingPurchase}
          buyerName={buyerName}
          onClose={() => setViewingPurchase(null)}
        />
      )}
    </div>
  );
}
