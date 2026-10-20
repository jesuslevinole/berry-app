import { useEffect, useState } from 'react';
import { TRIAL_LIMIT_EVENT, TRIAL_RECORD_LIMIT } from '../../services/trialLimits';
import './TrialLimitNotice.css';

/**
 * Aviso cuando un formulario llega al limite de la prueba gratuita. Lo dispara
 * services/firestore.ts (evento del navegador) al intentar crear un registro de mas.
 */
export const TrialLimitNotice = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleLimit = () => setOpen(true);
    window.addEventListener(TRIAL_LIMIT_EVENT, handleLimit);
    return () => window.removeEventListener(TRIAL_LIMIT_EVENT, handleLimit);
  }, []);

  const handleClose = () => setOpen(false);

  if (!open) return null;

  return (
    <div className="trial-limit" role="alert">
      <div className="trial-limit__body">
        <strong className="trial-limit__title">Free trial limit reached</strong>
        <span className="trial-limit__text">
          During the free trial each form allows up to {TRIAL_RECORD_LIMIT} records. Subscribe to keep adding records.
        </span>
      </div>
      <button type="button" className="btn btn--secondary" onClick={handleClose}>
        Got it
      </button>
    </div>
  );
};
