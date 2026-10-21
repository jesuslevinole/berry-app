import { useMemo, useState } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { useAuth } from '../../context/AuthContext';
import { Toolbar } from '../../components/ui/Toolbar';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { useColumnVisibility, type ColumnOption } from '../../hooks/useColumnVisibility';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PURCHASES_SCHEMAS } from '../../config/entitySchemas';
import { fmtMoney, round2 } from '../../utils/format';
import {
  COLLECTIONS,
  type PurchaseDetail,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
} from '../../types/models';
import './LotActivityView.css';

const STATUS_CLASS: Record<string, string> = {
  Draft: 'draft',
  Loaded: 'loaded',
  Delivered: 'delivered',
  Paid: 'paid',
  Cancelled: 'cancelled',
};

/* Columnas que el usuario puede ocultar con "Columns" en cada tabla. */
const PURCHASE_COLUMNS: ColumnOption[] = [
  { key: 'commodity', label: 'Commodity' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'price', label: 'Price' },
  { key: 'total', label: 'Total' },
];

const SALES_COLUMNS: ColumnOption[] = [
  { key: 'commodity', label: 'Commodity' },
  { key: 'description', label: 'Description' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'price', label: 'Price' },
  { key: 'total', label: 'Total' },
];

export function LotActivityView() {
  const { can } = useAuth();
  const purchaseColumns = useColumnVisibility('lot-activity-purchase', PURCHASE_COLUMNS);
  const salesColumns = useColumnVisibility('lot-activity-sales', SALES_COLUMNS);
  const showPurchase = purchaseColumns.isVisible;
  const showSales = salesColumns.isVisible;
  /* El rotulo del pie ocupa las columnas de texto visibles (sin ellas, no hay rotulo). */
  const purchaseLabelSpan = showPurchase('commodity') ? 1 : 0;
  const salesLabelSpan = (showSales('commodity') ? 1 : 0) + (showSales('description') ? 1 : 0);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: purchaseDetails } = useCollection<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: salesDetails } = useCollection<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { lineDescription } = useInventoryItems();
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');

  const [lotId, setLotId] = useState('');

  /* Lots ordenados del mas reciente al mas antiguo, con vendor en la etiqueta. */
  const lotOptions = useMemo(
    () =>
      [...purchaseOrders]
        .sort((a, b) => (b.LOT_NUMBER ?? '').localeCompare(a.LOT_NUMBER ?? ''))
        .map((po) => ({
          id: po.id,
          name: `${po.LOT_NUMBER || '(no lot #)'} — ${customers.nameOf(po.ID_CUSTOMER)}`,
        })),
    [purchaseOrders, customers],
  );

  const lot = useMemo(() => purchaseOrders.find((po) => po.id === lotId) ?? null, [purchaseOrders, lotId]);

  const lotPurchaseLines = useMemo(
    () => purchaseDetails.filter((d) => d.ID_PURCHASEORDER === lotId),
    [purchaseDetails, lotId],
  );

  /* Ordenes canceladas no cuentan como vendidas (misma regla que Inventory). */
  const lotSalesLines = useMemo(() => {
    const cancelled = new Set(salesOrders.filter((so) => so.STATUS === 'Cancelled').map((so) => so.id));
    return salesDetails.filter((d) => d.ID_PURCHASEORDER === lotId && !cancelled.has(d.ID_SALESORDER));
  }, [salesDetails, salesOrders, lotId]);

  /* Ventas agrupadas por orden de venta, mas recientes primero. */
  const salesGroups = useMemo(() => {
    const byOrder = new Map<string, SalesOrderDetail[]>();
    for (const line of lotSalesLines) {
      const list = byOrder.get(line.ID_SALESORDER) ?? [];
      list.push(line);
      byOrder.set(line.ID_SALESORDER, list);
    }
    return [...byOrder.entries()]
      .map(([orderId, lines]) => ({
        order: salesOrders.find((so) => so.id === orderId) ?? null,
        orderId,
        lines,
        qty: round2(lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0)),
        total: round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0)),
      }))
      .sort((a, b) => (b.order?.DATE ?? '').localeCompare(a.order?.DATE ?? ''));
  }, [lotSalesLines, salesOrders]);

  /* KPIs del lote */
  const purchasedQty = useMemo(
    () => round2(lotPurchaseLines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0)),
    [lotPurchaseLines],
  );
  const purchasedTotal = useMemo(
    () => round2(lotPurchaseLines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0)),
    [lotPurchaseLines],
  );
  const soldQty = useMemo(
    () => round2(lotSalesLines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0)),
    [lotSalesLines],
  );
  const soldTotal = useMemo(
    () => round2(lotSalesLines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0)),
    [lotSalesLines],
  );
  const availableQty = round2(purchasedQty - soldQty);
  const margin = round2(soldTotal - purchasedTotal);
  const marginPercent = purchasedTotal > 0 ? round2((margin / purchasedTotal) * 100) : 0;

  const availabilityClass =
    availableQty > 0 ? 'ok' : availableQty === 0 ? 'neutral' : 'bad';

  const fmtDate = (iso: string): string => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
  };

  return (
    <div className="lot-activity">
      <Toolbar title="Lot Activity" subtitle="Purchases, sales and availability per lot">
        {can('lots', 'documents') && <DataPortButtons schemas={PURCHASES_SCHEMAS} fileName="lot-activity" />}
      </Toolbar>

      <div className="lot-activity__filter-card">
        <div className="lot-activity__filter-field">
          <span className="lot-activity__filter-label">Lot #</span>
          <SearchableSelect
            value={lotId}
            onChange={setLotId}
            options={lotOptions}
            placeholder="Search a lot…"
          />
        </div>

        {lot && (
          <div className="lot-activity__meta">
            <div className="lot-activity__meta-item">
              <span className="lot-activity__meta-label">Vendor</span>
              <span className="lot-activity__meta-value">{customers.nameOf(lot.ID_CUSTOMER)}</span>
            </div>
            <div className="lot-activity__meta-item">
              <span className="lot-activity__meta-label">Grower / Origin</span>
              <span className="lot-activity__meta-value">{growers.nameOf(lot.ID_GROWER)}</span>
            </div>
            <div className="lot-activity__meta-item">
              <span className="lot-activity__meta-label">Arrival</span>
              <span className="lot-activity__meta-value">{fmtDate(lot.ARRIVAL_DATE)}</span>
            </div>
          </div>
        )}
      </div>

      {!lot && (
        <div className="lot-activity__empty-state">
          <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3.3 8.3L12 13l8.7-4.7" /><path d="M12 13v9" />
          </svg>
          <h3 className="lot-activity__empty-title">Select a lot to trace its activity</h3>
          <p className="lot-activity__empty-text">
            You will see what was purchased, every sale made from it, and the remaining availability.
          </p>
        </div>
      )}

      {lot && (
        <>
          <div className="lot-activity__kpis">
            <div className="lot-activity__kpi">
              <span className="lot-activity__kpi-label">Purchased</span>
              <span className="lot-activity__kpi-value">{purchasedQty}</span>
              <span className="lot-activity__kpi-sub">{fmtMoney(purchasedTotal)}</span>
            </div>
            <div className="lot-activity__kpi">
              <span className="lot-activity__kpi-label">Sold</span>
              <span className="lot-activity__kpi-value">{soldQty}</span>
              <span className="lot-activity__kpi-sub">{fmtMoney(soldTotal)}</span>
            </div>
            <div className={`lot-activity__kpi lot-activity__kpi--${availabilityClass}`}>
              <span className="lot-activity__kpi-label">Available</span>
              <span className="lot-activity__kpi-value">{availableQty}</span>
              <span className="lot-activity__kpi-sub">
                {availableQty > 0 ? 'In stock' : availableQty === 0 ? 'Sold out' : 'Oversold'}
              </span>
            </div>
            <div className={`lot-activity__kpi lot-activity__kpi--${margin >= 0 ? 'ok' : 'bad'}`}>
              <span className="lot-activity__kpi-label">Margin</span>
              <span className="lot-activity__kpi-value">{fmtMoney(margin)}</span>
              <span className="lot-activity__kpi-sub">{marginPercent}% over cost</span>
            </div>
          </div>

          <section className="lot-activity__panel">
            <header className="lot-activity__panel-header">
              <h3 className="lot-activity__panel-title">Purchase</h3>
              <span className="lot-activity__panel-badge">{lot.LOT_NUMBER}</span>
              <div className="lot-activity__panel-tools">
                <ColumnPicker view={purchaseColumns} />
              </div>
            </header>
            <div className="lot-activity__table-wrap">
              <table className="lot-activity__table">
                <thead>
                  <tr>
                    {showPurchase('commodity') && <th className="lot-activity__th">Commodity</th>}
                    {showPurchase('quantity') && <th className="lot-activity__th lot-activity__th--num">Quantity</th>}
                    {showPurchase('price') && <th className="lot-activity__th lot-activity__th--num">Price</th>}
                    {showPurchase('total') && <th className="lot-activity__th lot-activity__th--num">Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {lotPurchaseLines.length === 0 && (
                    <tr><td className="lot-activity__empty-row" colSpan={PURCHASE_COLUMNS.length - purchaseColumns.hiddenCount}>No purchase lines for this lot.</td></tr>
                  )}
                  {lotPurchaseLines.map((line) => (
                    <tr key={line.id}>
                      {showPurchase('commodity') && (
                        <td className="lot-activity__td lot-activity__td--strong">{commodities.nameOf(line.ID_COMMODITIES)}</td>
                      )}
                      {showPurchase('quantity') && <td className="lot-activity__td lot-activity__td--num">{line.QUANTITY}</td>}
                      {showPurchase('price') && <td className="lot-activity__td lot-activity__td--num">{fmtMoney(line.PRICE)}</td>}
                      {showPurchase('total') && (
                        <td className="lot-activity__td lot-activity__td--num lot-activity__td--strong">{fmtMoney(line.TOTAL)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {lotPurchaseLines.length > 0 && (
                  <tfoot>
                    <tr>
                      {purchaseLabelSpan > 0 && <td className="lot-activity__tf">Total</td>}
                      {showPurchase('quantity') && <td className="lot-activity__tf lot-activity__tf--num">{purchasedQty}</td>}
                      {showPurchase('price') && <td className="lot-activity__tf" />}
                      {showPurchase('total') && <td className="lot-activity__tf lot-activity__tf--num">{fmtMoney(purchasedTotal)}</td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="lot-activity__panel">
            <header className="lot-activity__panel-header">
              <h3 className="lot-activity__panel-title">Sales</h3>
              <span className="lot-activity__panel-count">
                {salesGroups.length} order{salesGroups.length === 1 ? '' : 's'}
              </span>
              <div className="lot-activity__panel-tools">
                <ColumnPicker view={salesColumns} />
              </div>
            </header>

            {salesGroups.length === 0 && (
              <p className="lot-activity__panel-empty">No sales registered from this lot yet.</p>
            )}

            {salesGroups.map((group) => (
              <div className="lot-activity__sale-group" key={group.orderId}>
                <div className="lot-activity__sale-header">
                  <div className="lot-activity__sale-id">
                    <span className="lot-activity__sale-number">
                      {group.order?.SALES_ORDER_NUMBER || '(no number)'}
                    </span>
                    <span className="lot-activity__sale-customer">
                      {group.order ? customers.nameOf(group.order.ID_CUSTOMER) : 'Unknown customer'}
                    </span>
                  </div>
                  <div className="lot-activity__sale-side">
                    <span className="lot-activity__sale-date">{fmtDate(group.order?.DATE ?? '')}</span>
                    {group.order && (
                      <span className={`lot-activity__status lot-activity__status--${STATUS_CLASS[group.order.STATUS] ?? 'draft'}`}>
                        {group.order.STATUS}
                      </span>
                    )}
                  </div>
                </div>
                <div className="lot-activity__table-wrap">
                  <table className="lot-activity__table">
                    <thead>
                      <tr>
                        {showSales('commodity') && <th className="lot-activity__th">Commodity</th>}
                        {showSales('description') && <th className="lot-activity__th">Description</th>}
                        {showSales('quantity') && <th className="lot-activity__th lot-activity__th--num">Quantity</th>}
                        {showSales('price') && <th className="lot-activity__th lot-activity__th--num">Price</th>}
                        {showSales('total') && <th className="lot-activity__th lot-activity__th--num">Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr key={line.id}>
                          {showSales('commodity') && (
                            <td className="lot-activity__td lot-activity__td--strong">{commodities.nameOf(line.ID_COMMODITIES)}</td>
                          )}
                          {showSales('description') && (
                            <td className="lot-activity__td lot-activity__td--muted">{lineDescription(line) || '—'}</td>
                          )}
                          {showSales('quantity') && <td className="lot-activity__td lot-activity__td--num">{line.QUANTITY}</td>}
                          {showSales('price') && <td className="lot-activity__td lot-activity__td--num">{fmtMoney(line.PRICE)}</td>}
                          {showSales('total') && (
                            <td className="lot-activity__td lot-activity__td--num lot-activity__td--strong">{fmtMoney(line.TOTAL)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        {salesLabelSpan > 0 && (
                          <td className="lot-activity__tf" colSpan={salesLabelSpan}>Order total</td>
                        )}
                        {showSales('quantity') && <td className="lot-activity__tf lot-activity__tf--num">{group.qty}</td>}
                        {showSales('price') && <td className="lot-activity__tf" />}
                        {showSales('total') && <td className="lot-activity__tf lot-activity__tf--num">{fmtMoney(group.total)}</td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
