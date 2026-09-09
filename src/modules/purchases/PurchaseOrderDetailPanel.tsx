import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from '../../services/firestore';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
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
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');

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

  /* Resumen EN VIVO desde las lineas: si el lote tiene detalle cargado (formulario
     o Import CSV), los totales salen de las lineas y nunca quedan desfasados. */
  const liveSubtotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
  const liveQuantity = round2(lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0));
  const hasLines = !loading && lines.length > 0;
  const subtotal = hasLines ? liveSubtotal : (order.SUBTOTAL ?? 0);
  const commission = hasLines ? round2((liveSubtotal * (order.COMMISION_PERCENT ?? 0)) / 100) : (order.COMMISION_AMOUNT ?? 0);
  const total = hasLines ? round2(subtotal + commission) : (order.TOTAL ?? 0);
  const quantity = hasLines ? liveQuantity : (order.QUANTITY ?? 0);
  const balance = round2(total - (order.AMOUNT_PAID ?? 0));

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
        <div className="record-detail__table-wrap">
          <table className="record-detail__table">
            <thead>
              <tr>
                <th className="record-detail__th">Commodity</th>
                <th className="record-detail__th">Description</th>
                <th className="record-detail__th record-detail__th--num">Quantity</th>
                <th className="record-detail__th record-detail__th--num">Price</th>
                <th className="record-detail__th record-detail__th--num">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="record-detail__empty" colSpan={5}>Loading…</td></tr>}
              {!loading && lines.length === 0 && (
                <tr><td className="record-detail__empty" colSpan={5}>No line items.</td></tr>
              )}
              {!loading && lines.map((line) => (
                <tr key={line.id}>
                  <td className="record-detail__td record-detail__td--strong">{commodities.nameOf(line.ID_COMMODITIES) || line.ID_COMMODITIES || '\u2014'}</td>
                  <td className="record-detail__td record-detail__td--muted">{line.DESCRIPTION || '—'}</td>
                  <td className="record-detail__td record-detail__td--num">{line.QUANTITY}</td>
                  <td className="record-detail__td record-detail__td--num">{fmtMoney(line.PRICE)}</td>
                  <td className="record-detail__td record-detail__td--num record-detail__td--strong">{fmtMoney(line.TOTAL)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && lines.length > 0 && (
              <tfoot>
                <tr>
                  <td className="record-detail__tf" colSpan={2}>Total</td>
                  <td className="record-detail__tf record-detail__tf--num">{quantity}</td>
                  <td className="record-detail__tf" />
                  <td className="record-detail__tf record-detail__tf--num">{fmtMoney(subtotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </DetailSection>
    </RecordDetail>
  );
}
