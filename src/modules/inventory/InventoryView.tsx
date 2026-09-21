import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { Modal } from '../../components/ui/Modal';
import { SalesOrderDetailPanel } from '../sales/SalesOrderDetailPanel';
import { PurchaseOrderDetailPanel } from '../purchases/PurchaseOrderDetailPanel';
import { SalesDeskView } from '../sales/SalesDeskView';
import { InventoryItemsManager } from './InventoryItemsManager';
import { useInventoryItems } from '../../hooks/useInventoryItems';
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
type BreakdownRow = 'stock' | 'committed' | 'available';

/**
 * Regla de inventario:
 * - Entradas (IN): lineas de Purchase Order.
 * - Salidas reales (OUT): lineas de ordenes de venta ya despachadas (Loaded).
 * - Committed: lineas de ordenes pendientes de cargar, no canceladas.
 * - STOCK = entradas - salidas.  AVAILABLE = STOCK - COMMITTED.
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

/** Porcion de un movimiento que queda (o que sobra) tras aplicar FIFO. */
interface Allocation {
  row: MovementRow;
  qty: number;
}

/** yyyy-mm-dd -> m/d/yyyy (formato de Estados Unidos). */
const fmtDate = (iso: string): string => {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const MINUS = '\u2212';

const byDateAsc = (a: MovementRow, b: MovementRow): number =>
  (a.date ?? '').localeCompare(b.date ?? '') || a.documentNumber.localeCompare(b.documentNumber);

/**
 * FIFO: las salidas consumen primero las entradas mas antiguas.
 * Devuelve lo que queda de cada entrada (el inventario actual, lote por lote)
 * y lo que sobra de las salidas cuando no alcanzo lo comprado (faltante).
 * Las cantidades negativas (creditos) se tratan como movimiento inverso.
 */
function fifo(entries: MovementRow[], exits: MovementRow[]): { remaining: Allocation[]; excess: Allocation[] } {
  const inRows = [
    ...entries.filter((r) => r.quantity > 0),
    ...exits.filter((r) => r.quantity < 0).map((r) => ({ ...r, quantity: -r.quantity })),
  ].sort(byDateAsc);
  const outRows = [
    ...exits.filter((r) => r.quantity > 0),
    ...entries.filter((r) => r.quantity < 0).map((r) => ({ ...r, quantity: -r.quantity })),
  ].sort(byDateAsc);

  const queue = inRows.map((row) => ({ row, qty: row.quantity }));
  const excess: Allocation[] = [];
  let cursor = 0;
  for (const exit of outRows) {
    let need = exit.quantity;
    while (need > 0 && cursor < queue.length) {
      const take = Math.min(queue[cursor].qty, need);
      queue[cursor].qty = round2(queue[cursor].qty - take);
      need = round2(need - take);
      if (queue[cursor].qty <= 0) cursor += 1;
    }
    if (need > 0) excess.push({ row: exit, qty: need });
  }
  return { remaining: queue.filter((a) => a.qty > 0), excess };
}

/** Exporta el reporte de movimientos a Excel con el formato de marca. */
async function exportMovements(rows: MovementRow[], commodityName: (id: string) => string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Movements');
  const headers = ['Date', 'Type', 'Lot # / Order #', 'Commodity', 'Description', 'From / To', 'Quantity'];

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
  /* Productos que llevan inventario (los servicios/cargos quedan fuera). */
  const { tracksInventory } = useInventoryItems();
  const [itemsOpen, setItemsOpen] = useState(false);

  const [tab, setTab] = useState<InventoryTab>('stock');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MovementType>('all');
  const [commodityFilter, setCommodityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /* Detalle abierto dentro de la vista de inventario (sin salir de ella). */
  const [viewingSale, setViewingSale] = useState<SalesOrder | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseOrder | null>(null);
  /* Desglose: producto y fila (stock / committed / available) que se explica. */
  const [breakdown, setBreakdown] = useState<{ commodityId: string; row: BreakdownRow } | null>(null);

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
  /**
   * Una venta ya salio del almacen cuando esta palomeada como Loaded O cuando
   * su estado ya paso de "pendiente de carga" (Loaded / Delivered / Paid).
   */
  const isLoaded = (id: string): boolean => {
    const so = salesById.get(id);
    if (!so) return false;
    return !!so.LOADED || so.STATUS === 'Loaded' || so.STATUS === 'Delivered' || so.STATUS === 'Paid';
  };

  /** Entradas: cada linea de Purchase Order es un ingreso al inventario. */
  const inRows = useMemo<MovementRow[]>(() => {
    const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
    return purchaseDetails
      .filter((line) => line.ID_COMMODITIES && tracksInventory(line.ID_COMMODITIES))
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
  }, [purchaseDetails, purchaseOrders, growers, tracksInventory]);

  const toSaleRow = (line: SalesOrderDetail, prefix: string): MovementRow => {
    const so = salesById.get(line.ID_SALESORDER);
    return {
      id: `${prefix}-${line.id}`,
      type: 'out',
      sourceId: line.ID_SALESORDER,
      date: so?.DATE ?? '',
      documentNumber: so?.SALES_ORDER_NUMBER || '(no order #)',
      commodityId: line.ID_COMMODITIES,
      description: line.DESCRIPTION ?? '',
      party: customers.nameOf(so?.ID_CUSTOMER ?? ''),
      quantity: round2(line.QUANTITY ?? 0),
    };
  };

  /** Salidas reales: lineas de ordenes ya despachadas. */
  const shippedRows = useMemo<MovementRow[]>(
    () =>
      salesDetails
        .filter(
          (line) =>
            line.ID_COMMODITIES &&
            tracksInventory(line.ID_COMMODITIES) &&
            !isCancelled(line.ID_SALESORDER) &&
            isLoaded(line.ID_SALESORDER),
        )
        .map((line) => toSaleRow(line, 'out')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesDetails, salesById, customers, tracksInventory],
  );

  /** Reservado: lineas de ordenes pendientes de cargar, no canceladas. */
  const committedRows = useMemo<MovementRow[]>(
    () =>
      salesDetails
        .filter(
          (line) =>
            line.ID_COMMODITIES &&
            tracksInventory(line.ID_COMMODITIES) &&
            !isCancelled(line.ID_SALESORDER) &&
            !isLoaded(line.ID_SALESORDER),
        )
        .map((line) => toSaleRow(line, 'com')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salesDetails, salesById, customers, tracksInventory],
  );

  /* ---- Resumen de stock por producto ---- */
  const stockRows = useMemo(() => {
    const totals = new Map<string, { stock: number; committed: number }>();
    const entry = (id: string) => totals.get(id) ?? { stock: 0, committed: 0 };
    for (const row of inRows) {
      const e = entry(row.commodityId);
      e.stock = round2(e.stock + row.quantity);
      totals.set(row.commodityId, e);
    }
    for (const row of shippedRows) {
      const e = entry(row.commodityId);
      e.stock = round2(e.stock - row.quantity);
      totals.set(row.commodityId, e);
    }
    for (const row of committedRows) {
      const e = entry(row.commodityId);
      e.committed = round2(e.committed + row.quantity);
      totals.set(row.commodityId, e);
    }
    const term = search.trim().toLowerCase();
    return [...totals.entries()]
      .map(([commodityId, e]) => ({
        commodityId,
        name: commodities.labelOf(commodityId),
        stock: e.stock,
        committed: e.committed,
        available: round2(e.stock - e.committed),
      }))
      /* Sin stock ni comprometido: el producto no aparece. */
      .filter((row) => row.stock !== 0 || row.committed !== 0)
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inRows, shippedRows, committedRows, commodities, search]);

  const stockTotals = useMemo(
    () => ({
      stock: round2(stockRows.reduce((acc, r) => acc + r.stock, 0)),
      committed: round2(stockRows.reduce((acc, r) => acc + r.committed, 0)),
      available: round2(stockRows.reduce((acc, r) => acc + r.available, 0)),
    }),
    [stockRows],
  );

  /* ---- Reporte de movimientos: entradas + salidas despachadas ---- */
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
          [row.documentNumber, commodities.labelOf(row.commodityId), row.description, row.party]
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

  /* Tabs Stock/Movements: se dibujan a la derecha de la fila de chips. */
  const tabsControl = (
    <div className="inventory__tabs">
      <button
        type="button"
        className={`inventory__tab${(tab as InventoryTab) === 'stock' ? ' inventory__tab--active' : ''}`}
        onClick={() => setTab('stock')}
      >
        Stock
      </button>
      <button
        type="button"
        className={`inventory__tab${(tab as InventoryTab) === 'movements' ? ' inventory__tab--active' : ''}`}
        onClick={() => setTab('movements')}
      >
        Movements (In / Out)
      </button>
    </div>
  );

  /** Celda del pivote clickeable: abre el desglose del numero. */
  const pivotButton = (commodityId: string, row: BreakdownRow, value: number, hint: string) => (
    <button
      type="button"
      className="inventory__pivot-btn"
      onClick={() => setBreakdown({ commodityId, row })}
      title={hint}
    >
      {fmtQty(value)}
    </button>
  );

  /* ---- Modal de desglose (FIFO) ---- */
  const renderBreakdown = () => {
    if (!breakdown) return null;
    const { commodityId, row: kind } = breakdown;
    const summary = stockRows.find((r) => r.commodityId === commodityId);
    const entries = inRows.filter((r) => r.commodityId === commodityId);
    const shipped = shippedRows.filter((r) => r.commodityId === commodityId);
    const reserved = committedRows.filter((r) => r.commodityId === commodityId);
    const sumOf = (list: Allocation[]): number => round2(list.reduce((acc, a) => acc + a.qty, 0));

    const kindLabel = kind === 'stock' ? 'Stock' : kind === 'committed' ? 'Committed' : 'Available';
    const title = `${commodities.labelOf(commodityId)} \u2014 ${kindLabel}`;

    /* Stock: las ventas despachadas consumen los lotes mas antiguos primero.
       Available: ademas consumen las ordenes pendientes (committed). */
    const result =
      kind === 'stock'
        ? fifo(entries, shipped)
        : kind === 'available'
          ? fifo(entries, [...shipped, ...reserved])
          : { remaining: [] as Allocation[], excess: [] as Allocation[] };

    const docLink = (item: MovementRow) => (
      <button
        type="button"
        className="inventory__doclink"
        onClick={() => {
          openDocument(item);
          setBreakdown(null);
        }}
      >
        {item.documentNumber}
      </button>
    );

    const lotsTable = (label: string, list: Allocation[], qtyHeader: string) => (
      <div className="inventory__bd-block">
        <div className="inventory__bd-head">
          <span className="inventory__bd-title">{label}</span>
          <span className="inventory__bd-sum inventory__bd-sum--in">{fmtQty(sumOf(list))}</span>
        </div>
        {list.length === 0 ? (
          <p className="inventory__bd-empty">No lots left for this product.</p>
        ) : (
          <table className="inventory__bd-table">
            <thead>
              <tr>
                <th className="inventory__bd-th">Lot #</th>
                <th className="inventory__bd-th">Arrival</th>
                <th className="inventory__bd-th">Grower</th>
                <th className="inventory__bd-th inventory__bd-th--num">Received</th>
                <th className="inventory__bd-th inventory__bd-th--num">{qtyHeader}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.row.id}>
                  <td className="inventory__bd-td">{docLink(a.row)}</td>
                  <td className="inventory__bd-td inventory__bd-td--muted">{fmtDate(a.row.date)}</td>
                  <td className="inventory__bd-td">{a.row.party || '\u2014'}</td>
                  <td className="inventory__bd-td inventory__bd-td--num inventory__bd-td--muted">{fmtQty(a.row.quantity)}</td>
                  <td className="inventory__bd-td inventory__bd-td--num">{fmtQty(a.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );

    const salesTable = (label: string, list: Allocation[], qtyHeader: string, tone: 'out' | 'bad') => (
      <div className="inventory__bd-block">
        <div className="inventory__bd-head">
          <span className="inventory__bd-title">{label}</span>
          <span className={`inventory__bd-sum inventory__bd-sum--${tone}`}>
            {MINUS}
            {fmtQty(sumOf(list))}
          </span>
        </div>
        {list.length === 0 ? (
          <p className="inventory__bd-empty">Nothing here.</p>
        ) : (
          <table className="inventory__bd-table">
            <thead>
              <tr>
                <th className="inventory__bd-th"># Sales order</th>
                <th className="inventory__bd-th">Date</th>
                <th className="inventory__bd-th">Customer</th>
                <th className="inventory__bd-th inventory__bd-th--num">{qtyHeader}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.row.id}>
                  <td className="inventory__bd-td">{docLink(a.row)}</td>
                  <td className="inventory__bd-td inventory__bd-td--muted">{fmtDate(a.row.date)}</td>
                  <td className="inventory__bd-td">{a.row.party || '\u2014'}</td>
                  <td className="inventory__bd-td inventory__bd-td--num">
                    {MINUS}
                    {fmtQty(a.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );

    const value = kind === 'stock' ? summary?.stock ?? 0 : kind === 'committed' ? summary?.committed ?? 0 : summary?.available ?? 0;
    const negative = value < 0;

    return (
      <Modal title={title} open onClose={() => setBreakdown(null)} wide confirmOnClose={false}>
        <div className="inventory__bd">
          <div className={`inventory__bd-formula${negative ? ' inventory__bd-formula--bad' : ''}`}>
            {kind === 'stock' && (
              <>
                <span>Purchased <b>{fmtQty(round2(entries.reduce((acc, r) => acc + r.quantity, 0)))}</b></span>
                <span className="inventory__bd-op">{MINUS}</span>
                <span>Shipped <b>{fmtQty(round2(shipped.reduce((acc, r) => acc + r.quantity, 0)))}</b></span>
                <span className="inventory__bd-op">=</span>
                <span>Stock <b>{fmtQty(summary?.stock ?? 0)}</b></span>
              </>
            )}
            {kind === 'committed' && (
              <>
                <span>Sales orders pending to load</span>
                <span className="inventory__bd-op">=</span>
                <span>Committed <b>{fmtQty(summary?.committed ?? 0)}</b></span>
              </>
            )}
            {kind === 'available' && (
              <>
                <span>Stock <b>{fmtQty(summary?.stock ?? 0)}</b></span>
                <span className="inventory__bd-op">{MINUS}</span>
                <span>Committed <b>{fmtQty(summary?.committed ?? 0)}</b></span>
                <span className="inventory__bd-op">=</span>
                <span>Available <b>{fmtQty(summary?.available ?? 0)}</b></span>
              </>
            )}
          </div>

          {kind !== 'committed' && (
            <p className="inventory__bd-note">
              {negative
                ? kind === 'stock'
                  ? 'More was shipped than purchased. These are the sales that go beyond the purchased quantity (oldest lots are used first).'
                  : 'More is sold than there is in stock. These are the orders that go beyond what is on hand (oldest lots are used first).'
                : kind === 'stock'
                  ? 'Only the lots that make up the current stock are listed. Sales use the oldest lots first (FIFO).'
                  : 'Only the lots still available after shipped and pending orders are listed (FIFO: oldest lots first).'}
            </p>
          )}

          {kind === 'stock' && !negative && lotsTable(`Lots in stock (${result.remaining.length})`, result.remaining, 'In stock')}
          {kind === 'available' && !negative && lotsTable(`Available lots (${result.remaining.length})`, result.remaining, 'Available')}

          {kind === 'stock' && negative && salesTable(`Sales over stock (${result.excess.length})`, result.excess, 'Short', 'bad')}
          {kind === 'available' && negative && salesTable(`Orders over stock (${result.excess.length})`, result.excess, 'Short', 'bad')}

          {kind === 'committed' &&
            salesTable(
              `Pending to load (${reserved.length})`,
              reserved.map((row) => ({ row, qty: row.quantity })),
              'Quantity',
              'out',
            )}
        </div>
      </Modal>
    );
  };

  return (
    <div className="inventory">
      {/* Bloque de inventario: sticky bajo el topbar mientras Sales Desk scrollea debajo. */}
      <div className="inventory__sticky">
        <Toolbar
          title="Inventory"
          subtitle="Purchase Orders add stock, Sales Desk subtracts it"
          searchValue={search}
          onSearchChange={setSearch}
        >
          <button type="button" className="btn btn--secondary" onClick={() => setItemsOpen(true)}>
            Inventory products
          </button>
          {tab === 'movements' && can('inventory', 'documents') && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void exportMovements(movementRows, commodities.labelOf)}
            >
              Export Excel
            </button>
          )}
        </Toolbar>

        {tab === 'stock' && (
          <>
            <div className="inventory__bar">
              <div className="inventory__chips">
                <span className="inventory__chip">{stockRows.length} products</span>
                <span className="inventory__chip">Stock <b className="num">{fmtQty(stockTotals.stock)}</b></span>
                <span className="inventory__chip">Committed <b className="num">{fmtQty(stockTotals.committed)}</b></span>
                <span className={`inventory__chip${stockTotals.available < 0 ? ' inventory__chip--bad' : ' inventory__chip--ok'}`}>
                  Available <b className="num">{fmtQty(stockTotals.available)}</b>
                </span>
              </div>
              {tabsControl}
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
                        <td key={row.commodityId} className={`inventory__pivot-cell${row.stock < 0 ? ' inventory__pivot-cell--bad' : ''}`}>
                          {pivotButton(row.commodityId, 'stock', row.stock, 'See which lots make up this stock')}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="inventory__pivot-label">COMMITTED</td>
                      {stockRows.map((row) => (
                        <td key={row.commodityId} className="inventory__pivot-cell inventory__pivot-cell--muted">
                          {row.committed !== 0
                            ? pivotButton(row.commodityId, 'committed', row.committed, 'See which orders reserve this product')
                            : ''}
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
                          {pivotButton(row.commodityId, 'available', row.available, 'See which lots are available')}
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
                  <option value="out">Out (shipped sales)</option>
                </select>
              </div>
              <div className="inventory__filter inventory__filter--wide">
                <span className="inventory__filter-label">Commodity</span>
                <SearchableSelect
                  value={commodityFilter}
                  onChange={setCommodityFilter}
                  options={commodityOptions}
                  placeholder="All commodities…"
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

            <div className="inventory__bar">
              <div className="inventory__chips">
                <span className="inventory__chip">{movementRows.length} movements</span>
                <span className="inventory__chip inventory__chip--ok">In <b className="num">{fmtQty(movementTotals.totalIn)}</b></span>
                <span className="inventory__chip inventory__chip--bad">Out <b className="num">{fmtQty(movementTotals.totalOut)}</b></span>
                <span className="inventory__chip">Net <b className="num">{fmtQty(movementTotals.net)}</b></span>
              </div>
              {tabsControl}
            </div>

            <div className="inventory__card">
              <table className="inventory__table">
                <thead>
                  <tr>
                    <th className="inventory__th">Date</th>
                    <th className="inventory__th">Type</th>
                    <th className="inventory__th">Lot # / Order #</th>
                    <th className="inventory__th">Commodity</th>
                    <th className="inventory__th">Description</th>
                    <th className="inventory__th">From / To</th>
                    <th className="inventory__th inventory__th--num">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {movementRows.length === 0 && (
                    <tr><td className="inventory__empty" colSpan={7}>No movements match the current filters.</td></tr>
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
                      <td className="inventory__td inventory__td--strong">{commodities.labelOf(row.commodityId)}</td>
                      <td className="inventory__td inventory__td--muted">{row.description || '\u2014'}</td>
                      <td className="inventory__td">{row.party || '\u2014'}</td>
                      <td className={`inventory__td inventory__td--num inventory__qty--${row.type}`}>
                        {row.type === 'in' ? '+' : MINUS}
                        {fmtQty(row.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Sales Desk siempre debajo del inventario, scrolleable con la pagina. */}
      <section className="inventory__sales">
        <SalesDeskView />
      </section>

      {renderBreakdown()}

      <InventoryItemsManager
        open={itemsOpen}
        onClose={() => setItemsOpen(false)}
        canEdit={can('inventory', 'edit') || can('catalogs', 'edit')}
      />

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
