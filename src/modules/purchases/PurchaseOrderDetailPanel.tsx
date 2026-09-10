import { useEffect, useRef } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from '../../services/firestore';
import { computePurchaseTotals, purchaseTotalsDiffer, syncPurchaseOrderTotals } from '../../services/orderTotalsService';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
import { InlineLineItems } from '../../components/ui/InlineLineItems';
import { FORM_DEFS } from '../../config/formDefs';
import { COLLECTIONS, type PurchaseDetail, type PurchaseOrder } from '../../types/models';
import { fmtMoney, round2 } from '../../utils/format';

const fmtDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

interface Props {
  order: PurchaseOrder;
  buyerName: (id?: string) => string;
  onClose: () => void;
  onEdit?: () => void;
}

export function PurchaseOrderDetailPanel({ order, buyerName, onClose, onEdit }: Props) {
  const { fieldsFor } = useAppConfig();
  const { data: lines, loading } = useCollection<PurchaseDetail>(
    COLLECTIONS.PURCHASE_DETAILS,
    [where('ID_PURCHASEORDER', '==', order.id)],
    `${COLLECTIONS.PURCHASE_DETAILS}:${order.id}`,
  );
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const paymentTerms = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');

  const valueByKey: Record<string, string> = {
    'Lot #': order.LOT_NUMBER ?? '',
    'Grower / Origin': growers.nameOf(order.ID_GROWER),
    'Vendor': customers.nameOf(order.ID_CUSTOMER),
    'Ship to': locations.nameOf(order.SHIPTO),
    'Buyer': buyerName(order.ID_USERS),
    'Note': order.NOTE ?? '',
    'Commission %': `${order.COMMISION_PERCENT ?? 0}%`,
    '# Ref': order.REF_NUMBER ?? '',
    'Carrier': carriers.nameOf(order.ID_CARRIER),
    'Arrival date': fmtDate(order.ARRIVAL_DATE ?? ''),
    'Payment term': order.ID_PAYMENTTERM ? paymentTerms.nameOf(order.ID_PAYMENTTERM) : '',
  };
  const defaults = FORM_DEFS.find((f) => f.id === 'purchases')?.fields ?? [];
  const fields: DetailField[] = fieldsFor('purchases', defaults).map((f) => ({
    label: f.label,
    value: valueByKey[f.key] ?? '',
  }));

  /* Resumen EN VIVO desde las lineas relacionadas por ID_PURCHASEORDER. */
  const hasLines = !loading && lines.length > 0;
  const live = computePurchaseTotals(order, lines);
  const subtotal = hasLines ? live.SUBTOTAL : (order.SUBTOTAL ?? 0);
  const commission = hasLines ? live.COMMISION_AMOUNT : (order.COMMISION_AMOUNT ?? 0);
  const total = hasLines ? live.TOTAL : (order.TOTAL ?? 0);
  const quantity = hasLines ? live.QUANTITY : (order.QUANTITY ?? 0);
  const balance = round2(total - (order.AMOUNT_PAID ?? 0));

  /* Autocuracion: si BD_PURCHASEORDER tiene totales desfasados respecto a sus
     lineas (datos importados o editados fuera del app), se corrigen una sola vez. */
  const syncedRef = useRef('');
  useEffect(() => {
    if (!hasLines || syncedRef.current === order.id) return;
    if (!purchaseTotalsDiffer(order, live)) return;
    syncedRef.current = order.id;
    void syncPurchaseOrderTotals([order.id]).catch(() => {
      /* Sin permiso de escritura: el panel igual muestra los totales correctos. */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLines, order.id, live.SUBTOTAL, live.QUANTITY, live.TOTAL]);

  return (
    <RecordDetail
      title={`Purchase order ${order.LOT_NUMBER || order.REF_NUMBER || ''}`}
      onClose={onClose}
      onEdit={onEdit}
      fields={fields}
    >
      <DetailSection title="Financial summary">
        <div className="record-detail__stats">
          <div className="record-detail__stat"><span className="record-detail__stat-label">Subtotal</span><span className="record-detail__stat-value">{fmtMoney(subtotal)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Commission</span><span className="record-detail__stat-value">{fmtMoney(commission)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Expenses</span><span className="record-detail__stat-value">{fmtMoney(order.EXPENSES ?? 0)}</span></div>
          <div className="record-detail__stat record-detail__stat--highlight"><span className="record-detail__stat-label">Total</span><span className="record-detail__stat-value">{fmtMoney(total)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Amount paid</span><span className="record-detail__stat-value">{fmtMoney(order.AMOUNT_PAID ?? 0)}</span></div>
          <div className={`record-detail__stat${balance > 0 ? ' record-detail__stat--bad' : ''}`}><span className="record-detail__stat-label">Balance</span><span className="record-detail__stat-value">{fmtMoney(balance)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Quantity</span><span className="record-detail__stat-value">{quantity}</span></div>
        </div>
      </DetailSection>

      <DetailSection title={`Line items (${lines.length})`}>
        <InlineLineItems
          collection={COLLECTIONS.PURCHASE_DETAILS}
          parentField="ID_PURCHASEORDER"
          parentId={order.id}
          lines={lines}
          loading={loading}
          moduleId="purchases"
          onChanged={() => void syncPurchaseOrderTotals([order.id])}
        />
        {!loading && lines.length > 0 && (
          <div className="record-detail__lines-total">
            <span>Quantity <b className="num">{quantity}</b></span>
            <span>Subtotal <b className="num">{fmtMoney(subtotal)}</b></span>
          </div>
        )}
      </DetailSection>
    </RecordDetail>
  );
}
