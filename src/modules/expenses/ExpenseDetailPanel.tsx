import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from '../../services/firestore';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
import { FORM_DEFS } from '../../config/formDefs';
import { COLLECTIONS, type Expense, type PaymentBill, type PurchaseOrder } from '../../types/models';
import { fmtMoney, round2 } from '../../utils/format';

const fmtDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

interface Props {
  expense: Expense;
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onEdit?: () => void;
  /** Abre el registro de pagos del gasto (gatear con can('expenses','edit')). */
  onAddPayment?: () => void;
}

export function ExpenseDetailPanel({ expense, purchaseOrders, onClose, onEdit, onAddPayment }: Props) {
  const { fieldsFor } = useAppConfig();
  const { data: payments } = useCollection<PaymentBill>(
    COLLECTIONS.PAYMENT_BILL,
    [where('ID_EXPENSES', '==', expense.id)],
    `${COLLECTIONS.PAYMENT_BILL}:${expense.id}`,
  );
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');
  const paymentMethods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const lot = purchaseOrders.find((po) => po.id === expense.ID_PURCHASEORDER)?.LOT_NUMBER ?? '';

  const valueByKey: Record<string, string> = {
    '# Lot (purchase order)': lot,
    'Supplier': suppliers.nameOf(expense.ID_SUPPLIERS),
    'Category': categories.nameOf(expense.ID_CATEGORYBILL),
    'Invoice #': expense.INVOICE_NUMBER ?? '',
    'Date': fmtDate(expense.DATE ?? ''),
    'Amount': fmtMoney(expense.AMOUNT ?? 0),
    'Check #': expense.CHECK_NUMBER ?? '',
    'Photo check (URL)': expense.PHOTO_CHECK ?? '',
    'Deduct': expense.DEDUCT ? 'Yes' : 'No',
    'Note': expense.NOTE ?? '',
  };
  const defaults = FORM_DEFS.find((f) => f.id === 'expenses')?.fields ?? [];
  const fields: DetailField[] = fieldsFor('expenses', defaults).map((f) => ({
    label: f.label,
    value: valueByKey[f.key] ?? '',
  }));

  const paid = round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0));
  const balance = round2(expense.BALANCE ?? 0);

  return (
    <RecordDetail
      title={`Expense ${expense.INVOICE_NUMBER || lot || ''}`}
      onClose={onClose}
      onEdit={onEdit}
      fields={fields}
    >
      <DetailSection title="Financial summary">
        <div className="record-detail__stats">
          <div className="record-detail__stat record-detail__stat--highlight"><span className="record-detail__stat-label">Amount</span><span className="record-detail__stat-value">{fmtMoney(expense.AMOUNT ?? 0)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Paid</span><span className="record-detail__stat-value">{fmtMoney(paid)}</span></div>
          <div className={`record-detail__stat${balance > 0 ? ' record-detail__stat--bad' : ''}`}><span className="record-detail__stat-label">Balance</span><span className="record-detail__stat-value">{fmtMoney(balance)}</span></div>
        </div>
      </DetailSection>

      <DetailSection
        title={`Payments (${payments.length})`}
        action={
          onAddPayment && (
            <button type="button" className="btn btn--primary" onClick={onAddPayment}>
              + Add payment
            </button>
          )
        }
      >
        <div className="record-detail__table-wrap">
          <table className="record-detail__table">
            <thead>
              <tr>
                <th className="record-detail__th">Date</th>
                <th className="record-detail__th">Method</th>
                <th className="record-detail__th">Check #</th>
                <th className="record-detail__th">Ref #</th>
                <th className="record-detail__th record-detail__th--num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr><td className="record-detail__empty" colSpan={5}>No payments registered.</td></tr>
              )}
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="record-detail__td record-detail__td--muted">{fmtDate(payment.DATE ?? '')}</td>
                  <td className="record-detail__td">{paymentMethods.nameOf(payment.ID_PAYMENTMETHOD)}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.CHECK_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.REF_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--num record-detail__td--strong">{fmtMoney(payment.AMOUNT ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            {payments.length > 0 && (
              <tfoot>
                <tr>
                  <td className="record-detail__tf" colSpan={4}>Total paid</td>
                  <td className="record-detail__tf record-detail__tf--num">{fmtMoney(paid)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </DetailSection>
    </RecordDetail>
  );
}
