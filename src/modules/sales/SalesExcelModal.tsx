import { useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { useInventoryItems } from '../../hooks/useInventoryItems';
import { downloadSalesExcel, type SalesExcelRow } from '../../services/salesExcelService';
import { COLLECTIONS, type SalesOrder, type SalesOrderDetail } from '../../types/models';
import { fmtMoney, round2, todayISO } from '../../utils/format';
import './SalesExcelModal.css';

interface Props {
  customerName: (id?: string) => string;
  salesPersonName: (id?: string) => string;
  onClose: () => void;
}

const startOfYear = (): string => `${new Date().getFullYear()}-01-01`;

/** Filtro del Excel de ventas (como el "Filter Excel" de AppSheet). */
export function SalesExcelModal({ customerName, salesPersonName, onClose }: Props) {
  /* Todas las ordenes (sin el limite de lectura de la tabla) para que el Excel este completo. */
  const { data: orders, loading: loadingOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: lines, loading: loadingLines } = useCollection<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { canonicalId } = useInventoryItems();

  const [startDate, setStartDate] = useState(startOfYear());
  const [endDate, setEndDate] = useState(todayISO());
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [salesPersonId, setSalesPersonId] = useState('');
  const [busy, setBusy] = useState(false);

  /* Ordenes validas (las canceladas no son ventas). */
  const activeOrders = useMemo(() => orders.filter((so) => so.STATUS !== 'Cancelled'), [orders]);

  const customerOptions = useMemo<CatalogOption[]>(
    () =>
      [...new Set(activeOrders.map((so) => so.ID_CUSTOMER).filter(Boolean))]
        .map((id) => ({ id, name: customerName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [activeOrders, customerName],
  );
  const salesPersonOptions = useMemo<CatalogOption[]>(
    () =>
      [...new Set(activeOrders.map((so) => so.ID_USERS).filter(Boolean))]
        .map((id) => ({ id, name: salesPersonName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [activeOrders, salesPersonName],
  );

  const linesByOrder = useMemo(() => {
    const map = new Map<string, SalesOrderDetail[]>();
    for (const l of lines) map.set(l.ID_SALESORDER, [...(map.get(l.ID_SALESORDER) ?? []), l]);
    return map;
  }, [lines]);

  /** Una fila por orden. Con producto elegido, solo sus lineas cuentan en Quantity y Total. */
  const rows = useMemo<SalesExcelRow[]>(() => {
    const result: SalesExcelRow[] = [];
    for (const so of activeOrders) {
      const date = so.DATE ?? '';
      if (startDate && date < startDate) continue;
      if (endDate && date > endDate) continue;
      if (customerId && so.ID_CUSTOMER !== customerId) continue;
      if (salesPersonId && so.ID_USERS !== salesPersonId) continue;

      const orderLines = linesByOrder.get(so.id) ?? [];
      const picked = productId ? orderLines.filter((l) => canonicalId(l.ID_COMMODITIES) === productId) : orderLines;
      if (productId && picked.length === 0) continue;

      const products = [...new Set(picked.map((l) => commodities.labelOf(canonicalId(l.ID_COMMODITIES))))].filter(
        (n) => n && n !== '—',
      );
      result.push({
        date,
        invoice: so.SALES_ORDER_NUMBER ?? '',
        customer: customerName(so.ID_CUSTOMER),
        ref: so.REF ?? '',
        product: products.join(', '),
        quantity: round2(picked.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0)),
        total: productId ? round2(picked.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0)) : round2(so.TOTAL ?? 0),
        salesPerson: so.ID_USERS ? salesPersonName(so.ID_USERS) : '',
        buyer: so.BUYER ?? '',
      });
    }
    /* Mismo orden que el Excel de AppSheet: por # de invoice. */
    return result.sort((a, b) => a.invoice.localeCompare(b.invoice, undefined, { numeric: true }));
  }, [activeOrders, linesByOrder, startDate, endDate, customerId, productId, salesPersonId, commodities, canonicalId, customerName, salesPersonName]);

  const total = round2(rows.reduce((acc, r) => acc + r.total, 0));

  const download = async () => {
    setBusy(true);
    try {
      await downloadSalesExcel(rows, `${startDate || 'start'}_${endDate || 'today'}`);
    } catch {
      alert('Could not generate the Excel file. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Filter Excel"
      open
      onClose={onClose}
      confirmOnClose={false}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || loadingOrders || loadingLines || rows.length === 0} onClick={() => void download()}>
            {busy ? 'Generating…' : loadingOrders || loadingLines ? 'Loading…' : 'Download Excel'}
          </button>
        </>
      }
    >
      <FormGrid>
        <FormField label="Start date">
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </FormField>
        <FormField label="Final date">
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </FormField>
        <FormField label="Customer" span2>
          <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="All customers…" />
        </FormField>
        <FormField label="Product" span2>
          <SearchableSelect value={productId} onChange={setProductId} options={commodities.options} placeholder="All products…" />
        </FormField>
        <FormField label="Sales person" span2>
          <SearchableSelect value={salesPersonId} onChange={setSalesPersonId} options={salesPersonOptions} placeholder="All sales people…" />
        </FormField>
      </FormGrid>

      <div className="sales-excel__summary">
        <span className="sales-excel__label">Rows</span>
        <b className="num">{rows.length}</b>
        <span className="sales-excel__label">Total</span>
        <b className="num">{fmtMoney(total)}</b>
        {(customerId || productId || salesPersonId) && (
          <button
            type="button"
            className="sales-excel__clear"
            onClick={() => {
              setCustomerId('');
              setProductId('');
              setSalesPersonId('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    </Modal>
  );
}
