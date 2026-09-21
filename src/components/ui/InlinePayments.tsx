import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../hooks/useCatalog';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { SearchableSelect } from './SearchableSelect';
import { fmtMoney, todayISO, toNumber } from '../../utils/format';
import { COLLECTIONS, type BaseDoc } from '../../types/models';
import './InlineLineItems.css';

/** Pago generico (de venta, de compra o de gasto). */
export interface InlinePayment {
  id: string;
  DATE?: string;
  ID_PAYMENTMETHOD?: string;
  AMOUNT?: number;
  CHECK_NUMBER?: string;
  REF_NUMBER?: string;
  NOTE?: string;
}

interface Draft {
  DATE: string;
  ID_PAYMENTMETHOD: string;
  AMOUNT: number;
  CHECK_NUMBER: string;
  REF_NUMBER: string;
  NOTE: string;
}

const emptyDraft = (): Draft => ({
  DATE: todayISO(),
  ID_PAYMENTMETHOD: '',
  AMOUNT: 0,
  CHECK_NUMBER: '',
  REF_NUMBER: '',
  NOTE: '',
});

/** yyyy-mm-dd -> m/d/yyyy (formato de Estados Unidos). */
const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

interface Props {
  /** Coleccion de pagos: BD_PAYMENTSALES, BD_PAYMENTPURCHASE o BD_PAYMENTBILL. */
  collection: string;
  /** Campo y valor que ligan el pago con su documento padre. */
  parentField: string;
  parentId: string;
  payments: InlinePayment[];
  /** Modulo para los permisos ('sales' | 'purchases' | 'expenses'). */
  moduleId: string;
  /** Se llama tras cada alta, edicion o borrado (recalcular saldos). */
  onChanged: () => void;
}

/**
 * Tabla de pagos editable dentro del panel de detalle: registrar, corregir y
 * eliminar pagos sin salir de la vista. Acciones en la ultima columna.
 */
export function InlinePayments({ collection, parentField, parentId, payments, moduleId, onChanged }: Props) {
  const { can } = useAuth();
  const methods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const [editingId, setEditingId] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);

  const canEdit = can(moduleId, 'edit');
  const canDelete = can(moduleId, 'delete');
  const canAdd = can(moduleId, 'add') || canEdit;

  const total = payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0);

  const startAdd = () => {
    setDraft(emptyDraft());
    setEditingId('');
    setAdding(true);
  };

  const startEdit = (payment: InlinePayment) => {
    setDraft({
      DATE: payment.DATE ?? todayISO(),
      ID_PAYMENTMETHOD: payment.ID_PAYMENTMETHOD ?? '',
      AMOUNT: payment.AMOUNT ?? 0,
      CHECK_NUMBER: payment.CHECK_NUMBER ?? '',
      REF_NUMBER: payment.REF_NUMBER ?? '',
      NOTE: payment.NOTE ?? '',
    });
    setAdding(false);
    setEditingId(payment.id);
  };

  const cancel = () => {
    setAdding(false);
    setEditingId('');
  };

  const save = async () => {
    if (!draft.AMOUNT) {
      alert('Enter the payment amount.');
      return;
    }
    setBusy(true);
    try {
      const payload = { [parentField]: parentId, ...draft, PHOTO: '' };
      if (editingId) await updateDocument<BaseDoc & Record<string, unknown>>(collection, editingId, payload);
      else await createDocument<BaseDoc & Record<string, unknown>>(collection, payload as Omit<BaseDoc & Record<string, unknown>, 'id'>);
      cancel();
      onChanged();
    } catch {
      alert('The payment could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (payment: InlinePayment) => {
    if (!window.confirm('Delete this payment?')) return;
    setBusy(true);
    try {
      await deleteDocument(collection, payment.id);
      onChanged();
    } catch {
      alert('The payment could not be deleted. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const draftRow = (key: string) => (
    <tr key={key} className="inline-lines__row--editing">
      <td className="record-detail__td">
        <input className="input" type="date" value={draft.DATE} onChange={(e) => setDraft((d) => ({ ...d, DATE: e.target.value }))} />
      </td>
      <td className="record-detail__td">
        <SearchableSelect
          value={draft.ID_PAYMENTMETHOD}
          onChange={(id) => setDraft((d) => ({ ...d, ID_PAYMENTMETHOD: id }))}
          options={methods.options}
          placeholder="Method…"
        />
      </td>
      <td className="record-detail__td">
        <input className="input" value={draft.CHECK_NUMBER} placeholder="Check #" onChange={(e) => setDraft((d) => ({ ...d, CHECK_NUMBER: e.target.value }))} />
      </td>
      <td className="record-detail__td">
        <input className="input" value={draft.REF_NUMBER} placeholder="Ref #" onChange={(e) => setDraft((d) => ({ ...d, REF_NUMBER: e.target.value }))} />
      </td>
      <td className="record-detail__td record-detail__td--num">
        <input
          className="input inline-lines__num"
          type="number"
          min="0"
          step="0.01"
          value={draft.AMOUNT || ''}
          placeholder="Amount"
          onChange={(e) => setDraft((d) => ({ ...d, AMOUNT: toNumber(e.target.value) }))}
        />
      </td>
      <td className="record-detail__td inline-lines__actions">
        <button type="button" className="inline-lines__btn inline-lines__btn--save" disabled={busy} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="inline-lines__btn" disabled={busy} onClick={cancel}>Cancel</button>
      </td>
    </tr>
  );

  return (
    <>
      {canAdd && !adding && !editingId && (
        <button type="button" className="btn btn--secondary inline-lines__add" onClick={startAdd}>
          + Add payment
        </button>
      )}

      <div className="record-detail__table-wrap">
        <table className="record-detail__table">
          <thead>
            <tr>
              <th className="record-detail__th">Date</th>
              <th className="record-detail__th">Method</th>
              <th className="record-detail__th">Check #</th>
              <th className="record-detail__th">Ref #</th>
              <th className="record-detail__th record-detail__th--num">Amount</th>
              <th className="record-detail__th inline-lines__th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && !adding && (
              <tr><td className="record-detail__empty" colSpan={6}>No payments registered.</td></tr>
            )}
            {payments.map((payment) =>
              editingId === payment.id ? (
                draftRow(payment.id)
              ) : (
                <tr key={payment.id}>
                  <td className="record-detail__td record-detail__td--muted">{fmtDate(payment.DATE)}</td>
                  <td className="record-detail__td">{methods.labelOf(payment.ID_PAYMENTMETHOD)}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.CHECK_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.REF_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--num record-detail__td--strong">{fmtMoney(payment.AMOUNT ?? 0)}</td>
                  <td className="record-detail__td inline-lines__actions">
                    {canEdit && (
                      <button type="button" className="inline-lines__btn" disabled={busy} onClick={() => startEdit(payment)}>Edit</button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="inline-lines__btn inline-lines__btn--delete"
                        disabled={busy}
                        onClick={() => void remove(payment)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
            {adding && draftRow('new-payment')}
          </tbody>
          {payments.length > 0 && (
            <tfoot>
              <tr>
                <td className="record-detail__tf" colSpan={4}>Total paid</td>
                <td className="record-detail__tf record-detail__tf--num">{fmtMoney(total)}</td>
                <td className="record-detail__tf" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
