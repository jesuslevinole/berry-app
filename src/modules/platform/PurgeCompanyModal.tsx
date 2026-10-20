import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { FormField } from '../../components/ui/FormField';
import { purgeCompany, type PurgeProgress } from '../../services/companyPurgeService';
import { fmtDate } from '../../utils/format';
import type { Company, SystemUser } from '../../types/models';
import './PurgeCompanyModal.css';

interface PurgeCompanyModalProps {
  company: Company;
  users: SystemUser[];
  onClose: () => void;
}

/**
 * Borrado definitivo de una prueba vencida sin pago. Para evitar un clic por error,
 * hay que escribir el nombre exacto de la empresa.
 */
export const PurgeCompanyModal = ({ company, users, onClose }: PurgeCompanyModalProps) => {
  const [typedName, setTypedName] = useState('');
  const [progress, setProgress] = useState<PurgeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameMatches = typedName.trim() === company.name.trim();
  const memberCount = users.filter((user) => user.companyId === company.id).length;

  const handlePurge = async () => {
    if (!nameMatches) return;
    setError(null);
    setBusy(true);
    try {
      await purgeCompany(company, users, setProgress);
      onClose();
    } catch {
      setError('The deletion stopped with an error. Whatever was already deleted is gone; run it again to finish.');
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      title={`Delete all data · ${company.name}`}
      open
      onClose={handleClose}
      confirmOnClose={false}
      footer={
        <>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" disabled={!nameMatches || busy} onClick={() => void handlePurge()}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </>
      }
    >
      <div className="purge">
        <p className="purge__warning">
          This permanently deletes every record of <b>{company.name}</b> (orders, sales, expenses, catalogs,
          settings, logs), its {memberCount} user {memberCount === 1 ? 'membership' : 'memberships'} and the
          company itself. It cannot be undone.
        </p>
        <p className="purge__meta">
          Free trial ended on {fmtDate(company.trialEndsAt)} and no payment was recorded.
        </p>
        <FormField label={`Type "${company.name}" to confirm`}>
          <input className="input" value={typedName} disabled={busy} onChange={(e) => setTypedName(e.target.value)} />
        </FormField>
        {progress && (
          <p className="purge__progress">
            {progress.deleted} records deleted · {progress.step}
          </p>
        )}
        {error && <div className="purge__error">{error}</div>}
      </div>
    </Modal>
  );
};
