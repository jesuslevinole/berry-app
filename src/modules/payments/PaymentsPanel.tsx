import { useMemo, useState } from 'react';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { where } from 'firebase/firestore';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { createDocument, deleteDocument } from '../../services/firestore';
import { COLLECTIONS, type PaymentBase } from '../../types/models';
import { fmtDate, fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { FormField, FormGrid } from '../../components/ui/FormField';
import './PaymentsPanel.css';

type PaymentDoc = PaymentBase & Record<string, unknown>;

interface PaymentsPanelProps {
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
  const paymentMethods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const [date, setDate] = useState(todayISO());
  const [methodId, setMethodId] = useState('');
  const [amount, setAmount] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const totalPaid = useMemo(() => round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0)), [payments]);
  const balance = round2(expectedTotal - totalPaid);

  const handleAdd = async () => {
    const value = toNumber(amount);
    if (value <= 0) return;
    setSaving(true);
    try {
      await createDocument<PaymentDoc>(collectionName, {
        [parentField]: parentId,
        DATE: date,
        ID_PAYMENTMETHOD: methodId,
        AMOUNT: value,
        CHECK_NUMBER: checkNumber.trim(),
        REF_NUMBER: refNumber.trim(),
        PHOTO: '',
        NOTE: note.trim(),
      } as Omit<PaymentDoc, 'id'>);
      await onTotalPaidChange(round2(totalPaid + value));
      setAmount('');
      setCheckNumber('');
      setRefNumber('');
      setNote('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (payment: PaymentDoc) => {
    if (!window.confirm('Delete this payment?')) return;
    await deleteDocument(collectionName, payment.id);
    await onTotalPaidChange(round2(totalPaid - (payment.AMOUNT ?? 0)));
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
    {
      key: 'actions',
      header: '',
      align: 'center',
      width: '46px',
      render: (p) => (
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Delete payment"
          onClick={(e) => {
            e.stopPropagation();
            void handleDelete(p);
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
      ),
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

      <DataTable columns={columns} rows={payments} loading={loading} emptyMessage="No payments registered" />

      <div className="payments-panel__form">
        <h4 className="payments-panel__form-title">Register payment</h4>
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
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || toNumber(amount) <= 0}
            onClick={() => void handleAdd()}
          >
            + Add payment
          </button>
        </div>
      </div>
    </div>
  );
}
