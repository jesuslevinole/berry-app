import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { where } from 'firebase/firestore';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { COLLECTIONS, type PaymentBase } from '../../types/models';
import { byNewest, fmtDate, fmtMoney, round2, toNumber, todayISO } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { FormField, FormGrid } from '../../components/ui/FormField';
import './PaymentsPanel.css';

type PaymentDoc = PaymentBase & Record<string, unknown>;

interface PaymentsPanelProps {
  /** Modulo dueño ('sales' | 'expenses') para gatear Edit/Delete por rol. */
  moduleId: string;
  /** BD_PAYMENTSALES o BD_PAYMENTBILL. */
  collectionName: string;
  /** Campo FK hacia el padre: ID_SALESORDER o ID_EXPENSES. */
  parentField: 'ID_SALESORDER' | 'ID_EXPENSES';
  parentId: string;
  /** Total esperado del padre (TOTAL de la venta / AMOUNT del gasto) para mostrar balance. */
  expectedTotal: number;
  /** Notifica el total pagado para que el padre actualice sus campos derivados. */
  onTotalPaidChange: (totalPaid: number) => Promise<void> | void;
}

/**
 * Panel de pagos reutilizable: el mismo componente sirve para pagos de ventas
 * (BD_PAYMENTSALES) y pagos de gastos (BD_PAYMENTBILL).
 */
export function PaymentsPanel({
  moduleId,
  collectionName,
  parentField,
  parentId,
  expectedTotal,
  onTotalPaidChange,
}: PaymentsPanelProps) {
  const { data: payments, loading } = useCollection<PaymentDoc>(
    collectionName,
    [where(parentField, '==', parentId)],
    `${collectionName}:${parentId}`,
  );
  const { can } = useAuth();
  const paymentMethods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const totalPaid = useMemo(() => round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0)), [payments]);
  const balance = round2(expectedTotal - totalPaid);

  const resetForm = () => {
    setEditingId(null);
    setAmount('');
    setCheckNumber('');
    setRefNumber('');
    setNote('');
  };

  const startEdit = (payment: PaymentDoc) => {
    setEditingId(payment.id);
    setDate(payment.DATE ?? todayISO());
    setMethodId(payment.ID_PAYMENTMETHOD ?? '');
    setAmount(String(payment.AMOUNT ?? ''));
    setCheckNumber(payment.CHECK_NUMBER ?? '');
    setRefNumber(payment.REF_NUMBER ?? '');
    setNote(payment.NOTE ?? '');
  };

  const handleSave = async () => {
    const value = toNumber(amount);
    if (value <= 0) return;
    setSaving(true);
    try {
      const payload = {
        [parentField]: parentId,
        DATE: date,
        ID_PAYMENTMETHOD: methodId,
        AMOUNT: value,
        CHECK_NUMBER: checkNumber.trim(),
        REF_NUMBER: refNumber.trim(),
        PHOTO: '',
        NOTE: note.trim(),
      } as Omit<PaymentDoc, 'id'>;
      if (editingId) {
        const previous = payments.find((p) => p.id === editingId)?.AMOUNT ?? 0;
        await updateDocument<PaymentDoc>(collectionName, editingId, payload);
        await onTotalPaidChange(round2(totalPaid - previous + value));
      } else {
        await createDocument<PaymentDoc>(collectionName, payload);
        await onTotalPaidChange(round2(totalPaid + value));
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (payment: PaymentDoc) => {
    if (!window.confirm('Delete this payment?')) return;
    await deleteDocument(collectionName, payment.id);
    await onTotalPaidChange(round2(totalPaid - (payment.AMOUNT ?? 0)));
    if (editingId === payment.id) resetForm();
  };

  const columns: Array<Column<PaymentDoc>> = [
    { key: 'DATE', header: 'Date', render: (p) => fmtDate(p.DATE) },
    { key: 'ID_PAYMENTMETHOD', header: 'Method', render: (p) => paymentMethods.nameOf(p.ID_PAYMENTMETHOD) },
    { key: 'CHECK_NUMBER', header: 'Check #', render: (p) => p.CHECK_NUMBER || '—' },
    { key: 'REF_NUMBER', header: 'Ref #', render: (p) => p.REF_NUMBER || '—' },
    {
      key: 'AMOUNT',
      header: 'Amount',
      align: 'right',
      render: (p) => <span className="num">{fmtMoney(p.AMOUNT)}</span>,
    },
  ];

  return (
    <div className="payments-panel">
      <div className="payments-panel__totals">
        <div className="payments-panel__kpi">
          <span className="muted">Total</span>
          <b className="num">{fmtMoney(expectedTotal)}</b>
        </div>
        <div className="payments-panel__kpi">
          <span className="muted">Paid</span>
          <b className="num text-ok">{fmtMoney(totalPaid)}</b>
        </div>
        <div className="payments-panel__kpi">
          <span className="muted">Balance</span>
          <b className={`num${balance > 0 ? ' text-bad' : ''}`}>{fmtMoney(balance)}</b>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={[...payments].sort(byNewest)}
        loading={loading}
        emptyMessage="No payments registered"
        onEdit={can(moduleId, 'edit') ? startEdit : undefined}
        onDelete={can(moduleId, 'delete') ? (p) => void handleDelete(p) : undefined}
      />

      <div className="payments-panel__form">
        <h4 className="payments-panel__form-title">{editingId ? 'Edit payment' : 'Register payment'}</h4>
        <FormGrid>
          <FormField label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Payment method">
            <CatalogSelect
              value={methodId}
              onChange={setMethodId}
              options={paymentMethods.options}
              collection={COLLECTIONS.PAYMENT_METHOD}
              nameField="NAME"
              catalogLabel="payment method"
            />
          </FormField>
          <FormField label="Amount">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Check #">
            <input className="input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </FormField>
          <FormField label="Ref #">
            <input className="input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} />
          </FormField>
          <FormField label="Note">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </FormGrid>
        <div className="payments-panel__form-actions">
          {editingId && (
            <button type="button" className="btn btn--secondary" onClick={resetForm}>
              Cancel edit
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || toNumber(amount) <= 0}
            onClick={() => void handleSave()}
          >
            {editingId ? 'Update payment' : '+ Add payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
