import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { updateDocument, where } from '../../services/firestore';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
import { InlineLineItems } from '../../components/ui/InlineLineItems';
import { InlinePayments } from '../../components/ui/InlinePayments';
import { syncSalesOrderTotals } from '../../services/orderTotalsService';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { FORM_DEFS } from '../../config/formDefs';
import {
  COLLECTIONS,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
} from '../../types/models';
import { fmtMoney, round2 } from '../../utils/format';
import './SalesOrderDetailPanel.css';

/** Estados que ya implican que la mercancia salio del almacen. */
const ESTADOS_CARGADOS = ['Loaded', 'Delivered', 'Paid'];

/**
 * Misma regla que Inventory e Invoice Queue: una orden esta cargada si tiene
 * el palomeo LOADED o su estado ya paso de "pendiente de carga".
 */
const estaCargada = (so: { LOADED?: boolean; STATUS?: string }): boolean =>
  !!so.LOADED || ESTADOS_CARGADOS.includes(so.STATUS ?? '');

const fmtDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

interface Props {
  order: SalesOrder;
  purchaseOrders: PurchaseOrder[];
  buyerName: (id?: string) => string;
  onClose: () => void;
  onEdit?: () => void;
}

export function SalesOrderDetailPanel({ order, purchaseOrders, buyerName, onClose, onEdit }: Props) {
  const { fieldsFor } = useAppConfig();
  const { can } = useAuth();

  /* ---- Loaded / Not loaded ----
     Controla Invoice Queue (lista las ordenes NO cargadas) y el inventario
     (una orden cargada ya salio del almacen). Se guarda el palomeo LOADED y
     el estado se sincroniza, porque ambos modulos miran las dos cosas. */
  const [carga, setCarga] = useState({ loaded: estaCargada(order), status: order.STATUS ?? '' });
  const [guardandoCarga, setGuardandoCarga] = useState(false);

  const cambiarCarga = async (loaded: boolean) => {
    if (loaded === carga.loaded || guardandoCarga) return;
    let status = carga.status;
    if (loaded && ['', 'Draft', 'Pending Load'].includes(status)) status = 'Loaded';
    if (!loaded && ESTADOS_CARGADOS.includes(status)) {
      if (status !== 'Loaded' && !window.confirm(`This order is "${status}". Mark it as not loaded and move it back to "Pending Load"?`)) return;
      status = 'Pending Load';
    }
    const anterior = carga;
    setCarga({ loaded, status }); // optimista: el cambio se ve al instante
    setGuardandoCarga(true);
    try {
      await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, order.id, {
        LOADED: loaded,
        STATUS: status as SalesOrder['STATUS'],
      });
    } catch {
      setCarga(anterior);
      alert('The load status could not be saved. Try again.');
    } finally {
      setGuardandoCarga(false);
    }
  };

  const puedeEditarCarga = can('sales', 'edit');
  const controlCarga = (
    <div className="so-load" role="group" aria-label="Load status">
      <button
        type="button"
        className={`so-load__opt${!carga.loaded ? ' so-load__opt--pending' : ''}`}
        disabled={!puedeEditarCarga || guardandoCarga}
        onClick={() => void cambiarCarga(false)}
        title="Not loaded yet: the order shows in Invoice Queue"
      >
        Not loaded
      </button>
      <button
        type="button"
        className={`so-load__opt${carga.loaded ? ' so-load__opt--loaded' : ''}`}
        disabled={!puedeEditarCarga || guardandoCarga}
        onClick={() => void cambiarCarga(true)}
        title="Loaded: the product left the warehouse and the order leaves Invoice Queue"
      >
        {carga.loaded ? '✓ Loaded' : 'Loaded'}
      </button>
    </div>
  );
  const { data: lines, loading } = useCollection<SalesOrderDetail>(
    COLLECTIONS.SALES_ORDER_DETAIL,
    [where('ID_SALESORDER', '==', order.id)],
    `${COLLECTIONS.SALES_ORDER_DETAIL}:${order.id}`,
  );
  const { data: payments } = useCollection<PaymentSales>(
    COLLECTIONS.PAYMENT_SALES,
    [where('ID_SALESORDER', '==', order.id)],
    `${COLLECTIONS.PAYMENT_SALES}:${order.id}`,
  );
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const shipVia = useCatalog(COLLECTIONS.SHIPVIA, 'NAME_SHIPVIA');
  const termShipping = useCatalog(COLLECTIONS.TERMSHIPPING, 'NAME_TERMSHIPPING');
  const paymentTerms = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');


  const valueByKey: Record<string, string> = {
    '# Sales order': order.SALES_ORDER_NUMBER ?? '',
    'Status': order.STATUS ?? '',
    'Date': fmtDate(order.DATE ?? ''),
    'Due date': fmtDate(order.DUE_DATE ?? ''),
    'Customer': customers.nameOf(order.ID_CUSTOMER),
    'Buyer': order.BUYER ?? '',
    'Salesperson': buyerName(order.ID_USERS),
    'Supplier': suppliers.nameOf(order.ID_SUPPLIERS),
    'Ref': order.REF ?? '',
    'Ref pickup': order.REF_PICKUP ?? '',
    'Pick up #': order.PICK_UP_NUMBER ?? '',
    'OD day': String(order.OD_DAY ?? ''),
    'Address': order.ADDRESS ?? '',
    'City / State / ZIP': order.CITY_STATE_ZIP ?? '',
    'Carrier': carriers.nameOf(order.ID_CARRIER),
    'Ship via': shipVia.nameOf(order.ID_SHIPVIA),
    'Shipping terms': termShipping.nameOf(order.ID_TERMSHIPPING),
    'Temp log': order.TEMP_LOG ?? '',
    'Description': order.DESCRIPTION ?? '',
    'Sent': order.SENT ? 'Yes' : 'No',
    'Payment term': order.ID_PAYMENTTERM ? paymentTerms.nameOf(order.ID_PAYMENTTERM) : '',
  };
  const defaults = FORM_DEFS.find((f) => f.id === 'sales')?.fields ?? [];
  const fields: DetailField[] = fieldsFor('sales', defaults).map((f) => ({
    label: f.label,
    value: valueByKey[f.key] ?? '',
  }));

  const linesTotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));

  return (
    <RecordDetail
      title={`Sales order ${order.SALES_ORDER_NUMBER || ''}`}
      badge={
        <>
          <StatusBadge value={carga.status} />
          {controlCarga}
        </>
      }
      onClose={onClose}
      onEdit={onEdit}
      fields={fields}
    >
      <DetailSection title="Financial summary">
        <div className="record-detail__stats">
          <div className="record-detail__stat record-detail__stat--highlight"><span className="record-detail__stat-label">Total</span><span className="record-detail__stat-value">{fmtMoney(order.TOTAL ?? 0)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Paid</span><span className="record-detail__stat-value">{fmtMoney(order.INCOMES ?? 0)}</span></div>
          <div className={`record-detail__stat${(order.BALANCE ?? 0) > 0 ? ' record-detail__stat--bad' : ''}`}><span className="record-detail__stat-label">Balance</span><span className="record-detail__stat-value">{fmtMoney(order.BALANCE ?? 0)}</span></div>
        </div>
      </DetailSection>

      <DetailSection title={`Line items (${lines.length})`}>
        <InlineLineItems
          collection={COLLECTIONS.SALES_ORDER_DETAIL}
          parentField="ID_SALESORDER"
          parentId={order.id}
          lines={lines}
          loading={loading}
          moduleId="sales"
          showLot
          lotOptions={purchaseOrders
            .map((po) => ({ id: po.id, name: po.LOT_NUMBER ?? po.REF_NUMBER ?? po.id }))
            .sort((a, b) => b.name.localeCompare(a.name))}
          onChanged={() => void syncSalesOrderTotals([order.id])}
        />
        {!loading && lines.length > 0 && (
          <div className="record-detail__lines-total">
            <span>Order total <b className="num">{fmtMoney(linesTotal)}</b></span>
          </div>
        )}
      </DetailSection>

      <DetailSection title={`Payments (${payments.length})`}>
        <InlinePayments
          collection={COLLECTIONS.PAYMENT_SALES}
          parentField="ID_SALESORDER"
          parentId={order.id}
          payments={payments}
          moduleId="sales"
          onChanged={() => void syncSalesOrderTotals([order.id])}
        />
      </DetailSection>
    </RecordDetail>
  );
}
