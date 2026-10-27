import { useState } from 'react';
import { useSquareCard } from '../../hooks/useSquareCard';
import {
  cyclePrice,
  firstChargeDate,
  subscribeCompany,
  type BillingCycle,
  type SquareConfig,
} from '../../services/squareBillingService';
import type { Company, PlatformPlan } from '../../types/models';
import { addDays } from '../../services/billingService';
import { fmtDate, fmtMoney } from '../../utils/format';
import './BillingSubscribeForm.css';

interface BillingSubscribeFormProps {
  company: Company;
  /** Solo planes que se pagan en linea (con precio). */
  plans: PlatformPlan[];
  config: SquareConfig | null;
  configError: string;
}

const CARD_CONTAINER_ID = 'billing-card-field';

/** Elegir plan y ciclo, escribir la tarjeta (campo de Square) y crear la suscripcion. */
export const BillingSubscribeForm = ({ company, plans, config, configError }: BillingSubscribeFormProps) => {
  const [planId, setPlanId] = useState(() => plans.find((p) => p.highlighted)?.id ?? plans[0]?.id ?? '');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneOn, setDoneOn] = useState('');
  const card = useSquareCard(config, CARD_CONTAINER_ID);

  const plan = plans.find((p) => p.id === planId);
  const annualAvailable = !!plan && plan.annualMonthlyPrice >= 1;
  const selectedCycle: BillingCycle = annualAvailable ? cycle : 'monthly';
  const price = plan ? cyclePrice(plan, selectedCycle) : 0;
  const chargeOn = firstChargeDate(company);
  const chargesToday = chargeOn <= addDays(0);
  const formError = configError || card.error || error;
  const canSubmit = !!plan && card.status === 'ready' && !busy;

  const handleSubscribe = async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const sourceId = await card.tokenize();
      const result = await subscribeCompany({ companyId: company.id, planId: plan.id, cycle: selectedCycle, sourceId });
      setDoneOn(result.subscriptionStartsAt || chargeOn);
    } catch (e) {
      setError((e as Error).message || 'The subscription could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (doneOn) {
    return (
      <section className="billing-form billing-form--done">
        <h3 className="billing-form__title">You're subscribed</h3>
        <p className="billing-form__text">
          The card was saved. The first charge of {fmtMoney(price)} is on {fmtDate(doneOn)}; you'll get a receipt by email.
        </p>
      </section>
    );
  }

  if (plans.length === 0) {
    return (
      <section className="billing-form">
        <p className="billing-form__text">There are no plans available for online payment yet. Contact us to subscribe.</p>
      </section>
    );
  }

  return (
    <section className="billing-form">
      <h3 className="billing-form__title">Choose your plan</h3>

      <div className="billing-form__plans" role="radiogroup" aria-label="Plan">
        {plans.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === planId}
            className={`billing-form__plan${option.id === planId ? ' billing-form__plan--on' : ''}`}
            onClick={() => setPlanId(option.id)}
          >
            <span className="billing-form__plan-name">{option.name}</span>
            <span className="billing-form__plan-price">{fmtMoney(option.monthlyPrice)} / month</span>
            {option.annualMonthlyPrice >= 1 && (
              <span className="billing-form__plan-note">or {fmtMoney(option.annualMonthlyPrice)} / month billed yearly</span>
            )}
          </button>
        ))}
      </div>

      {annualAvailable && (
        <div className="billing-form__cycle" role="radiogroup" aria-label="Billing cycle">
          <button
            type="button"
            role="radio"
            aria-checked={selectedCycle === 'monthly'}
            className={`billing-form__cycle-option${selectedCycle === 'monthly' ? ' billing-form__cycle-option--on' : ''}`}
            onClick={() => setCycle('monthly')}
          >
            Monthly
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={selectedCycle === 'annual'}
            className={`billing-form__cycle-option${selectedCycle === 'annual' ? ' billing-form__cycle-option--on' : ''}`}
            onClick={() => setCycle('annual')}
          >
            Yearly
          </button>
        </div>
      )}

      <h3 className="billing-form__title">Card</h3>
      {/* Square pinta aqui su campo seguro de tarjeta (iframe): el app nunca ve el numero. */}
      <div id={CARD_CONTAINER_ID} className="billing-form__card" />
      {card.status === 'loading' && <p className="billing-form__hint">Loading the secure card form…</p>}

      <p className="billing-form__summary">
        {chargesToday
          ? `You'll be charged ${fmtMoney(price)} today, then every ${selectedCycle === 'annual' ? 'year' : 'month'}.`
          : `Nothing is charged today. Your first charge of ${fmtMoney(price)} is on ${fmtDate(chargeOn)}, when your free trial ends.`}{' '}
        Cancel anytime.
      </p>

      {formError && <p className="billing-form__error">{formError}</p>}

      <div className="billing-form__actions">
        <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => void handleSubscribe()}>
          {busy ? 'Saving…' : 'Start subscription'}
        </button>
      </div>
      <p className="billing-form__secure">Payments are processed securely by Square.</p>
    </section>
  );
};
