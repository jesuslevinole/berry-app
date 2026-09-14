import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from '../../services/firestore';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
import { InlinePayments } from '../../components/ui/InlinePayments';
import { syncExpenseTotals } from '../../services/orderTotalsService';
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
}

export function ExpenseDetailPanel({ expense, purchaseOrders, onClose, onEdit }: Props) {
  const { fieldsFor } = useAppConfig();
  const { data: payments } = useCollection<PaymentBill>(
    COLLECTIONS.PAYMENT_BILL,
    [where('ID_EXPENSES', '==', expense.id)],
    `${COLLECTIONS.PAYMENT_BILL}:${expense.id}`,
  );
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const categories = useCatalog(COLLECTIONS.CATEGORY_BILL, 'NAME');

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

      <DetailSection title={`Payments (${payments.length})`}>
        <InlinePayments
          collection={COLLECTIONS.PAYMENT_BILL}
          parentField="ID_EXPENSES"
          parentId={expense.id}
          payments={payments}
          moduleId="expenses"
          onChanged={() => void syncExpenseTotals([expense.id])}
        />
      </DetailSection>
    </RecordDetail>
  );
}
