import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { recordCompanyPayment } from '../../services/companyAdminService';
import { addDays, nextPaidThrough } from '../../services/billingService';
import { fmtDate } from '../../utils/format';
import type { Company } from '../../types/models';
import './RecordPaymentModal.css';

/** Mensualidades que se pueden registrar de una vez. */
const PERIOD_OPTIONS = [1, 3, 6, 12];

interface RecordPaymentModalProps {
  company: Company;
  onClose: () => void;
}

/**
 * Registra a mano un pago de suscripcion (transferencia, Zelle, efectivo) y
 * extiende el acceso. Se monta al abrirse, asi cada empresa empieza en limpio.
 */
export const RecordPaymentModal = ({ company, onClose }: RecordPaymentModalProps) => {
  const { firebaseUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [periods, setPeriods] = useState(1);
  const [paidOn, setPaidOn] = useState(() => addDays(0));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const newPaidThrough = nextPaidThrough(company, periods);

  const handleSave = async () => {
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value < 0) {
      setError('Enter the amount received.');
      return;
    }
    if (!paidOn) {
      setError('Enter the payment date.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await recordCompanyPayment(company, { amount: value, periods, paidOn }, firebaseUser?.email ?? '');
      onClose();
    } catch {
      setError('The payment could not be saved. Try again.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Record payment · ${company.name}`}
      open
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save payment'}
          </button>
        </>
      }
    >
      <FormGrid>
        <FormField label="Amount received" required>
          <input
            className="input num"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField label="Months covered">
          <select className="input" value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 1 ? '1 month' : `${option} months`}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Paid on" required>
          <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </FormField>
      </FormGrid>

      <p className="record-payment__result">
        Access until <b>{fmtDate(newPaidThrough)}</b>
        {company.paidThrough && <span className="record-payment__previous"> (currently {fmtDate(company.paidThrough)})</span>}
      </p>

      {error && <div className="record-payment__error">{error}</div>}
    </Modal>
  );
};
