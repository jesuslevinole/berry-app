import { useEffect, useState } from 'react';
import { Toolbar } from '../../components/ui/Toolbar';
import { useAuth } from '../../context/AuthContext';
import { listPublicPlans } from '../../services/platformPlansService';
import {
  cancelCompanySubscription,
  fetchSquareConfig,
  hasLiveSubscription,
  isPlanPayableOnline,
  type SquareConfig,
} from '../../services/squareBillingService';
import { fmtDate } from '../../utils/format';
import type { PlatformPlan } from '../../types/models';
import { BillingStatusCard } from './BillingStatusCard';
import { BillingSubscribeForm } from './BillingSubscribeForm';
import './BillingView.css';

interface BillingViewProps {
  /** Dentro de la pantalla de bloqueo (suscripcion vencida): sin barra de titulo. */
  embedded?: boolean;
}

/**
 * Billing del dueno de la empresa: plan actual, tarjeta y cancelar, o elegir plan y suscribirse.
 * El cobro lo hace Square; el Worker guarda el resultado en la ficha de la empresa (en vivo).
 */
export const BillingView = ({ embedded = false }: BillingViewProps) => {
  const { company } = useAuth();
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [config, setConfig] = useState<SquareConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  /* Planes de Plans & pricing (lectura puntual, coleccion diminuta). */
  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      const found = await listPublicPlans();
      if (!cancelled) setPlans(found);
    };
    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Application ID y Location ID de Square para el campo de tarjeta (los da el Worker). */
  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const found = await fetchSquareConfig();
        if (!cancelled) setConfig(found);
      } catch (e) {
        if (!cancelled) setConfigError((e as Error).message || 'Payments are not available right now.');
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!company) return null;

  const payablePlans = (plans ?? []).filter(isPlanPayableOnline);
  const currentPlan = (plans ?? []).find((p) => p.id === company.subscriptionPlanId);
  const live = hasLiveSubscription(company);
  const hasSubscription = !!company.squareSubscriptionId;

  const handleCancel = async () => {
    const until = fmtDate(company.paidThrough || company.subscriptionStartsAt);
    const question = until
      ? `Cancel the subscription? You keep access until ${until} and you won't be charged again.`
      : "Cancel the subscription? You won't be charged again.";
    if (!window.confirm(question)) return;
    setCanceling(true);
    setCancelError('');
    try {
      await cancelCompanySubscription(company.id);
    } catch (e) {
      setCancelError((e as Error).message || 'The subscription could not be canceled. Try again.');
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className={`billing${embedded ? ' billing--embedded' : ''}`}>
      {!embedded && <Toolbar title="Billing" subtitle="Your plan, card and payments" />}

      {hasSubscription && (
        <BillingStatusCard company={company} plan={currentPlan} canceling={canceling} onCancel={() => void handleCancel()} />
      )}
      {cancelError && <p className="billing__error">{cancelError}</p>}

      {!live && plans && (
        <BillingSubscribeForm company={company} plans={payablePlans} config={config} configError={configError} />
      )}
      {!plans && <p className="billing__loading">Loading plans…</p>}
    </div>
  );
};
