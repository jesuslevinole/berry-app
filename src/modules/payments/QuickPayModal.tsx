import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { createDocument } from '../../services/firestore';
import { openAttachment, saveAttachment } from '../../services/attachments';
import { syncExpenseTotals, syncSalesOrderTotals } from '../../services/orderTotalsService';
import { COLLECTIONS, type PaymentBase } from '../../types/models';
import { fmtDate, fmtMoney, round2, toNumber, todayISO } from '../../utils/format';
import './QuickPayModal.css';

type PaymentDoc = PaymentBase & Record<string, unknown>;

export type QuickPayKind = 'sale' | 'expense';

const META: Record<QuickPayKind, { collection: string; parentField: 'ID_SALESORDER' | 'ID_EXPENSES'; verb: string }> = {
  sale: { collection: COLLECTIONS.PAYMENT_SALES, parentField: 'ID_SALESORDER', verb: 'Receive payment' },
  expense: { collection: COLLECTIONS.PAYMENT_BILL, parentField: 'ID_EXPENSES', verb: 'Pay bill' },
};

interface Props {
  kind: QuickPayKind;
  parentId: string;
  /** Ej. "Sales order 46119 · Con Amore Fruit, LLC". */
  subtitle: string;
  /** Total del documento (venta o gasto). */
  total: number;
  /** Pagado guardado en el documento (dato de AppSheet sin registros de pago). */
  storedPaid: number;
  onClose: () => void;
}

/**
 * Nuevo pago desde Accounts Receivable / Accounts Payable, con los campos del
 * formulario de AppSheet: Date*, Payment method*, Amount*, # Check, # Ref, Note e imagen.
 * El monto viene con el saldo pendiente; al guardar se recalcula el saldo del documento.
 */
export function QuickPayModal({ kind, parentId, subtitle, total, storedPaid, onClose }: Props) {
  const meta = META[kind];
  const { data: payments, loading } = useCollection<PaymentDoc>(
    meta.collection,
    [where(meta.parentField, '==', parentId)],
    `${meta.collection}:${parentId}`,
  );
  const methods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  /* Sin registros de pago se respeta lo pagado guardado (igual que AR / AP). */
  const recordsPaid = useMemo(() => round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0)), [payments]);
  const openingPaid = payments.length === 0 && storedPaid > 0.005 ? round2(storedPaid) : 0;
  const paid = payments.length > 0 ? recordsPaid : openingPaid;
  const balance = round2(total - paid);

  const [date, setDate] = useState(todayISO());
  const [methodId, setMethodId] = useState('');
  /* null = todavia no se escribe: se propone el saldo pendiente. */
  const [amountText, setAmountText] = useState<string | null>(null);
  const amount = amountText ?? (loading ? '' : String(Math.max(balance, 0)));
  const [checkNumber, setCheckNumber] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    const value = round2(toNumber(amount));
    if (!date) return setError('The date is required.');
    if (!methodId) return setError('Choose the payment method.');
    if (value <= 0) return setError('Enter the amount.');
    if (value - balance > 0.005 && !window.confirm(`The amount ${fmtMoney(value)} is more than the balance ${fmtMoney(balance)}. Save it anyway?`)) return;
    setSaving(true);
    try {
      const photo = file ? await saveAttachment(file) : '';
      /* Lo pagado antes (AppSheet) queda como registro, para que el nuevo pago no lo borre del saldo. */
      if (openingPaid > 0) {
        await createDocument<PaymentDoc>(meta.collection, {
          [meta.parentField]: parentId,
          DATE: date,
          ID_PAYMENTMETHOD: '',
          AMOUNT: openingPaid,
          CHECK_NUMBER: '',
          REF_NUMBER: '',
          NOTE: 'Paid before (imported balance)',
          PHOTO: '',
        } as Omit<PaymentDoc, 'id'>);
      }
      await createDocument<PaymentDoc>(meta.collection, {
        [meta.parentField]: parentId,
        DATE: date,
        ID_PAYMENTMETHOD: methodId,
        AMOUNT: value,
        CHECK_NUMBER: checkNumber.trim(),
        REF_NUMBER: refNumber.trim(),
        NOTE: note.trim(),
        PHOTO: photo,
      } as Omit<PaymentDoc, 'id'>);
      /* El documento queda con su pagado y saldo al dia (sale de AR/AP al llegar a cero). */
      if (kind === 'sale') await syncSalesOrderTotals([parentId], true, { paymentsChanged: true });
      else await syncExpenseTotals([parentId], true, { paymentsChanged: true });
      onClose();
    } catch (e) {
      setError((e as Error).message || 'The payment could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${meta.verb} — New payment`}
      open
      onClose={saving ? () => undefined : onClose}
      confirmOnClose={false}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={saving || loading} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="quick-pay__subtitle">{subtitle}</p>
      <div className="quick-pay__kpis">
        <div className="quick-pay__kpi"><span>Total</span><b className="num">{fmtMoney(total)}</b></div>
        <div className="quick-pay__kpi"><span>Paid</span><b className="num text-ok">{fmtMoney(paid)}</b></div>
        <div className="quick-pay__kpi"><span>Balance</span><b className={`num${balance > 0.005 ? ' text-bad' : ''}`}>{fmtMoney(balance)}</b></div>
      </div>

      <FormGrid>
        <FormField label="Date" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Payment method" required>
          <CatalogSelect
            value={methodId}
            onChange={setMethodId}
            options={methods.options}
            collection={COLLECTIONS.PAYMENT_METHOD}
            nameField="NAME"
            catalogLabel="payment method"
          />
        </FormField>
        <FormField label="Amount" required>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </FormField>
        <FormField label="# Check">
          <input className="input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
        </FormField>
        <FormField label="# Ref">
          <input className="input" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} />
        </FormField>
        <FormField label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <FormField label="Image (photo or PDF)" span2>
          <input
            className="input quick-pay__file"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </FormField>
      </FormGrid>

      {payments.length > 0 && (
        <div className="quick-pay__history">
          <span className="quick-pay__history-title">Payments already registered ({payments.length})</span>
          <table className="quick-pay__table">
            <tbody>
              {[...payments]
                .sort((a, b) => (a.DATE ?? '').localeCompare(b.DATE ?? ''))
                .map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.DATE)}</td>
                    <td>{methods.nameOf(p.ID_PAYMENTMETHOD)}</td>
                    <td>{p.CHECK_NUMBER || p.REF_NUMBER || '—'}</td>
                    <td className="num">{fmtMoney(p.AMOUNT)}</td>
                    <td>
                      {p.PHOTO && (
                        <button type="button" className="quick-pay__link" onClick={() => void openAttachment(p.PHOTO)}>
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="quick-pay__error">{error}</p>}
    </Modal>
  );
}
